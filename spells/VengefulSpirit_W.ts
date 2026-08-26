import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Nearsight = api.buffs.Nearsight;
const StatAmp = api.buffs.StatAmp;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;

/**
 * Sóng Kinh Hoàng — a wave of dread rolled out in a straight line. What it
 * takes off you is your armour and your eyes, not your health.
 *
 *   press in a direction -> the wave rolls out to 700 and keeps going
 *   it washes over you   -> your sight closes to almost nothing
 *   and stays            -> your armour is stripped for four seconds
 *   it reaches the end   -> it dissipates; it never stopped on anybody
 *
 * ## What the damage is for
 *
 * Twelve. Deliberately under the 15–35 band a damaging ability belongs in,
 * because this is not one — the payload is the blindness and the stripped
 * armour, and the damage is only there so a player who walked through it knows
 * they did. An ability whose real effect is invisible needs *something* to say
 * it happened.
 *
 * ## Nearsight's radius is absolute
 *
 * `newVisionRadius` is the sight radius the victim is left with, not an amount
 * subtracted from theirs — core builds the modifier as
 * `-currentBase + newVisionRadius`. Reading it as a delta gives a blind that
 * does nothing to a short-sighted unit and blanks a long-sighted one.
 */
export const W_RANGE = 700;
export const W_SPEED = 22;
export const W_DAMAGE = 12;
/** Flat armour taken off anyone the wave touches. */
export const W_ARMOR_SHRED = 5;
/** The sight radius a victim is left with. Absolute — see the header. */
export const W_BLIND_RADIUS = 120;
export const W_DEBUFF_MS = 4_000;
/** How far either side of the line the dread actually reaches. */
export const W_HALF_WIDTH = 55;
export const W_COOLDOWN_MS = 13_000;
export const W_MANA = 30;

export default class VengefulSpirit_W extends Spell {
  image = api.asset('spell_vengefulspirit_w');
  name = 'Sóng Kinh Hoàng (VengefulSpirit_W)';
  description =
    `Tung một làn sóng kinh hoàng theo hướng chỉ định. Kẻ địch trúng phải nhận ` +
    `<span class="damage">${W_DAMAGE} sát thương phép</span>, bị ` +
    `<span class="buff">giảm ${W_ARMOR_SHRED} giáp</span> và ` +
    `<span class="buff">mù</span> trong <span class="time">${W_DEBUFF_MS / 1000} giây</span>.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'DIRECTION' as const;
  range = W_RANGE;

  /** The wave that is out, for as long as one is. Read by the test. */
  live: VengefulSpirit_W_Object | null = null;

  onSpellCast(): void {
    const wave = new VengefulSpirit_W_Object(this.owner);
    wave.position = this.owner.position.copy();
    wave.destination = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      W_RANGE
    ).to;
    this.live = wave;
    this.game.objectManager.addObject(wave);
  }

  drawPreview(): void {
    super.drawPreview(W_RANGE);
  }
}

/**
 * The wave itself: a bar travelling broadside-on, its width the width it really
 * has.
 *
 * Drawn as a bar rather than a disc for one reason — this ability's area is a
 * *line*, and a growing circle would tell the player the wrong shape. The hard
 * edges sit at `W_HALF_WIDTH` on each side so where it stops is not a guess.
 */
export class VengefulSpirit_W_Object extends SpellObject {
  /**
   * Declared here rather than inherited: `SpellObject` carries no `image`, and
   * the debuffs this object applies want the ability's own icon on the HUD row.
   */
  image = api.asset('spell_vengefulspirit_w');

  /** Where the roll ends. Set by the spell. */
  destination = createVector(0, 0);

  /**
   * Multi-hit protection. A wave sweeping over a body touches it on several
   * consecutive frames, and without this it would strip armour once per frame.
   */
  private readonly washed = new Set<AttackableUnit>();
  private heading = 0;

  onAdded(): void {
    this.heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
  }

  update(): void {
    const step = createVector(
      this.destination.x - this.position.x,
      this.destination.y - this.position.y
    );
    if (step.mag() <= W_SPEED) {
      this.position.set(this.destination.x, this.destination.y);
      this.wash();
      this.toRemove = true;
      return;
    }
    step.setMag(W_SPEED);
    this.position.add(step);
    this.wash();
  }

  /**
   * Everyone the leading edge is currently over. **No vision filter** — this is
   * an area effect, and vision gates picking one unit out of a crowd, never
   * whether an area touches a body.
   */
  private wash(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: W_HALF_WIDTH }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      if (this.washed.has(victim)) continue;
      // `queryObjects` answers on bounds, so the edge is re-checked against the
      // width the wave actually claims.
      if (victim.position.dist(this.position) > W_HALF_WIDTH) continue;
      this.washed.add(victim);

      victim.takeDamage(W_DAMAGE, this.owner, 'MAGIC', 'Sóng Kinh Hoàng');
      if (victim.isDead) continue;

      const blinded = new Nearsight(W_DEBUFF_MS, this.owner, victim);
      // Absolute, not a delta — see the spell's header.
      blinded.newVisionRadius = W_BLIND_RADIUS;
      blinded.image = this.image;
      blinded.stackId = 'dota_vengefulspirit_w_blind';
      victim.addBuff(blinded);

      const stripped = new StatAmp(W_DEBUFF_MS, this.owner, victim);
      // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build its
      // modifier, and `addBuff` is what runs it.
      stripped.bonuses = { armor: { flatBonus: -W_ARMOR_SHRED } };
      stripped.name = 'Giáp Vỡ';
      stripped.image = this.image;
      // Without an id it shares one stack pool with every other bare `StatAmp`
      // in the match, including her own E.
      stripped.stackId = 'dota_vengefulspirit_w_shred';
      victim.addBuff(stripped);
    }
  }

  /** A bar wider than it is long, so the box is not a square around the centre. */
  getDisplayBoundingBox(): Rectangle {
    const reach = W_HALF_WIDTH + 40;
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle every frame.
    return new Rectangle({
      x: this.position.x - reach,
      y: this.position.y - reach,
      w: reach * 2,
      h: reach * 2,
      data: this,
    });
  }

  draw(): void {
    const at = this.position;
    push();
    translate(at.x, at.y);
    rotate(this.heading);

    // Three bands trailing the leading edge, each dimmer and further back, so
    // the direction of travel is legible from the shape alone.
    noStroke();
    for (let band = 0; band < 3; band++) {
      const back = band * 16;
      fill(126, 106, 200, 150 - band * 42);
      rect(-back - 12, -W_HALF_WIDTH, 12, W_HALF_WIDTH * 2);
    }

    // The leading edge, hard, at the true half-width. This is the line the
    // player reads the ability's reach off.
    stroke(214, 196, 255, 235);
    strokeWeight(3);
    line(0, -W_HALF_WIDTH, 0, W_HALF_WIDTH);
    // Two small caps mark the ends so the width does not bleed into the dark.
    noStroke();
    fill(236, 226, 255, 220);
    circle(0, -W_HALF_WIDTH, 7);
    circle(0, W_HALF_WIDTH, 7);
    pop();
  }
}
