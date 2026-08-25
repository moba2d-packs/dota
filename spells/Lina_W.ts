import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Stun = api.buffs.Stun;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Trận Địa Sáng — a square of light drawn on the ground, and a little over
 * half a second later a column of fire standing in it.
 *
 *   press          -> the array is drawn where she aimed, at its real radius
 *   the delay runs -> the array fills from the rim inward; a player can leave
 *   it fills       -> fire erupts, everything still inside burns and is stunned
 *   she walks off  -> the array goes off anyway; it is planted, not held
 *
 * **The delay is the ability.** It is a clock inside the spawned object rather
 * than `castSpec` timing for the last line above: a `castTimeMs` or a channel
 * belongs to the caster, so walking, being stunned or dying between the press
 * and the eruption would cancel the thing she has already paid for and already
 * shown the enemy. A planted array has nothing left to interrupt.
 *
 * ## Why two objects
 *
 * The array is ground art and must name `GROUND_Z_INDEX` — `Z_INDEX_MAP` is
 * keyed by exact constructor, so a `SpellObject` subclass inherits nothing and
 * falls through to 99, painting a decal over the feet of everyone standing in
 * it. The eruption is the opposite: it is the impact, it has to land *on* the
 * victims, and at the ground layer the very people it just stunned would be
 * drawn on top of the flames that stunned them. Two layers, so two objects —
 * and it makes the two moments look as different as they behave.
 */
export const W_DAMAGE = 24;
export const W_RANGE = 500;
/** The radius the damage uses, the radius the telegraph is drawn at. One number, deliberately. */
export const W_RADIUS = 130;
/** The window a player has to walk out. The whole point of the ability. */
export const W_DELAY_MS = 550;
export const W_STUN_MS = 1_100;
export const W_COOLDOWN_MS = 13_000;
export const W_MANA = 45;
/** How long the flames stand after they go up. Cosmetic. */
export const W_ERUPTION_MS = 420;
/** How long the burnt ground lingers once the fire is out. Cosmetic. */
export const W_SCORCH_MS = 700;

export default class Lina_W extends Spell {
  image = api.asset('spell_lina_w');
  name = 'Trận Địa Sáng (Lina_W)';
  description =
    `Vẽ một trận địa lửa tại vị trí chỉ định. Sau ` +
    `<span class="time">${W_DELAY_MS / 1000} giây</span>, cột lửa bùng lên gây ` +
    `<span class="damage">${W_DAMAGE} sát thương</span> và <span class="buff">choáng ` +
    `${W_STUN_MS / 1000} giây</span> cho kẻ địch trong bán kính ${W_RADIUS}.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'POINT' as const;
  range = W_RANGE;

  /** The array on the ground, still counting down. Read by the test, and by nothing else. */
  live: Lina_W_Object | null = null;

  onSpellCast(): void {
    const array = new Lina_W_Object(this.owner);
    // POINT targeting keeps the distance the thumb dragged and the spell caps
    // it — `getVectorWithMaxRange` leaves a short aim short, unlike
    // `getVectorWithRange`, which would fling every tap to maximum range.
    array.position = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      W_RANGE
    ).to;
    this.live = array;
    this.game.objectManager.addObject(array);
  }

  drawPreview(): void {
    super.drawPreview(W_RANGE);
  }
}

/**
 * The array itself: the clock, the damage, and the light on the ground.
 *
 * Deliberately does **not** die with its caster. Everything it needs was
 * decided at the press, and an array that fizzles because she walked into a
 * fight and lost it would be a promise made to the enemy and then withdrawn.
 */
export class Lina_W_Object extends SpellObject {
  /** Ground art, so it names its layer. A subclass inherits nothing from `Z_INDEX_MAP`. */
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;
  private erupted = false;
  /** Seeded once in `onAdded`; re-rolled inside `draw` these would shimmer rather than converge. */
  private glyphs: number[] = [];

  /** How many the eruption caught. Read by the test, and by nothing else. */
  lastHitCount = 0;

  onAdded(): void {
    for (let i = 0; i < 8; i++) this.glyphs.push(random(0.55, 1));
  }

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (!this.erupted && this.ageMs >= W_DELAY_MS) this.erupt();
    if (this.erupted && this.ageMs >= W_DELAY_MS + W_SCORCH_MS) this.toRemove = true;
  }

  /** The one moment this object exists for. Runs exactly once. */
  private erupt(): void {
    this.erupted = true;

    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: W_RADIUS }),
      // No vision filter, on purpose. Vision gates *acquisition* — picking one
      // unit out of a query — and this picks nobody: it is an area that burns
      // whatever it overlaps, so a champion standing in an unlit bush inside
      // the ring must still be hit. Adding `visibleTo` here would make the
      // array quietly stop working in exactly the place a player hides in it.
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    this.lastHitCount = caught.length;
    for (const victim of caught) {
      victim.takeDamage(W_DAMAGE, this.owner);
      // `Stun` keeps its own `buff_stun` icon rather than being handed this
      // spell's: the status bar's job is to say *what* is on you, and every
      // stun in the match reading the same is the whole value of that row.
      const dazed = new Stun(W_STUN_MS, this.owner, victim);
      // Without an id this shares one stack pool with every other bare Stun in
      // the match, so somebody else's would refresh — and be refreshed by —
      // this one.
      dazed.stackId = 'dota_lina_w_stun';
      victim.addBuff(dazed);
    }

    const blaze = new Lina_W_Eruption(this.owner);
    blaze.position = this.position.copy();
    this.game.objectManager.addObject(blaze);
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((W_RADIUS + 20) * 2);
  }

  draw(): void {
    const centre = this.position;

    push();
    if (!this.erupted) {
      // How much of the warning has been spent. `t*t` winds in, so the array
      // creeps and then rushes — the last tenth of a second reads as urgent
      // rather than as more of the same.
      const spent = Math.min(1, this.ageMs / W_DELAY_MS);
      const closing = spent * spent;

      // The rim is at the real damage radius from the first frame and never
      // moves. It is the promise the ability makes, and a ring that grows into
      // its own answer tells the player the area is smaller than it is.
      noFill();
      stroke(255, 186, 74, 150 + 90 * closing);
      strokeWeight(2 + 3 * closing);
      circle(centre.x, centre.y, W_RADIUS * 2);

      // Light closing inward to fill it. This is the clock: when the fill
      // reaches the rim, the fire arrives.
      noStroke();
      fill(255, 150, 46, 26 + 74 * closing);
      circle(centre.x, centre.y, W_RADIUS * 2 * closing);

      // Sigils sliding down the spokes toward the centre — the motion agrees
      // with the effect, which gathers rather than spreads.
      for (let i = 0; i < this.glyphs.length; i++) {
        const spoke = (i / this.glyphs.length) * TWO_PI;
        const along = W_RADIUS * (1 - closing) * (this.glyphs[i] ?? 1);
        fill(255, 226, 150, 200);
        circle(centre.x + Math.cos(spoke) * along, centre.y + Math.sin(spoke) * along, 8);
      }
    } else {
      // Burnt ground, fading. Separate look, separate moment.
      const cooling = Math.min(1, (this.ageMs - W_DELAY_MS) / W_SCORCH_MS);
      noStroke();
      fill(58, 26, 16, 120 * (1 - cooling));
      circle(centre.x, centre.y, W_RADIUS * 2);
      noFill();
      stroke(150, 62, 24, 190 * (1 - cooling));
      strokeWeight(3);
      circle(centre.x, centre.y, W_RADIUS * 2);
    }
    pop();
  }
}

/**
 * The eruption: the column of fire, for as long as it stands.
 *
 * Its own object so it can sit above the champions it just stunned — see the
 * spell header. It carries no damage at all; by the time it exists the array
 * has already resolved.
 */
export class Lina_W_Eruption extends SpellObject {
  private ageMs = 0;
  /** Seeded once. A column whose flames re-roll every frame flickers instead of rising. */
  private columns: { angle: number; along: number; tall: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < 11; i++) {
      this.columns.push({
        angle: random(TWO_PI),
        along: random(0.1, 0.92),
        tall: random(0.55, 1),
      });
    }
  }

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= W_ERUPTION_MS) this.toRemove = true;
  }

  /** The flames stand well above the impact point, so the box is not the hit circle. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((W_RADIUS + 110) * 2);
  }

  draw(): void {
    const centre = this.position;
    const spent = Math.min(1, this.ageMs / W_ERUPTION_MS);
    // Up fast, down slow: `1-(1-t)^2` on the rise, a plain fade on the way out.
    const rising = 1 - (1 - Math.min(1, spent * 2.6)) * (1 - Math.min(1, spent * 2.6));
    const fade = 1 - spent;

    push();
    noStroke();

    // The columns, planted inside the same radius the damage used so the fire
    // stands exactly where the array was drawn.
    for (const column of this.columns) {
      const outward = W_RADIUS * column.along;
      const footX = centre.x + Math.cos(column.angle) * outward;
      const footY = centre.y + Math.sin(column.angle) * outward;
      const tall = 96 * column.tall * rising;
      for (let step = 0; step < 4; step++) {
        const up = step / 3;
        fill(
          255,
          200 - 110 * up,
          80 - 60 * up,
          230 * fade * (1 - up * 0.45)
        );
        circle(footX, footY - tall * up, 26 * (1 - up * 0.55) * rising + 4);
      }
    }

    // One white core at the centre for the instant it goes off, so the moment
    // the damage lands is unmistakable against the array's slow orange glow.
    const flash = Math.max(0, 1 - spent * 4);
    if (flash > 0) {
      fill(255, 252, 232, 235 * flash);
      circle(centre.x, centre.y, W_RADIUS * 0.9 * (1 - flash) + 30);
    }
    pop();
  }
}
