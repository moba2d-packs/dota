import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Unit = api.units.AttackableUnit;
const Disarm = api.buffs.Disarm;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;

/**
 * Kích Thiên Đường's active: point at the carry, and for two seconds their
 * weapon is just a thing they are holding.
 *
 *   press on an enemy within 500 -> their basic attacks stop
 *   while it holds               -> they still walk, still cast — only the swing is gone
 *   2 seconds                    -> the weapon works again
 *
 * ## The anti-carry button, and only that
 *
 * `Disarm` is the narrowest disable core sells: no movement taken, no spells
 * taken, a melee wind-up already in progress cancelled at the strike instant.
 * That narrowness is the item — against the right-click heroes this shop keeps
 * arming (Satanic, Búa Bão Tố, Mắt Skadi, Daedalus are all on the same shelf)
 * it deletes their entire output for the window, and against a caster it does
 * nothing at all. Which target to spend it on *is* the purchase.
 *
 * One flat duration, unlike the source item's melee/ranged split: the split
 * pays against exactly the heroes who are already this engine's ranged-favoured
 * half, and one honest number reads better on a card than two qualified ones.
 *
 * ## Enemy only — `Item_Euls.ts`'s argument, not restated
 *
 * A `UNIT` spell must declare `targetTeam: 'ENEMY'` or a press over empty
 * ground resolves the wearer and disarms *him*. Same construction throughout.
 */
export const DISARM_MS = 2_000;
export const RANGE = 500;
export const COOLDOWN_MS = 15_000;
export const STACK_ID = 'dota_item_halberd';

export default class Item_Halberd extends Spell {
  image = api.asset('item_heavens_halberd');
  name = 'Kích Thiên Đường (Item_Halberd)';
  description =
    `Kích hoạt: <span class="buff">tước vũ khí</span> một tướng địch trong ` +
    `<span class="time">${DISARM_MS / 1000} giây</span> — không đánh thường được, ` +
    `nhưng vẫn đi lại và dùng chiêu.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  range = RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

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
      Reach.withinRange(RANGE, this.owner, target)
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

    // `Disarm` is already `RENEW_EXISTING`; the shared stack id is what keeps
    // two halberds on one team from being a rolling permanent disarm — the
    // second press rewinds the first one's clock instead of queueing behind it.
    const disarmed = new Disarm(DISARM_MS, this.owner, victim);
    disarmed.stackId = STACK_ID;
    disarmed.image = this.image;
    victim.addBuff(disarmed);
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}
