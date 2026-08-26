import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Khiên Shiva's passive: a cold that hangs around the wearer and takes the legs
 * off anyone who comes near.
 *
 *   held           -> a ring of frost follows him, always on
 *   an enemy walks in -> they are slowed for as long as they stay
 *   they walk out  -> it lets go a beat later
 *
 * ## Both halves of the aura trap, in one item
 *
 * **A re-applied `Slow` must `RENEW_EXISTING`.** Its default add type stacks
 * ten deep, so an aura re-applying four times a second turns "25% slow" into a
 * standstill inside one second. One slow, its clock rewound.
 *
 * **The grant's duration is a tick plus a linger, not the aura's lifetime.**
 * This aura is *permanent* — it lasts as long as the item is held — so a grant
 * tied to its lifetime would never come off anybody who had ever stood next to
 * him. A tick plus `LINGER_MS` is what makes walking away work, a beat late.
 *
 * ## Why the arming buff is invisible and the aura object is not
 *
 * The buff exists only to own the aura's lifetime and to be dropped when the
 * item is sold, so `hudVisible = false` — otherwise buying this puts a
 * permanent row on the buff bar that says nothing a player can act on. The ring
 * on the ground is the readable half, and that is where the information goes.
 */
export const AURA_RADIUS = 500;
export const SLOW_PCT = 0.25;
/** How often membership is re-checked. Not every frame: see `Item_ShivasGuard_Object`. */
export const TICK_MS = 250;
/** How long a grant outlives the tick that made it — the beat a leaver keeps it. */
export const LINGER_MS = 250;
export const STACK_ID = 'dota_item_shivas_guard';

/**
 * The arming state. It holds nothing but the aura's lifetime, which is what
 * makes selling the item take the cold with it.
 */
export class Item_ShivasGuard_Armed extends Buff {
  name = 'Khiên Shiva';
  /** Bookkeeping, not news. See the spell's header. */
  hudVisible = false;
}

export default class Item_ShivasGuard extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_shivas_guard');
  name = 'Khiên Shiva (Item_ShivasGuard)';
  description =
    `Nội tại: toả ra hơi lạnh bán kính ${AURA_RADIUS}, ` +
    `<span class="buff">làm chậm ${Math.round(SLOW_PCT * 100)}%</span> mọi kẻ địch ` +
    `đứng gần. Không gây sát thương.`;
  coolDown = 0;
  manaCost = 0;

  /** The cold that is up, for as long as the item is held. Read by the test. */
  live: Item_ShivasGuard_Object | null = null;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: 0 },
    };
  }

  onSpellCast(): void {
    this.dropAura();

    // `duration = 0` is permanent and draws no countdown — the right shape for
    // something armed for as long as the item is held.
    const armed = new Item_ShivasGuard_Armed(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID;
    // Core 1.5 reads this to drop an item's buffs when the item is sold; the
    // aura object is attached to this buff, so it goes with it.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);

    const cold = new Item_ShivasGuard_Object(this.owner);
    cold.position = this.owner.position.copy();
    this.live = cold;
    cold.attachTo(this.owner, armed);
    this.game.objectManager.addObject(cold);
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
}

/**
 * The ring of frost, and the clock that owns membership.
 *
 * `zIndex = GROUND_Z_INDEX` because this is ground art: a `SpellObject`
 * subclass with no layer of its own resolves to `SPELL_EFFECT_Z_INDEX`, above
 * the champions — and a 500-radius ring painted there covers the feet of
 * exactly the people who need to see where its edge is.
 *
 * The tick is 250ms rather than every frame because re-applying a buff sixty
 * times a second is sixty allocations a second per enemy, to express something
 * that only changes when somebody crosses a line.
 */
export class Item_ShivasGuard_Object extends SpellObject {
  image = api.asset('item_shivas_guard');
  zIndex = GROUND_Z_INDEX;

  /** Who the last tick chilled. Drawn as frost marks; read for nothing else. */
  chilled: AttackableUnit[] = [];

  private ageMs = 0;
  private sinceTick = 0;
  /** Whether the first sweep has run. See `Sniper_Q` for why this is not a seed. */
  private started = false;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;

    // Stated outright rather than bought by seeding `sinceTick` at the
    // interval, which would make the first interval half-length and leave the
    // rate depending on how finely the caller sliced time.
    if (!this.started) {
      this.started = true;
      this.chill();
    }

    this.sinceTick += step;
    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= TICK_MS) {
      this.sinceTick -= TICK_MS;
      this.chill();
    }
  }

  private chill(): void {
    // **No vision filter** — an aura touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: AURA_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const caught: AttackableUnit[] = [];
    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the ring actually draws.
      if (victim.position.dist(this.position) > AURA_RADIUS) continue;

      const frozen = new Slow(TICK_MS + LINGER_MS, this.owner, victim);
      frozen.percent = SLOW_PCT;
      // Both halves matter — see the spell's header.
      frozen.buffAddType = BuffAddType.RENEW_EXISTING;
      frozen.image = this.image;
      frozen.stackId = STACK_ID;
      victim.addBuff(frozen);
      caught.push(victim);
    }

    this.chilled = caught;
  }

  /** The frost marks sit on enemies that move independently of the ring's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - AURA_RADIUS;
    let top = this.position.y - AURA_RADIUS;
    let right = this.position.x + AURA_RADIUS;
    let bottom = this.position.y + AURA_RADIUS;
    for (const victim of this.chilled) {
      if (!victim) continue;
      left = Math.min(left, victim.position.x);
      top = Math.min(top, victim.position.y);
      right = Math.max(right, victim.position.x);
      bottom = Math.max(bottom, victim.position.y);
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
    const at = this.position;
    // Opens once and then holds — this is permanent, so it must not pulse
    // itself into being ignored.
    const opening = Math.min(1, this.ageMs / 400);
    const swept = 1 - (1 - opening) * (1 - opening);
    const breath = 1 + 0.008 * Math.sin(this.ageMs / 520);

    push();
    // The true radius, on the ground. Cool hues: this is a magic effect and
    // must not dress in the physical amber family.
    noFill();
    stroke(150, 210, 236, 120);
    strokeWeight(2);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath);
    stroke(110, 170, 210, 45);
    strokeWeight(1);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath - 12);

    // A frost mark on each enemy the last tick actually caught. The ring says
    // where the cold is; these say who it currently has, which is the half a
    // player acts on.
    noStroke();
    for (const victim of this.chilled) {
      if (!victim || victim.isDead) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      fill(198, 232, 248, 90);
      circle(victim.position.x, victim.position.y + body * 0.28, body * 0.55);
    }
    pop();
  }
}
