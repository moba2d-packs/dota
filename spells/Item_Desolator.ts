import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;

/**
 * Kẻ Hủy Diệt — armour off the target, not armour ignored by the wearer.
 *
 * ## The rule this item is the worked example of
 *
 * Core sells `armorPenetration`, a share of the victim's armour that *the
 * attacker* ignores. Using it here would have been one word in `data.ts` and
 * it would have been the wrong game. Desolator, Veil of Discord and Mystic
 * Snake all work the other way round: they put a **debuff on the victim**, so
 * the four allies who bought nothing hit that victim harder too — which is the
 * entire reason the item is drafted rather than bought for oneself.
 *
 * So the corruption is a `StatAmp` on whoever was hit, with a negative
 * `armor.flatBonus`. `docs/STATS_VS_DOTA.md` states the rule and
 * `tests/statConversion.test.ts` refuses any item in this shop that grants
 * either penetration stat, so the shortcut cannot be taken by accident later.
 *
 * ## Flat, not a share
 *
 * Dota's armour reduction is flat and so is this. A share would scale with what
 * the victim bought, which reverses the item's own logic — Desolator is what
 * you buy to make a *squishy* target meltable, and a percentage does the least
 * against exactly that target. Flat also composes correctly with this engine's
 * `1 + armor/100` curve: six armour off a hero on sixteen is a real 5% more
 * damage, and off a hero on fifty-five it is 2%, which is the right way round.
 */

/** Armour taken off the victim per hit, and how long it stays. */
export const CORRUPTION = 6;

export const CORRUPTION_MS = 7_000;

export const STACK_ID = 'dota_item_desolator';


export class Item_Desolator_Corruption extends Buff {
  name = 'Kẻ Hủy Diệt';
  description =
    'Đòn đánh của bạn <span class="buff">trừ 6 giáp</span> của mục tiêu trong ' +
    '<span class="time">7 giây</span> — cả đội đều đánh mạnh hơn lên mục tiêu đó.';
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  onHit(hit: OnHitEvent): void {
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    const corroded = new StatAmp(CORRUPTION_MS, this.targetUnit, victim);
    corroded.name = 'Ăn Mòn';
    // Tagged by the item rather than by the attacker, so two heroes carrying
    // one Desolator each do not stack twelve armour off a single body — the
    // source item does not stack with itself either.
    corroded.stackId = STACK_ID;
    corroded.bonuses = { armor: { flatBonus: -CORRUPTION } };
    victim.addBuff(corroded);
  }
}


export default class Item_Desolator extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_desolator');
  name = 'Kẻ Hủy Diệt (Item_Desolator)';
  description =
    'Nội tại: đòn đánh trừ <span class="buff">6 giáp</span> của mục tiêu trong' +
    ' <span class="time">7 giây</span>';
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
    const armed = new Item_Desolator_Corruption(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = 'dota_item_desolator_armed';
    armed.hudVisible = false;
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }
}
