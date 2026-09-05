import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Shield = api.buffs.Shield;
const heal = api.text.heal;

/**
 * Mũ Kháng Cự's passive: a ward that eats the next spell thrown at him, and
 * re-weaves itself once it is spent.
 *
 *   held        -> a small barrier stands, and it only answers magic
 *   it breaks   -> the ward is down, and spells hit him like anyone else
 *   9 seconds   -> it has woven itself back
 *
 * ## The shop's first answer to an ability build
 *
 * Every defensive item this shop sold before this pair was stats or a button:
 * armour, resistance, a reflect, a cleanse. Against a caster who leads with
 * one big nuke, flat resistance shaves the hit and this *absorbs* it — which
 * is Dota's Hood of Defiance exactly, a barrier that regenerates between
 * fights and is worth nothing the second time a fight asks the question too
 * quickly. `absorbs: ['MAGIC']` is what makes it that item rather than a
 * smaller Vanguard: a blade goes straight through, and the description says
 * so out loud.
 *
 * ## Mirrored on Tiên Phong deliberately
 *
 * Same rearm mechanism, opposite damage type, and the pair is the point: a
 * player who has learned one has learned the other, and which wall to buy is
 * a real decision about who is killing them. The two files stay separate so
 * either can be retuned without an argument about the other.
 */
/** What the ward absorbs before it breaks. Magic only — see the header. */
export const WARD_AMOUNT = 14;
/** How long the ward stays down after breaking. */
export const REARM_MS = 9_000;
export const STACK_ID = 'dota_item_hood';
export const SHIELD_STACK_ID = 'dota_item_hood_ward';

/**
 * The rearm clock. Permanent, hidden, and the thing that weaves each ward.
 */
export class Item_Hood_Ward extends Buff {
  name = 'Mũ Kháng Cự';
  hudVisible = false;

  /** The ward now standing, if one is. */
  ward: InstanceType<typeof Shield> | null = null;
  /** Time the ward has been down, counted toward the reweave. */
  private downMs = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) return;
    this.rearmTotalMs = REARM_MS;
    if (this.ward && !this.ward.toRemove) {
      this.rearmMsLeft = 0;
      return;
    }

    this.downMs += Math.max(0, deltaTime);
    // The slot's countdown — see core Buff.rearmMsLeft.
    this.rearmMsLeft = Math.max(0, REARM_MS - this.downMs);
    if (this.downMs < REARM_MS) return;
    this.weave();
  }

  /** Weaves a fresh ward. Also called once on purchase, so the item arrives armed. */
  weave(): void {
    this.downMs = 0;
    const wearer = this.targetUnit;
    // `duration = 0`: the ward stands until broken — what ends it is a spell
    // landing, not time, so a countdown would be a lie.
    const ward = new Shield(0, wearer, wearer);
    ward.amount = WARD_AMOUNT;
    ward.absorbs = ['MAGIC'];
    ward.name = 'Mũ Kháng Cự';
    // A cool hue on the health-bar ring: this ward answers magic, and the
    // default shield amber reads as the other wall.
    ward.color = [120, 190, 235];
    ward.image = this.image;
    // Its own pool, so a second Mũ Kháng Cự in the match cannot evict this one.
    ward.stackId = SHIELD_STACK_ID;
    // Tied to the item rather than to the life: selling it drops the ward too.
    ward.sourceSpell = this.sourceSpell;
    wearer.addBuff(ward);
    this.ward = ward;
  }

  onDeactivate(): void {
    // A sold item takes its standing ward with it.
    if (this.ward && !this.ward.toRemove) this.ward.deactivateBuff();
    this.ward = null;
  }
}

export default class Item_Hood extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_hood_of_defiance');
  name = 'Mũ Kháng Cự (Item_Hood)';
  description =
    `Nội tại: mang một lá chắn hấp thụ ${heal(WARD_AMOUNT, ' sát thương phép')}. ` +
    `Vỡ rồi thì <span class="time">${REARM_MS / 1000} giây</span> sau dệt lại. ` +
    `Đòn đánh thường xuyên thẳng qua.`;
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
    const clock = new Item_Hood_Ward(0, this.owner, this.owner);
    clock.image = this.image;
    clock.stackId = STACK_ID;
    // Core reads this to drop an item's buffs when the item is sold.
    clock.sourceSpell = this;
    this.owner.addBuff(clock);

    // Armed on purchase rather than nine seconds later — the item the shop
    // sells is a standing ward, not a promissory note for one.
    clock.weave();
  }
}
