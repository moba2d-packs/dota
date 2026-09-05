import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Slow = api.buffs.Slow;

/**
 * Mắt Skadi — every swing carries the cold, and the target stops getting away.
 *
 * ## The carry's slow, on the swing rather than on a button
 *
 * The frost rides the basic attack for the same reason Bình Hồn's wound does
 * (see `Item_SpiritVessel.ts`): an on-hit passive is the item a right-click
 * hero actually uses, because it lands every time they do the thing they were
 * already doing. Between Khiên Shiva (a slow you stand in) and this (a slow
 * you are *hit* by), the shop now sells the cold in both grammars.
 *
 * ## `RENEW_EXISTING`, or an attack-speed build stacks it to a standstill
 *
 * `Slow`'s default add type stacks ten deep, and this item's whole audience
 * swings twice a second — three swings would turn "25%" into a pin. One slow,
 * clock rewound per hit, shared stack id so two Skadi carriers focusing one
 * body still add up to one frost.
 */
export const SLOW_PERCENT = 0.25;
export const SLOW_MS = 2_500;
export const STACK_ID = 'dota_item_skadi';

export class Item_Skadi_Frost extends Buff {
  name = 'Mắt Skadi';
  description =
    'Đòn đánh của bạn <span class="buff">làm chậm 25%</span> mục tiêu trong ' +
    '<span class="time">2.5 giây</span>.';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  onHit(hit: OnHitEvent): void {
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    const frozen = new Slow(SLOW_MS, this.targetUnit, victim);
    frozen.percent = SLOW_PERCENT;
    // Both halves — renew, and the shared id. See the header.
    frozen.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    frozen.stackId = STACK_ID;
    frozen.image = this.image;
    victim.addBuff(frozen);
  }
}

export default class Item_Skadi extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_eye_of_skadi');
  name = 'Mắt Skadi (Item_Skadi)';
  description =
    'Nội tại: đòn đánh thường <span class="buff">làm chậm 25%</span> mục tiêu ' +
    'trong <span class="time">2.5 giây</span>.';
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
    const armed = new Item_Skadi_Frost(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = 'dota_item_skadi_armed';
    // The inventory slot already says he is carrying it.
    armed.hudVisible = false;
    // Core reads this to drop an item's buffs when the item is sold.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }
}
