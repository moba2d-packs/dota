import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Mảnh Đạn — a shell of scrap fired onto a patch of ground. Nothing dies to it;
 * anybody standing in it is bleeding and slow, which is the same thing five
 * seconds later.
 *
 *   press on a point within 600 -> the field lands and is live immediately
 *   standing in it              -> a bite every half second, and slowed
 *   walking out of it           -> the slow lets go a beat later
 *   five seconds                -> the ground is clear
 *
 * ## Two things a ground zone gets wrong, and this is where both are fixed
 *
 * **A re-applied `Slow` must `RENEW_EXISTING`.** Its default add type stacks
 * ten deep, so a zone re-applying it every tick turns "a 30% slow" into a
 * standstill inside two seconds. One slow, its clock rewound.
 *
 * **The slow's duration is a tick plus a linger, not the field's lifetime.**
 * Tie it to the lifetime and stepping out of the field means keeping the slow
 * for the rest of the five seconds, standing anywhere on the map. A tick plus
 * `Q_LINGER_MS` is what makes leaving actually work, a beat late.
 *
 * The field also bites on the very first frame it exists, because a zone that
 * waits half a second before doing anything can be walked through for free.
 * That landing bite is stated outright in `update` rather than bought by
 * seeding the tick clock — see the comment there for why the difference is not
 * cosmetic.
 */
export const Q_CAST_RANGE = 600;
export const Q_RADIUS = 200;
export const Q_LIFETIME_MS = 5_000;
export const Q_TICK_MS = 500;
export const Q_DAMAGE_PER_TICK = 3;
/** `Q_DAMAGE_PER_TICK * (Q_LIFETIME_MS / Q_TICK_MS)` — 30, for standing in all of it. */
export const Q_TOTAL_DAMAGE = Q_DAMAGE_PER_TICK * (Q_LIFETIME_MS / Q_TICK_MS);
export const Q_SLOW_PCT = 0.3;
/** How long the slow outlives the tick that applied it. See the header. */
export const Q_LINGER_MS = 250;
export const Q_COOLDOWN_MS = 14_000;
export const Q_MANA = 35;

export default class Sniper_Q extends Spell {
  image = api.asset('spell_sniper_q');
  name = 'Mảnh Đạn (Sniper_Q)';
  description =
    `Bắn mảnh đạn xuống một vùng bán kính ${Q_RADIUS} trong ` +
    `<span class="time">${Q_LIFETIME_MS / 1000} giây</span>. Kẻ địch trong vùng nhận ` +
    `<span class="damage">${Q_DAMAGE_PER_TICK} sát thương</span> mỗi ` +
    `<span class="time">${Q_TICK_MS / 1000} giây</span> (tổng ` +
    `<span class="damage">${Q_TOTAL_DAMAGE}</span>) và bị ` +
    `<span class="buff">làm chậm ${Math.round(Q_SLOW_PCT * 100)}%</span>.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'POINT' as const;
  range = Q_CAST_RANGE;

  /** The field on the ground, for as long as one is. Read by the test. */
  live: Sniper_Q_Object | null = null;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      Q_CAST_RANGE
    );
    const field = new Sniper_Q_Object(this.owner);
    field.position = createVector(to.x, to.y);
    this.live = field;
    this.game.objectManager.addObject(field);
  }

  drawPreview(): void {
    super.drawPreview(Q_CAST_RANGE);
  }
}

/**
 * The field: scrap on the ground, and the clock that bites.
 *
 * `zIndex = GROUND_Z_INDEX` because this is ground art. A `SpellObject`
 * subclass with no layer of its own resolves to `SPELL_EFFECT_Z_INDEX`, which
 * is above the champions — a 200-radius patch painted there covers the feet of
 * everyone standing in it, which is exactly the population that needs to be
 * visible.
 */
export class Sniper_Q_Object extends SpellObject {
  image = api.asset('spell_sniper_q');
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;
  private sinceTick = 0;
  /** Whether the landing bite has been paid. See `update`. */
  private landed = false;
  /** Seeded once — `random()` inside `draw()` re-rolls per frame and flickers. */
  private readonly scrap = Array.from({ length: 26 }, () => ({
    angle: random(0, Math.PI * 2),
    reach: Math.sqrt(random(0, 1)),
    size: random(3, 7),
    turn: random(0, Math.PI),
  }));

  update(): void {
    const step = Math.max(0, deltaTime);
    this.ageMs += step;

    // **Before the bite, not after.** The field bites at 0, 500, … 4500 — ten
    // times across five seconds. Checking expiry last would let a bite land on
    // the same frame the field is removed, making it eleven, and a zone whose
    // real total is a tick more than its own description says is the shape a
    // tuning pass silently disagrees with.
    if (this.ageMs >= Q_LIFETIME_MS) {
      this.toRemove = true;
      return;
    }

    // The first bite is stated outright rather than bought by seeding
    // `sinceTick` at the interval. Seeding does land a bite on frame one, but
    // it also makes the *first* interval half-length — a caller stepping a
    // whole 500ms gets two bites out of it — so the field's rate depended on
    // how finely time happened to be sliced.
    if (!this.landed) {
      this.landed = true;
      this.bite();
    }

    this.sinceTick += step;
    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= Q_TICK_MS) {
      this.sinceTick -= Q_TICK_MS;
      this.bite();
    }
  }

  private bite(): void {
    // **No vision filter** — an area effect touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: Q_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the field actually draws.
      if (victim.position.dist(this.position) > Q_RADIUS) continue;

      victim.takeDamage(Q_DAMAGE_PER_TICK, this.owner, 'PHYSICAL');
      if (victim.isDead) continue;

      const dragging = new Slow(Q_TICK_MS + Q_LINGER_MS, this.owner, victim);
      dragging.percent = Q_SLOW_PCT;
      // Both halves matter — see the spell's header. `RENEW_EXISTING` keeps it
      // one slow however many ticks re-apply it, and the short duration is what
      // lets it go once they walk out.
      dragging.buffAddType = BuffAddType.RENEW_EXISTING;
      dragging.image = this.image;
      dragging.stackId = 'dota_sniper_q_slow';
      victim.addBuff(dragging);
    }
  }

  /** A disc on the ground, so a square around its own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(Q_RADIUS * 2 + 60);
  }

  draw(): void {
    const centre = this.position;
    const landing = Math.min(1, this.ageMs / 200);
    const swept = 1 - (1 - landing) * (1 - landing);
    const closing = Math.max(0, Math.min(1, (Q_LIFETIME_MS - this.ageMs) / 400));
    // A pulse on each bite, so the player can see the clock they are standing in.
    const bite = Math.max(0, 1 - (Q_TICK_MS - this.sinceTick) / 180);

    push();
    // The true radius, hard, on the ground.
    noFill();
    stroke(196, 168, 120, (170 + bite * 70) * closing);
    strokeWeight(2.5);
    circle(centre.x, centre.y, Q_RADIUS * 2 * swept);

    // The scrap itself, as short bars rather than dots: this is torn metal, and
    // it must not read as another of this pack's several round bursts.
    strokeCap(SQUARE);
    stroke(168, 146, 108, 190 * closing);
    strokeWeight(2);
    for (const piece of this.scrap) {
      const along = Q_RADIUS * swept * piece.reach;
      const x = centre.x + Math.cos(piece.angle) * along;
      const y = centre.y + Math.sin(piece.angle) * along;
      line(
        x - Math.cos(piece.turn) * piece.size,
        y - Math.sin(piece.turn) * piece.size,
        x + Math.cos(piece.turn) * piece.size,
        y + Math.sin(piece.turn) * piece.size
      );
    }
    pop();
  }
}
