import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Shield = api.buffs.Shield;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const heal = api.text.heal;

/**
 * Vệ Binh Đỏ's active: the guard raises shields, and for a moment the whole
 * line stands behind them.
 *
 *   press          -> a ring of banners snaps out to the radius it really has
 *   caught in it   -> every ally (him included) gains a barrier against blades
 *   5 seconds      -> whatever was not spent is lowered again
 *
 * ## Tẩu Thông Tuệ facing the other way
 *
 * Same press, same snapshot, same window, opposite damage type — the pair is
 * deliberate, exactly as Mũ Kháng Cự and Tiên Phong pair on the passive
 * shelf. Dota's Crimson Guard is the buy against a side whose damage arrives
 * as swings — a fed carry mid-Omnislash, a tower dive — and pressing it as
 * the swinging starts is the whole skill. `absorbs: ['PHYSICAL']` is what
 * keeps the two team buttons two different decisions rather than one item
 * with two icons.
 *
 * All the shape arguments live in `Item_Pipe.ts` and are not restated here:
 * why a burst and not an aura, why the grant is a snapshot, and why two
 * copies pressed together `RENEW_EXISTING` one barrier per body instead of
 * stacking.
 */
export const BARRIER_AMOUNT = 15;
export const BARRIER_MS = 5_000;
export const RADIUS = 400;
export const COOLDOWN_MS = 16_000;
export const STACK_ID = 'dota_item_crimson_guard';

export default class Item_CrimsonGuard extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_crimson_guard');
  name = 'Vệ Binh Đỏ (Item_CrimsonGuard)';
  description =
    `Kích hoạt: bản thân và đồng minh trong bán kính ${RADIUS} nhận lá chắn hấp thụ ` +
    `${heal(BARRIER_AMOUNT, ' sát thương vật lý')} trong ` +
    `<span class="time">${BARRIER_MS / 1000} giây</span>. ` +
    `Phép thuật xuyên thẳng qua.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
      ],
    }) as AttackableUnit[];

    for (const ally of found) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the banners actually reach.
      if (ally.position.dist(this.owner.position) > RADIUS) continue;

      const guard = new Shield(BARRIER_MS, this.owner, ally);
      guard.amount = BARRIER_AMOUNT;
      guard.absorbs = ['PHYSICAL'];
      guard.name = 'Vệ Binh Đỏ';
      // Warm and physical, against Tẩu's cool blue — the two team barriers
      // must be tellable apart at a glance, mid-fight.
      guard.color = [235, 150, 110];
      guard.image = this.image;
      // One barrier per body — see `Item_Pipe.ts`.
      guard.buffAddType = BuffAddType.RENEW_EXISTING;
      guard.stackId = STACK_ID;
      // Tied to the item rather than to the life: selling it mid-window drops
      // every barrier it handed out.
      guard.sourceSpell = this;
      ally.addBuff(guard);
    }

    const banners = new Item_CrimsonGuard_Object(this.owner);
    banners.position = this.owner.position.copy();
    this.game.objectManager.addObject(banners);
  }
}

/** How long the banner ring takes to snap out and fade. */
export const FLARE_MS = 700;

/**
 * The raised guard: one ring snapping out to the true radius, then gone.
 *
 * A moment, not a field — the barriers live on the allies' own health bars.
 * Same shape as Tẩu's smoke and a different temperature on purpose: in a
 * teamfight the only question this art answers is *which* wall just went up.
 */
export class Item_CrimsonGuard_Object extends SpellObject {
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= FLARE_MS) this.toRemove = true;
  }

  /** A square around its own centre, at the radius the ring snaps to. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(RADIUS * 2 + 40);
  }

  draw(): void {
    const at = this.position;
    const t = Math.min(1, this.ageMs / FLARE_MS);
    // Snaps out faster than the smoke — this is soldiers, not weather.
    const snapped = 1 - (1 - t) * (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    noFill();
    // The ring itself, at the reach the grant really had. Physical amber-red.
    stroke(235, 150, 110, 180 * fade);
    strokeWeight(2.5);
    circle(at.x, at.y, RADIUS * 2 * snapped);
    // Short banner ticks standing on the ring, so it reads as a held line
    // rather than as another smoke ring.
    strokeCap(SQUARE);
    strokeWeight(2);
    stroke(220, 110, 90, 150 * fade);
    const reach = RADIUS * snapped;
    for (let banner = 0; banner < 12; banner++) {
      const angle = (banner / 12) * Math.PI * 2;
      const cx = at.x + Math.cos(angle) * reach;
      const cy = at.y + Math.sin(angle) * reach;
      line(cx, cy, cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10);
    }
    pop();
  }
}
