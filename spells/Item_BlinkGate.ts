import type { AttackableUnit, CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;

/**
 * Dao Găm Nhảy's passive half: the sensor that knows when the wearer was last
 * hit, so the active half can refuse to fire.
 *
 * ## Why the gate is its own spell
 *
 * The rule "no blinking for three seconds after taking enemy damage" *is* the
 * item — without it the dagger is a strictly better escape pressed at ten
 * percent health, which is precisely the thing the source item refuses to be.
 * A spell only hears about damage through a buff's `onDamageTaken`, and a buff
 * needs a spell to arm it, and the active's own cast is too late: bought,
 * punched, pressed would slip through the gate on the first press because
 * nothing had been listening yet. An item may carry both a `passive` and an
 * `active`, so the listener is the passive, armed on purchase the way every
 * other passive here is, and the active reads it.
 *
 * ## What counts as being hit
 *
 * Enemy damage only. The wearer's own ability costs (Slark's pact bills him in
 * health) and anything an ally does must not lock his own escape — the source
 * game draws the same line at "player damage".
 */
export const DAMAGE_LOCK_MS = 3_000;
export const STACK_ID = 'dota_item_blink_gate';

/** The listener. Permanent, hidden, and read by `Item_BlinkDagger`. */
export class Item_BlinkGate_Sense extends Buff {
  name = 'Dao Găm Nhảy';
  hudVisible = false;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  /** Time since an enemy last landed anything. Starts calm: bought is ready. */
  private sinceHit = DAMAGE_LOCK_MS;

  onDamageTaken(swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (swung <= 0) return;
    if (!attacker || attacker === this.targetUnit) return;
    if (attacker.teamId === this.targetUnit.teamId) return;
    this.sinceHit = 0;
  }

  onUpdate(): void {
    this.sinceHit += Math.max(0, deltaTime);
  }

  /** Whether the dagger will answer a press right now. */
  get ready(): boolean {
    return this.sinceHit >= DAMAGE_LOCK_MS;
  }
}

export default class Item_BlinkGate extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_blink_dagger');
  name = 'Dao Găm Nhảy (Item_BlinkGate)';
  description =
    `Nội tại: theo dõi đòn địch — trúng đòn thì lưỡi dao nguội đi ` +
    `<span class="time">${DAMAGE_LOCK_MS / 1000} giây</span>.`;
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
    const sense = new Item_BlinkGate_Sense(0, this.owner, this.owner);
    sense.image = this.image;
    sense.stackId = STACK_ID;
    // Core reads this to drop an item's buffs when the item is sold.
    sense.sourceSpell = this;
    this.owner.addBuff(sense);
  }
}
