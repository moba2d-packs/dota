import type { AttackableUnit, OnHitEvent } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Buff = api.buffs.Buff;
const Airborne = api.buffs.Airborne;
const Dash = api.buffs.Dash;

/**
 * Bắn Tỉa — every third round goes somewhere that hurts, and puts them on
 * their back a step further away than they were.
 *
 *   press           -> armed for twelve seconds
 *   shots 1 and 2   -> ordinary
 *   shot 3          -> extra damage, off their feet, and shoved backwards
 *   shot 4          -> ordinary again; the count starts over
 *
 * ## Counted, not random
 *
 * Dota's Headshot is a chance. A chance is the right feel and the wrong
 * mechanic here: it makes the ability impossible to test without either
 * stubbing the random source or asserting on a distribution, and it makes it
 * impossible for a *player* to plan around. Every third shot is the same
 * average payout with a fact the player can act on — and the counter is per
 * arming, not per victim, so switching targets does not reset the wind-up.
 *
 * ## A knock-back is two buffs, and the second one must not be cancellable
 *
 * `Airborne` lifts them; the shove is a `Dash` on the *victim* whose
 * `sourceUnit` is the sniper, which is how this engine tells a displacement
 * apart from a self-dash. `cancelable = false` is not optional: `Airborne` is
 * itself in `Dash`'s own interrupt list, so a cancellable knock-back is one
 * that its own knock-up cancels on the frame it starts.
 */
export const E_DURATION_MS = 12_000;
/** Every Nth landed shot. See the header on why this is a count and not a chance. */
export const E_EVERY = 3;
export const E_DAMAGE = 14;
export const E_KNOCKBACK = 140;
export const E_AIRBORNE_MS = 500;
export const E_COOLDOWN_MS = 20_000;
export const E_MANA = 30;

/** The armed state, and the counter. Core walks the attacker's buffs per swing. */
export class Sniper_E_Armed extends Buff {
  name = 'Bắn Tỉa';

  /** Landed shots since the last headshot. Per arming, not per victim. */
  private since = 0;

  onHit(hit: OnHitEvent): void {
    if (this.toRemove) return;
    const shooter = this.targetUnit;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;
    // `applyOnHitEffects` does not care who was hit, so the ability has to.
    if (victim === shooter || victim.teamId === shooter.teamId) return;

    this.since += 1;
    if (this.since < E_EVERY) return;
    this.since = 0;
    this.land(shooter, victim);
  }

  private land(shooter: AttackableUnit, victim: AttackableUnit): void {
    victim.takeDamage(E_DAMAGE, shooter, 'PHYSICAL', 'Bắn Tỉa');
    // After the damage: `addBuff` refuses a corpse rather than knocking one
    // over.
    if (victim.isDead || victim.toRemove) return;

    const floored = new Airborne(E_AIRBORNE_MS, shooter, victim);
    floored.image = this.image;
    victim.addBuff(floored);

    // Directly away from the shooter. Read before anything mutates it, and
    // guarded against the degenerate case of two bodies exactly on top of each
    // other — a zero-length direction would shove them to the map origin.
    const dx = victim.position.x - shooter.position.x;
    const dy = victim.position.y - shooter.position.y;
    const span = Math.hypot(dx, dy);
    if (span === 0) return;
    const awayX = victim.position.x + (dx / span) * E_KNOCKBACK;
    const awayY = victim.position.y + (dy / span) * E_KNOCKBACK;

    const shoved = new Dash(E_AIRBORNE_MS + 400, shooter, victim);
    shoved.image = this.image;
    shoved.dashDestination = createVector(awayX, awayY);
    shoved.dashSpeed = 11;
    shoved.showTrail = false;
    // Not optional — see the header. `Airborne` is in the dash's own interrupt
    // list, so a cancellable shove is cancelled by its own knock-up.
    shoved.cancelable = false;
    victim.addBuff(shoved);
  }
}

export default class Sniper_E extends Spell {
  image = api.asset('spell_sniper_e');
  name = 'Bắn Tỉa (Sniper_E)';
  description =
    `Trong <span class="time">${E_DURATION_MS / 1000} giây</span>, mỗi ` +
    `<span class="buff">${E_EVERY} đòn đánh</span> trúng đích thì đòn cuối gây thêm ` +
    `<span class="damage">${E_DAMAGE} sát thương vật lý</span>, ` +
    `<span class="buff">hất tung</span> và <span class="buff">đẩy lùi</span> mục tiêu.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = 0;

  onSpellCast(): void {
    const armed = new Sniper_E_Armed(E_DURATION_MS, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = 'dota_sniper_e_armed';
    this.owner.addBuff(armed);
  }
}
