import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Shield = api.buffs.Shield;
const heal = api.text.heal;

/**
 * Tiên Phong's passive: a shield wall he carries in front of his body, and
 * rebuilds every time somebody breaks it.
 *
 *   held        -> a small barrier stands, and it only answers blades
 *   it breaks   -> the wall is down, and he is an ordinary body
 *   8 seconds   -> he has braced it back up
 *
 * ## Damage block, written with what exists
 *
 * Dota's Vanguard blocks a flat amount off *every* attack, and this engine
 * deliberately does not model per-instance block — `docs/STATS_VS_DOTA.md`
 * says the nearest honest thing is "a small `Shield` that comes back, not a
 * new stat", and this file is that sentence implemented. The barrier is
 * `absorbs: ['PHYSICAL']` so a nuke sails straight through it: this is the
 * front-liner's item, and the answer to spells is sold one shelf over
 * (Mũ Kháng Cự, the same wall facing the other way).
 *
 * ## Why the rearm clock is a hidden buff and the barrier is not
 *
 * The bookkeeping buff owns the clock and the item's lifetime — core drops it
 * when the item is sold, and its `onDeactivate` takes the standing barrier
 * with it, so a sold Tiên Phong cannot leave a wall behind. It says nothing a
 * player can act on, so `hudVisible = false`. The barrier itself is real news
 * — an attacker deciding whether to swing reads it off the health bar ring —
 * and `Shield` draws that itself, so this file ships no VFX object.
 */
/** What the wall absorbs before it breaks. Physical only — see the header. */
export const BLOCK_AMOUNT = 12;
/** How long the wall stays down after breaking. */
export const REARM_MS = 8_000;
export const STACK_ID = 'dota_item_vanguard';
export const SHIELD_STACK_ID = 'dota_item_vanguard_wall';

/**
 * The rearm clock. Permanent, hidden, and the thing that raises each wall.
 */
export class Item_Vanguard_Block extends Buff {
  name = 'Tiên Phong';
  hudVisible = false;

  /** The wall now standing, if one is. */
  wall: InstanceType<typeof Shield> | null = null;
  /** Time the wall has been down, counted toward the rebuild. */
  private downMs = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) return;
    if (this.wall && !this.wall.toRemove) return;

    this.downMs += Math.max(0, deltaTime);
    if (this.downMs < REARM_MS) return;
    this.raise();
  }

  /** Raises a fresh wall. Also called once on purchase, so the item arrives armed. */
  raise(): void {
    this.downMs = 0;
    const wearer = this.targetUnit;
    // `duration = 0`: the wall stands until broken, with no countdown to lie
    // about — what ends it is damage, not time.
    const wall = new Shield(0, wearer, wearer);
    wall.amount = BLOCK_AMOUNT;
    wall.absorbs = ['PHYSICAL'];
    wall.name = 'Tiên Phong';
    wall.image = this.image;
    // Its own pool, so a second Tiên Phong in the match cannot evict this one.
    wall.stackId = SHIELD_STACK_ID;
    // Tied to the item rather than to the life: selling it drops the wall too.
    wall.sourceSpell = this.sourceSpell;
    wearer.addBuff(wall);
    this.wall = wall;
  }

  onDeactivate(): void {
    // A sold item takes its standing wall with it — see the header.
    if (this.wall && !this.wall.toRemove) this.wall.deactivateBuff();
    this.wall = null;
  }
}

export default class Item_Vanguard extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_vanguard');
  name = 'Tiên Phong (Item_Vanguard)';
  description =
    `Nội tại: mang một lá chắn hấp thụ ${heal(BLOCK_AMOUNT, ' sát thương vật lý')}. ` +
    `Vỡ rồi thì <span class="time">${REARM_MS / 1000} giây</span> sau dựng lại. ` +
    `Phép thuật xuyên thẳng qua.`;
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
    const block = new Item_Vanguard_Block(0, this.owner, this.owner);
    block.image = this.image;
    block.stackId = STACK_ID;
    // Core reads this to drop an item's buffs when the item is sold.
    block.sourceSpell = this;
    this.owner.addBuff(block);

    // Armed on purchase rather than eight seconds later: the item the shop
    // sells is a standing wall, not a promissory note for one.
    block.raise();
  }
}
