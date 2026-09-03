import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Unit = api.units.AttackableUnit;
const DamageOverTime = api.buffs.DamageOverTime;
const Slow = api.buffs.Slow;
const Speedup = api.buffs.Speedup;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;
const BuffAddType = api.enums.BuffAddType;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;

/**
 * Cơn Đói Chiến Trận — he marks one enemy as food, and the hunger eats at them
 * while it drags him toward them.
 *
 *   press on an enemy within 400 -> the mark catches and starts burning them
 *   every 500ms                  -> another bite out of them
 *   for as long as it burns      -> they are slower and Axe is faster
 *   they die first               -> it stops on that tick, mid-sequence
 *
 * A `UNIT` spell, so it declares `targetTeam: 'ENEMY'`, validates the target
 * and overrides `press()` — all three, because without the first the resolver
 * defaults to `'ANY'`, which includes `request.caster`, and a press over empty
 * ground resolves *him*. Four shipped abilities in this engine did exactly
 * that.
 *
 * ## Why the burn subclasses core's `DamageOverTime` instead of using it
 *
 * Core's `DamageOverTime` is the right buff: it owns the tick clock (with the
 * remainder carried over, so the rate holds through a long frame), it paints
 * the flames, it takes a HUD row, and it renews rather than stacks. What it
 * cannot do is *name* its damage — `DamageOverTime.onUpdate` calls
 * `takeDamage(damagePerTick, sourceUnit)` with no type and no source label, so
 * every tick lands in the death recap under "Không rõ".
 *
 * So the buff below inherits all of that and sets `damagePerTick = 0`, which
 * makes core's own call a no-op (`takeDamage` rounds and returns on anything
 * `<= 0`), and ticks its own labelled bite beside it. One clock, one bite per
 * interval, and a recap that says which ability did it.
 */
export const W_RANGE = 400;
export const W_TICK_MS = 500;
export const W_DURATION_MS = 5_000;
export const W_DAMAGE_PER_TICK = 3;
/** `W_DAMAGE_PER_TICK * (W_DURATION_MS / W_TICK_MS)` — 30, inside the 15–35 band. */
export const W_TOTAL_DAMAGE = W_DAMAGE_PER_TICK * (W_DURATION_MS / W_TICK_MS);
/** What the hunger takes off the victim's legs, and gives to his. */
export const W_SLOW_PCT = 0.2;
export const W_HASTE_PCT = 0.2;
export const W_COOLDOWN_MS = 12_000;
export const W_MANA = 35;

/**
 * The mark itself. See the spell's header for why it inherits a DoT and then
 * deals its own damage.
 */
export class Axe_W_Burn extends DamageOverTime {
  name = 'Cơn Đói Chiến Trận';
  /** Core's own tick is deliberately a no-op; the labelled one below replaces it. */
  damagePerTick = 0;
  /** A hungry red rather than the default torch-yellow, so it never reads as a burn. */
  flameColor: [number, number, number] = [235, 90, 40];
  emberColor: [number, number, number] = [120, 18, 10];

  private sinceBite = 0;

  onUpdate(): void {
    // Runs the inherited clock, the flames, and the "target is already dead"
    // bail — which is what stops this chewing on a corpse.
    super.onUpdate();
    if (this.toRemove || this.targetUnit.isDead) return;

    this.sinceBite += Math.max(0, deltaTime);
    // Subtracted rather than zeroed, so the rate holds even when a frame ran
    // longer than a whole interval.
    while (this.sinceBite >= W_TICK_MS) {
      this.sinceBite -= W_TICK_MS;
      this.targetUnit.takeDamage(
        W_DAMAGE_PER_TICK,
        this.sourceUnit,
        'MAGIC',
        'Cơn Đói Chiến Trận'
      );
      if (this.targetUnit.isDead) return;
    }
  }
}

export default class Axe_W extends Spell {
  image = api.asset('spell_axe_w');
  name = 'Cơn Đói Chiến Trận (Axe_W)';
  description =
    `Đánh dấu một tướng địch trong <span class="time">${W_DURATION_MS / 1000} giây</span>, ` +
    `gây ${dmg(W_DAMAGE_PER_TICK, 'MAGIC')} mỗi ` +
    `<span class="time">${W_TICK_MS / 1000} giây</span> ` +
    `(tổng ${dmgValue(W_TOTAL_DAMAGE, 'MAGIC')}), ` +
    `<span class="buff">làm chậm ${Math.round(W_SLOW_PCT * 100)}%</span> mục tiêu và ` +
    `<span class="buff">tăng ${Math.round(W_HASTE_PCT * 100)}% tốc chạy</span> cho Axe.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  range = W_RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  /** Both bodies are wide, so `Reach` owns the number rather than the literal. */
  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      ...super.targetingRequest,
      range: Reach.effectiveRange(this.range, this.owner),
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => this.isValidTarget(candidate),
      getTargetInfo: candidate =>
        this.isValidTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  private isValidTarget(target?: unknown): target is AttackableUnit {
    return (
      target instanceof Unit &&
      !target.isDead &&
      !target.toRemove &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      Reach.withinRange(W_RANGE, this.owner, target)
    );
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) {
      if (!this.isValidTarget(context.target)) return false;
      return super.press(context);
    }
    const resolved = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return resolved.ok ? super.press(resolved.context) : false;
  }

  onSpellCast(context: CastContext): void {
    const victim = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(victim)) return;

    const hunger = new Axe_W_Burn(W_DURATION_MS, this.owner, victim);
    hunger.image = this.image;
    // Without an id it shares one stack pool with every other bare
    // `DamageOverTime` in the match — an enemy's poison would refresh, or
    // evict, this.
    hunger.stackId = 'dota_axe_w_hunger';
    victim.addBuff(hunger);

    const dragging = new Slow(W_DURATION_MS, this.owner, victim);
    dragging.percent = W_SLOW_PCT;
    // `Slow`'s default add type stacks ten deep. A recast landing on the same
    // victim must rewind one slow's clock, never deepen it.
    dragging.buffAddType = BuffAddType.RENEW_EXISTING;
    dragging.image = this.image;
    dragging.stackId = 'dota_axe_w_slow';
    victim.addBuff(dragging);

    const eager = new Speedup(W_DURATION_MS, this.owner, this.owner);
    eager.percent = W_HASTE_PCT;
    eager.buffAddType = BuffAddType.RENEW_EXISTING;
    eager.image = this.image;
    eager.stackId = 'dota_axe_w_haste';
    this.owner.addBuff(eager);
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}
