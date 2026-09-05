import type { OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;
const BuffAddType = api.enums.BuffAddType;

/**
 * Rút Tinh Túy — every swing takes a little of what makes them dangerous and
 * gives it to him. Neither half is invented: what he gains is exactly what they
 * lose.
 *
 *   press          -> armed for fourteen seconds; nothing has happened
 *   he lands a hit -> one point of their attack off them, onto him
 *   he keeps going -> it stacks, and the gap widens with every swing
 *   eight seconds after each theft -> that point goes home
 *
 * ## Why `Buff.onHit` and not an event listener
 *
 * `ON_ATTACK_HIT` is a match-wide event and hanging an ability off it means a
 * subscribe and four unsubscribe sites — `onCancel`, `onComplete`, `deactivate`
 * and `onRemoved` — any one of which outlives the match if it is missed. This
 * pack already carries one ability written that way and it is the most fragile
 * thing in it. `Buff.onHit` is the same effect expressed as state: the buff *is*
 * the arming, core walks the attacker's buffs once per landed swing, and when
 * the buff expires the hook is gone with it. Nothing to unsubscribe.
 *
 * ## Why the steal is two buffs and not one number
 *
 * Moving `attackDamage` by hand would mean this ability owning the put-it-back
 * half — for both bodies, across death, disconnect and a match ending mid-steal.
 * Two mirrored `StatAmp`s make the engine own it: each carries its own clock,
 * and `STACKS_AND_OVERLAPS` is what gives every theft an *independent* expiry
 * rather than one shared timer that the twentieth swing would keep rewinding.
 * That is the exact distinction `Buff.countedStacks` documents: a counter is
 * for a permanent uniform stack, and an array is for N stacks that must expire
 * at N different moments. This is the second.
 */
export const E_DURATION_MS = 14_000;
/** Attack damage moved per landed swing — off them, onto him. */
export const E_STEAL = 3;
/** How long one theft lasts before it goes home. */
export const E_STEAL_MS = 8_000;
/** Enough thefts that a long fight matters, few enough that it cannot run away. */
export const E_MAX_STACKS = 20;
/** Was 20s; trimmed for the practice room's 20s ceiling, kept just above the 14s duration so Rút Tinh Túy still lapses instead of running continuously. */
export const E_COOLDOWN_MS = 16_000;
export const E_MANA = 25;

/**
 * The armed state. Core walks the attacker's buffs on every landed basic
 * attack, so this is reached without anything subscribing to anything.
 */
export class Slark_E_Armed extends Buff {
  name = 'Rút Tinh Túy';

  onHit(hit: OnHitEvent): void {
    if (this.toRemove) return;
    const thief = this.targetUnit;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;
    // His own side keeps what it has. `applyOnHitEffects` does not care who was
    // hit, so the ability has to.
    if (victim.teamId === thief.teamId) return;
    if (victim === thief) return;

    // What they lose.
    const drained = new StatAmp(E_STEAL_MS, thief, victim);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
    // modifier, and `addBuff` is what runs it.
    drained.bonuses = { attackDamage: { flatBonus: -E_STEAL } };
    drained.name = 'Mất Tinh Túy';
    drained.image = this.image;
    drained.buffAddType = BuffAddType.STACKS_AND_OVERLAPS;
    drained.maxStacks = E_MAX_STACKS;
    // One instance per theft, each with its own clock — see the header.
    drained.stackId = 'dota_slark_e_drained';
    drained.singleRepresentativeDraw = true;
    victim.addBuff(drained);

    // What he gains — the same number, so nothing is created.
    const taken = new StatAmp(E_STEAL_MS, thief, thief);
    taken.bonuses = { attackDamage: { flatBonus: E_STEAL } };
    taken.name = 'Rút Tinh Túy';
    taken.image = this.image;
    taken.buffAddType = BuffAddType.STACKS_AND_OVERLAPS;
    taken.maxStacks = E_MAX_STACKS;
    taken.stackId = 'dota_slark_e_taken';
    taken.singleRepresentativeDraw = true;
    thief.addBuff(taken);
  }
}

export default class Slark_E extends Spell {
  /**
   * `Buff` alone. It deals no health damage at all — what it steals is
   * attack damage, on landed hits — so it is a scaling steroid and nothing
   * else.
   */
  static aiRoles = api.enums.SpellRole.Buff;

  image = api.asset('spell_slark_e');
  name = 'Rút Tinh Túy (Slark_E)';
  description =
    `Trong <span class="time">${E_DURATION_MS / 1000} giây</span>, mỗi đòn đánh thường của Slark ` +
    `<span class="buff">rút ${E_STEAL} sát thương công</span> của mục tiêu và ` +
    `<span class="buff">cộng vào cho Slark</span> trong ` +
    `<span class="time">${E_STEAL_MS / 1000} giây</span>. Hiệu ứng cộng dồn.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = 0;

  onSpellCast(): void {
    const armed = new Slark_E_Armed(E_DURATION_MS, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = 'dota_slark_e_armed';
    this.owner.addBuff(armed);
  }
}
