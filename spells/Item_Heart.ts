import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Rectangle = api.utils.Quadtree.Rectangle;
const heal = api.text.heal;

/**
 * Trái Tim Tarrasque's passive: leave him alone for five seconds and he starts
 * putting himself back together, fast.
 *
 *   held, being hit -> nothing at all
 *   five seconds untouched -> the heart starts beating, and it mends him
 *   hit again       -> it stops, and the five seconds start over
 *
 * ## The out-of-combat gate *is* the item
 *
 * A flat regeneration stat would just make him harder to kill while he is being
 * killed, which is a bigger health bar wearing a different name. Gating it on
 * not having been hit turns the item into a *decision*: it pays for
 * disengaging, and it is worth nothing to somebody who never leaves. So the
 * item is a `stats` block for the bulk plus this passive for the mending, and
 * the passive is where the interesting half lives.
 *
 * ## Why `onDamageTaken` and not a damage event subscription
 *
 * `Buff.onDamageTaken` runs after the whole mitigation chain, on the buffs of
 * the unit that was hit — which is exactly this wearer — so the reset needs no
 * subscription and therefore has nothing to unsubscribe. An `ON_TAKE_DAMAGE`
 * listener would be the same behaviour with a leak attached: it outlives the
 * match unless every teardown path remembers it, and it would also have to
 * filter every other unit's damage back out again.
 *
 * ## Only the out-of-combat part of a frame counts
 *
 * The mending clock advances by the slice of the frame actually spent out of
 * combat, not by the whole frame. Adding the whole step the moment the gate
 * opens would pay a long frame — or a test stepping five seconds at once — for
 * time that was spent in the fight.
 */
/** How long he has to go untouched before the heart starts. */
export const COMBAT_MS = 5_000;
export const TICK_MS = 500;
export const REGEN_PER_TICK = 5;
export const STACK_ID = 'dota_item_heart';

/**
 * The bookkeeping. Permanent, hidden, and the thing that actually mends him.
 *
 * `hudVisible = false` and `duration = 0`: a passive armed for as long as the
 * item is held is not news, and every purchase adding a permanent row with no
 * countdown to the buff bar is how a buff bar stops being readable.
 */
export class Item_Heart_Mending extends Buff {
  name = 'Trái Tim Tarrasque';
  hudVisible = false;

  /** Time since the last hit landed on the wearer. */
  private sinceHit = 0;
  /** Time banked toward the next mend, counted only while out of combat. */
  private sinceTick = 0;

  onDamageTaken(swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (swung <= 0) return;
    // Self-damage is a cost, not a fight — an ability that bills its caster in
    // health must not also switch their own regeneration off.
    if (!attacker || attacker === this.targetUnit) return;
    this.sinceHit = 0;
    this.sinceTick = 0;
  }

  onUpdate(): void {
    const wearer = this.targetUnit;
    if (wearer.isDead) return;

    const step = Math.max(0, deltaTime);
    const wasInCombat = this.sinceHit < COMBAT_MS;
    this.sinceHit += step;
    if (this.sinceHit < COMBAT_MS) return;

    // Only the slice of this frame spent out of combat — see the header.
    this.sinceTick += wasInCombat ? this.sinceHit - COMBAT_MS : step;

    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= TICK_MS) {
      this.sinceTick -= TICK_MS;
      // `takeHeal` clamps to max health itself, so there is no arithmetic here
      // that could overheal.
      wearer.takeHeal(REGEN_PER_TICK, wearer);
    }
  }

  /** True while the heart is actually beating. Read by the art. */
  get mending(): boolean {
    return this.sinceHit >= COMBAT_MS;
  }
}

export default class Item_Heart extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_heart_of_tarrasque');
  name = 'Trái Tim Tarrasque (Item_Heart)';
  description =
    `Nội tại: sau <span class="time">${COMBAT_MS / 1000} giây</span> không trúng đòn, ` +
    `hồi ${heal(REGEN_PER_TICK, ' máu')} mỗi ` +
    `<span class="time">${TICK_MS / 1000} giây</span>. Trúng đòn sẽ đếm lại từ đầu.`;
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
    const mending = new Item_Heart_Mending(0, this.owner, this.owner);
    mending.image = this.image;
    mending.stackId = STACK_ID;
    // Core 1.5 reads this to drop an item's buffs when the item is sold.
    mending.sourceSpell = this;
    this.owner.addBuff(mending);

    const beat = new Item_Heart_Object(this.owner);
    beat.mending = mending;
    beat.attachTo(this.owner, mending);
    this.game.objectManager.addObject(beat);
  }
}

/**
 * The beat, drawn **only while the heart is actually mending**.
 *
 * That predicate is the same one the healing spends against, which is the whole
 * rule for a worn state: a ready-glow over a state that is not true right now
 * is the effect lying, and that is worse than the effect missing. An always-on
 * shimmer would say nothing and spend the budget saying it — so for the five
 * seconds after a hit this object draws literally nothing.
 */
export class Item_Heart_Object extends SpellObject {
  /** The bookkeeping buff whose predicate this reads. Set by the spell. */
  mending: Item_Heart_Mending | null = null;

  private ageMs = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);
  }

  /** Rides his body, so a square around this object's own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(110);
  }

  draw(): void {
    // Nothing at all while he is in combat — see the header.
    if (!this.mending?.mending) return;
    if (this.owner.isDead) return;

    const at = this.position;
    const body = this.owner.animatedValues?.displaySize ?? 40;
    // An actual heartbeat: two quick pulses and a rest, rather than a sine wave
    // that reads as a generic glow.
    const cycle = (this.ageMs % TICK_MS) / TICK_MS;
    const beat =
      cycle < 0.14
        ? cycle / 0.14
        : cycle < 0.28
          ? 1 - (cycle - 0.14) / 0.14
          : cycle < 0.4
            ? (cycle - 0.28) / 0.12 * 0.6
            : cycle < 0.54
              ? 0.6 - ((cycle - 0.4) / 0.14) * 0.6
              : 0;

    push();
    // A stroke on the body, never a fill: he stays visible through his own
    // item art.
    noFill();
    stroke(226, 78, 92, 90 + beat * 140);
    strokeWeight(1.5 + beat * 2.5);
    circle(at.x, at.y, body * (1.02 + beat * 0.14));
    // A second, wider ring only at the peak, so the pulse has somewhere to go
    // without the resting state being loud.
    if (beat > 0.5) {
      stroke(255, 150, 150, (beat - 0.5) * 180);
      strokeWeight(1.5);
      circle(at.x, at.y, body * (1.2 + beat * 0.2));
    }
    pop();
  }
}
