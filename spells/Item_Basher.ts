import type { CastSpec, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Stun = api.buffs.Stun;

/**
 * Búa Khiên Sọ — keep swinging, and every fourth swing lands on the skull.
 *
 * ## Counted, not rolled — the honest adaptation
 *
 * Dota's bash is pseudo-random; this one is **every fourth hit**, exactly.
 * Same uptime as a 25% chance, none of the dice: a deterministic counter is
 * something a bot can be tested against and a practice room can *practice*
 * — count three, hold the fourth for the moment it matters — where a roll is
 * a slot machine the test suite has to seed. The card says "thứ 4" rather
 * than "25%", so the item claims the behaviour it has.
 *
 * ## Echo hits do not count
 *
 * `OnHitEvent.echo` marks applications that are themselves procs — a
 * propagated bolt, a phantom hit. Counting those would let one real swing
 * step the counter twice through another item's propagation, which turns
 * "every fourth swing" into a lie whose size depends on the rest of the bag.
 *
 * ## The stun does not stack with a second copy
 *
 * The stun carries a shared stack id and `RENEW_EXISTING`: two carriers
 * bashing one body hold it, not double it — the source item's own
 * non-stacking rule. Its `image` is deliberately not overridden; core draws
 * the stock stun icon *into the world* as the readout for "who is stunned",
 * and a champion-specific icon at that size is not legible as one (see
 * core's `Stun` header).
 */
export const HITS_PER_BASH = 4;
export const BASH_STUN_MS = 500;
export const STACK_ID = 'dota_item_basher';

export class Item_Basher_Count extends Buff {
  name = 'Búa Khiên Sọ';
  hudVisible = false;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  /** Swings landed since the last bash. */
  private count = 0;

  onHit(hit: OnHitEvent): void {
    if (hit.echo) return;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    this.count += 1;
    if (this.count < HITS_PER_BASH) return;
    this.count = 0;

    const bashed = new Stun(BASH_STUN_MS, this.targetUnit, victim);
    bashed.buffAddType = api.enums.BuffAddType.RENEW_EXISTING;
    bashed.stackId = STACK_ID;
    victim.addBuff(bashed);
  }
}

export default class Item_Basher extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_skull_basher');
  name = 'Búa Khiên Sọ (Item_Basher)';
  description =
    'Nội tại: mỗi đòn đánh thường <span class="buff">thứ 4</span> làm ' +
    '<span class="buff">choáng</span> mục tiêu <span class="time">0.5 giây</span>.';
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
    const armed = new Item_Basher_Count(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID + '_armed';
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }
}
