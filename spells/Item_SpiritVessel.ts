import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const HealCut = api.buffs.HealCut;

/**
 * Bình Hồn — the shop's answer to a hero who will not stop healing.
 *
 * ## Why this item exists in this pack
 *
 * Dota's Spirit Vessel is the reason a regeneration carry is not simply
 * unkillable, and this shop had no version of that at all: every point of
 * sustain sold here was a one-way ratchet, exactly as it was on the other side
 * of the engine before core grew a heal cut. Trái Tim Tarrasque is in this same
 * shop, and until now nothing could answer it.
 *
 * ## Why the cut rides the attack rather than an active
 *
 * The source item is an active, and an active would be the more faithful
 * button. It would also be the wrong *first* one: this pack already has four
 * actives and one on-hit passive, and a wound that has to be aimed is a wound
 * that mostly does not land. Riding the swing makes it the item a right-click
 * hero buys against a healer, which is who Spirit Vessel is for. If this shop
 * ever grows the aimed version, it should be a second item, not a rewrite of
 * this one.
 *
 * `HealCut` is core's — the strongest live one wins and they never sum, so two
 * of these in one team fight is one wound, and a bigger wound from somewhere
 * else is not made smaller by this one landing after it.
 */

/** How much of every heal the vessel takes, and for how long after the hit. */
export const WOUND_PERCENT = 0.45;

export const WOUND_MS = 3_000;

export const STACK_ID = 'dota_item_spirit_vessel';


export class Item_SpiritVessel_Wound extends Buff {
  name = 'Bình Hồn';
  description =
    'Đòn đánh của bạn <span class="buff">giảm 45%</span> mọi hiệu ứng hồi máu của mục tiêu trong ' +
    '<span class="time">3 giây</span>.';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  onHit(hit: OnHitEvent): void {
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    const wound = new HealCut(WOUND_MS, this.targetUnit, victim);
    wound.healCut = WOUND_PERCENT;
    victim.addBuff(wound);
  }
}


export default class Item_SpiritVessel extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_spirit_vessel');
  name = 'Bình Hồn (Item_SpiritVessel)';
  description =
    'Nội tại: đòn đánh giảm <span class="buff">45%</span> lượng hồi máu của mục tiêu trong' +
    ' <span class="time">3 giây</span>';
  coolDown = 0;
  manaCost = 0;

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
    const armed = new Item_SpiritVessel_Wound(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID;
    // The inventory slot already says he is carrying it; a permanent icon on
    // the buff bar says it a second time, every frame.
    armed.hudVisible = false;
    // Core reads this to drop an item's buffs when the item is sold.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }
}
