import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const StatAmp = api.buffs.StatAmp;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Hào Quang Báo Thù — for twelve seconds everyone fighting beside her hits
 * harder, herself included.
 *
 *   press          -> the ring opens on the ground at the radius it really has
 *   stand in it    -> your swing is worth more, and a thread says so
 *   walk out of it -> the bonus falls off a beat later
 *   twelve seconds -> the ring closes
 *
 * ## The half of an aura that is easy to get wrong
 *
 * A grant whose duration is the *aura's* lifetime never comes off when somebody
 * walks out of it — they keep the bonus for the rest of the twelve seconds
 * standing anywhere on the map. So each grant lasts one tick plus a short
 * linger and is renewed while the ally stays inside, which makes leaving drop
 * it a beat later and makes staying cost nothing: `RENEW_EXISTING` on a shared
 * `stackId` rewinds one buff's clock rather than adding a second copy, so
 * walking around inside the ring for twelve seconds does not end in twelve
 * stacked bonuses.
 *
 * That is also why the tick is 200ms rather than every frame: re-applying a
 * buff sixty times a second is sixty allocations a second per ally, to express
 * something that changes when somebody crosses a line.
 */
export const E_RADIUS = 500;
export const E_BONUS_DAMAGE = 6;
export const E_DURATION_MS = 12_000;
/** How often membership is re-checked. See the header on why not every frame. */
export const E_TICK_MS = 200;
/** How long a grant outlives the tick that made it — the beat a leaver keeps it. */
export const E_LINGER_MS = 250;
export const E_COOLDOWN_MS = 22_000;
export const E_MANA = 40;

export default class VengefulSpirit_E extends Spell {
  image = api.asset('spell_vengefulspirit_e');
  name = 'Hào Quang Báo Thù (VengefulSpirit_E)';
  description =
    `Mở một vùng hào quang bán kính ${E_RADIUS} trong ` +
    `<span class="time">${E_DURATION_MS / 1000} giây</span>: đồng đội đứng trong đó ` +
    `(kể cả cô) nhận <span class="buff">+${E_BONUS_DAMAGE} sát thương đánh thường</span>.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = E_RADIUS;

  /** The aura that is up, for as long as one is. Read by the test. */
  live: VengefulSpirit_E_Object | null = null;

  onSpellCast(): void {
    this.dropAura();
    const aura = new VengefulSpirit_E_Object(this.owner);
    aura.position = this.owner.position.copy();
    this.live = aura;
    this.game.objectManager.addObject(aura);
  }

  deactivate(): void {
    this.dropAura();
    super.deactivate();
  }

  onRemoved(): void {
    this.dropAura();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is up. */
  private dropAura(): void {
    if (!this.live) return;
    this.live.toRemove = true;
    this.live = null;
  }

  drawPreview(): void {
    super.drawPreview(E_RADIUS);
  }
}

/**
 * The ring, and the clock that owns membership.
 *
 * `zIndex = GROUND_Z_INDEX` because this is ground art: a `SpellObject`
 * subclass with no layer of its own resolves to `SPELL_EFFECT_Z_INDEX`, which
 * is *above* the champions, and a 500-radius disc painted there covers the feet
 * of everyone standing in it.
 */
export class VengefulSpirit_E_Object extends SpellObject {
  /** Declared here — `SpellObject` carries no `image`; the aura's grant wants one. */
  image = api.asset('spell_vengefulspirit_e');
  zIndex = GROUND_Z_INDEX;
  /** The ring lights what it covers, the way an aura should. */
  visionRadius = E_RADIUS;

  /** Who the last tick paid. Drawn as threads; not read for anything else. */
  paid: AttackableUnit[] = [];

  private ageMs = 0;
  /** Seeded at the interval so the ring pays on the very first frame it exists. */
  private sinceTick = E_TICK_MS;

  update(): void {
    if (this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;
    this.sinceTick += step;

    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= E_TICK_MS) {
      this.sinceTick -= E_TICK_MS;
      this.pay();
    }

    if (this.ageMs >= E_DURATION_MS) this.toRemove = true;
  }

  private pay(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: E_RADIUS }),
      filters: [PredefinedFilters.teamId(this.owner.teamId)],
    }) as AttackableUnit[];

    // She is inside her own aura, and a query keyed on the tree may or may not
    // return the caster depending on how she is indexed — so she is added
    // explicitly and the `Set` keeps her from being paid twice.
    const inside = new Set<AttackableUnit>([this.owner, ...found]);
    const paid: AttackableUnit[] = [];

    for (const ally of inside) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the ring actually draws.
      if (ally.position.dist(this.position) > E_RADIUS) continue;

      const sharpened = new StatAmp(E_TICK_MS + E_LINGER_MS, this.owner, ally);
      // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
      // modifier and `addBuff` is what runs it.
      sharpened.bonuses = { attackDamage: { flatBonus: E_BONUS_DAMAGE } };
      sharpened.name = 'Hào Quang Báo Thù';
      sharpened.image = this.image;
      // One buff per ally, its clock rewound every tick. Without
      // `RENEW_EXISTING` on a shared id, standing in the ring for twelve
      // seconds ends in sixty stacked bonuses.
      sharpened.buffAddType = BuffAddType.RENEW_EXISTING;
      sharpened.stackId = 'dota_vengefulspirit_e_aura';
      ally.addBuff(sharpened);
      paid.push(ally);
    }

    this.paid = paid;
  }

  /** The threads reach out to bodies that move independently of the ring's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - E_RADIUS;
    let top = this.position.y - E_RADIUS;
    let right = this.position.x + E_RADIUS;
    let bottom = this.position.y + E_RADIUS;
    for (const ally of this.paid) {
      if (!ally) continue;
      left = Math.min(left, ally.position.x);
      top = Math.min(top, ally.position.y);
      right = Math.max(right, ally.position.x);
      bottom = Math.max(bottom, ally.position.y);
    }
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle every frame.
    return new Rectangle({
      x: left - pad,
      y: top - pad,
      w: right - left + pad * 2,
      h: bottom - top + pad * 2,
      data: this,
    });
  }

  draw(): void {
    const centre = this.position;
    // Opens once, then holds: the edge has to stay readable for the whole
    // twelve seconds, so it does not pulse away to nothing.
    const opening = Math.min(1, this.ageMs / 320);
    const swept = 1 - (1 - opening) * (1 - opening);
    // A slow breath, so it reads as live rather than as a decal.
    const breath = 1 + 0.012 * Math.sin(this.ageMs / 260);
    const closing = Math.max(0, Math.min(1, (E_DURATION_MS - this.ageMs) / 400));

    push();
    // The true radius, hard, on the ground.
    noFill();
    stroke(196, 150, 240, 170 * closing);
    strokeWeight(2.5);
    circle(centre.x, centre.y, E_RADIUS * 2 * swept * breath);
    stroke(150, 110, 210, 60 * closing);
    strokeWeight(1);
    circle(centre.x, centre.y, E_RADIUS * 2 * swept * breath - 10);

    // A thread from her to each ally the last tick actually paid. This is the
    // part that says *who is getting it* — the ring alone only says where.
    for (const ally of this.paid) {
      if (!ally || ally.isDead || ally === this.owner) continue;
      stroke(214, 178, 255, 90 * closing);
      strokeWeight(1.5);
      line(centre.x, centre.y, ally.position.x, ally.position.y);
      noStroke();
      fill(228, 200, 255, 150 * closing);
      circle(ally.position.x, ally.position.y, 9);
    }
    pop();
  }
}
