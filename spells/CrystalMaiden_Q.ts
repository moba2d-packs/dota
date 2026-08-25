import type { AttackableUnit, CastContext, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Tân Tinh — she drops a star of ice on a patch of ground and everything
 * standing in it is cut and left crawling.
 *
 *   press on a point within 500 -> the aim is clamped to that reach
 *   everything inside 190       -> takes the hit once, and is slowed
 *   the ground it landed on     -> stays frosted for as long as the slow lasts
 *
 * ## One query, at the moment of the cast
 *
 * The damage is resolved once, here, rather than by a lingering object that
 * re-tests what it overlaps: a burst that ticks would hit a champion twice for
 * walking through its own animation, and the number on the screen would stop
 * matching the number in this file. The frost that stays behind is art for the
 * slow already applied — it has no query of its own and cannot hit anybody.
 *
 * ## No vision filter
 *
 * `visibleTo` is the gate on a query that *picks* a unit. This one narrows to
 * nothing: it damages every enemy body its circle overlaps, so a champion
 * standing in an unlit bush inside the blast is hit exactly like one standing
 * in the open. Vision gates acquisition, never damage.
 */
export const Q_DAMAGE = 24;
/** The blast. Every ring this ability draws is this number, so the edge is never a guess. */
export const Q_RADIUS = 190;
/** How far from her the centre may be placed. */
export const Q_RANGE = 500;
export const Q_SLOW = 0.35;
export const Q_SLOW_MS = 2_500;
export const Q_COOLDOWN_MS = 10_000;
export const Q_MANA = 45;

/** How long the eruption itself plays. The frost outlives it by the slow's duration. */
export const Q_BURST_MS = 480;

export default class CrystalMaiden_Q extends Spell {
  image = api.asset('spell_crystalmaiden_q');
  name = 'Tân Tinh (CrystalMaiden_Q)';
  description =
    `Gọi một vụ nổ băng xuống điểm chỉ định, gây ` +
    `<span class="damage">${Q_DAMAGE} sát thương</span> cho mọi kẻ địch trong bán kính ` +
    `${Q_RADIUS} và làm chậm ${Math.round(Q_SLOW * 100)}% trong ` +
    `<span class="time">${Q_SLOW_MS / 1000} giây</span>.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'POINT' as const;
  range = Q_RANGE;

  /** Where the last cast actually landed, after the range clamp. Read by the test. */
  lastCentre: { x: number; y: number } | null = null;

  onSpellCast(_context: CastContext): void {
    // `getVectorWithMaxRange` and not `getVectorWithRange`: a point inside her
    // reach must land where she aimed, not be pushed out to the rim.
    const centre = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, Q_RANGE).to;
    this.lastCentre = { x: centre.x, y: centre.y };

    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: centre.x, y: centre.y, r: Q_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of caught) {
      victim.takeDamage(Q_DAMAGE, this.owner);
      const chilled = new Slow(Q_SLOW_MS, this.owner, victim);
      chilled.percent = Q_SLOW;
      chilled.image = this.image;
      // Without an id every bare Slow in the match shares one stack pool, so
      // this one would be refreshed by — and refresh — somebody else's.
      chilled.stackId = 'dota_crystalmaiden_q_slow';
      victim.addBuff(chilled);
    }

    // Two objects, because they are two different statements. The burst says
    // "this just happened, this far"; the frost says "the ground is still
    // dangerous to stand on", and lasts exactly as long as that is true.
    const nova = new CrystalMaiden_Q_Object(this.owner);
    nova.position = centre.copy();
    this.game.objectManager.addObject(nova);

    const rime = new CrystalMaiden_Q_Frost(this.owner);
    rime.position = centre.copy();
    this.game.objectManager.addObject(rime);
  }

  drawPreview(): void {
    super.drawPreview(Q_RANGE);
  }
}

/**
 * The eruption: shards thrown *outward* from the centre, stopping dead on the
 * real 190 radius, under a hard rim drawn on that same number.
 *
 * A `SpellObject` and not `castSpec.vfx` because it is nowhere near her body —
 * `Champion.draw()` is skipped whenever `ObjectManager` culls or fogs her, and
 * an effect hung there vanishes while its damage lands.
 */
export class CrystalMaiden_Q_Object extends SpellObject {
  age = 0;

  /**
   * Seeded once, at construction rather than in `onAdded`: `addObject` queues
   * an object and only calls `onAdded` on the next `ObjectManager.update`, so
   * a shard list built there is empty for the frame the burst is loudest.
   * Re-rolling inside `draw` would boil rather than erupt.
   */
  private shards: { angle: number; reach: number; width: number; lean: number }[] = [];

  constructor(owner: AttackableUnit) {
    super(owner);
    for (let i = 0; i < 14; i++) {
      const spoke = (i / 14) * Math.PI * 2;
      this.shards.push({
        angle: spoke + random(-0.12, 0.12),
        reach: random(0.68, 1),
        width: random(0.06, 0.12),
        lean: random(-0.25, 0.25),
      });
    }
  }

  update(): void {
    this.age += Math.max(0, deltaTime);
    if (this.age >= Q_BURST_MS) this.toRemove = true;
  }

  /** The shards reach the rim, so the box is the rim plus the stroke that sits on it. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((Q_RADIUS + 24) * 2);
  }

  draw(): void {
    const centre = this.position;
    const t = Math.min(1, this.age / Q_BURST_MS);
    // Snap out: the ice arrives fast and settles. A linear ramp reads as a
    // placeholder, and an ease-in would make the blast look slow to bite.
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    // The floor of the blast first, so the shards read on top of it.
    noStroke();
    fill(150, 205, 240, 60 * fade);
    circle(centre.x, centre.y, Q_RADIUS * 2 * (0.55 + 0.45 * opened));

    // Angular, never round: each shard is a three-point splinter pointing the
    // way the ice travelled, and its tip stops on the real radius.
    for (const shard of this.shards) {
      const tip = Q_RADIUS * shard.reach * opened;
      const root = tip * 0.16;
      const across = Q_RADIUS * shard.width * fade;
      const lean = shard.angle + shard.lean * opened;
      const side = lean + Math.PI / 2;

      fill(226, 246, 255, 235 * fade);
      beginShape();
      vertex(centre.x + Math.cos(lean) * tip, centre.y + Math.sin(lean) * tip);
      vertex(
        centre.x + Math.cos(shard.angle) * root + Math.cos(side) * across,
        centre.y + Math.sin(shard.angle) * root + Math.sin(side) * across
      );
      vertex(
        centre.x + Math.cos(shard.angle) * root - Math.cos(side) * across,
        centre.y + Math.sin(shard.angle) * root - Math.sin(side) * across
      );
      endShape(CLOSE);
    }

    // The rim. Drawn on `Q_RADIUS` exactly, so a player who was clipped can see
    // they were inside it and one who was missed can see they were out.
    noFill();
    stroke(180, 230, 255, 240 * fade);
    strokeWeight(3 + 4 * fade);
    circle(centre.x, centre.y, Q_RADIUS * 2);
    pop();
  }
}

/**
 * The frost left on the ground, alive for exactly as long as the slow it
 * illustrates. Ground art, so it names its layer: `Z_INDEX_MAP` is keyed by
 * exact constructor and a `SpellObject` subclass inherits nothing — left
 * unset this would paint over the feet of everyone standing in it.
 */
export class CrystalMaiden_Q_Frost extends SpellObject {
  zIndex = GROUND_Z_INDEX;
  age = 0;

  /** Seeded at construction, for the same reason the burst's shards are. */
  private cracks: { angle: number; inner: number; outer: number; kink: number }[] = [];

  constructor(owner: AttackableUnit) {
    super(owner);
    for (let i = 0; i < 9; i++) {
      const spoke = (i / 9) * Math.PI * 2;
      this.cracks.push({
        angle: spoke + random(-0.2, 0.2),
        inner: random(0.12, 0.35),
        outer: random(0.7, 0.98),
        kink: random(-0.22, 0.22),
      });
    }
  }

  update(): void {
    this.age += Math.max(0, deltaTime);
    if (this.age >= Q_SLOW_MS) this.toRemove = true;
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((Q_RADIUS + 8) * 2);
  }

  draw(): void {
    const centre = this.position;
    const t = Math.min(1, this.age / Q_SLOW_MS);
    // Winds in over the first fifth, then holds, then thaws — it must be at
    // full strength for the middle of the slow, not fading through all of it.
    const spread = Math.min(1, t * 5);
    const held = 1 - Math.max(0, (t - 0.7) / 0.3);

    push();
    noStroke();
    fill(140, 195, 235, 52 * held);
    circle(centre.x, centre.y, Q_RADIUS * 2 * spread);

    stroke(205, 240, 255, 130 * held);
    strokeWeight(2);
    noFill();
    for (const crack of this.cracks) {
      const from = Q_RADIUS * crack.inner * spread;
      const to = Q_RADIUS * crack.outer * spread;
      const bent = crack.angle + crack.kink;
      line(
        centre.x + Math.cos(crack.angle) * from,
        centre.y + Math.sin(crack.angle) * from,
        centre.x + Math.cos(bent) * to,
        centre.y + Math.sin(bent) * to
      );
    }

    stroke(190, 235, 255, 110 * held);
    strokeWeight(1.5);
    circle(centre.x, centre.y, Q_RADIUS * 2 * spread);
    pop();
  }
}
