import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  Rectangle,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Unit = api.units.AttackableUnit;
const Slow = api.buffs.Slow;
const Rectangle = api.utils.Quadtree.Rectangle;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;
const BuffAddType = api.enums.BuffAddType;

/**
 * Hoán Đổi Hư Không — she and one enemy trade places, wherever they are
 * standing. No damage; the whole ability is the two of them changing ends.
 *
 *   press on an enemy within 650 -> she is where they were, they are where she was
 *   they land                    -> a moment of reeling before they can run
 *   she is grounded              -> refused, and nobody moves
 *
 * ## Why it swaps with an enemy and not an ally
 *
 * Dota's Nether Swap takes either. This one takes an enemy only, and that is a
 * deliberate narrowing rather than a missing half: a `UNIT` spell that accepted
 * both would have to declare `targetTeam: 'ANY'`, and `'ANY'` includes
 * `request.caster` — a press over empty ground then resolves *her*, and the
 * ability swaps her with herself. Four shipped abilities in this engine have
 * had exactly that bug. `'ENEMY'` closes it by construction, and pulling
 * somebody out of their own team into the middle of hers is the play the
 * ability is famous for anyway.
 *
 * ## The order of the two moves is the whole implementation
 *
 * `blinkOwnerTo` is allowed to refuse — it is the single place grounding is
 * enforced for a caster relocating itself, which is why a spell may not reach
 * for `owner.teleportTo` directly. So the caster moves *first*, and the victim
 * moves only once that has actually succeeded. Moving the victim first and
 * then being refused leaves both bodies standing in the same spot, which is the
 * shape the one prior swap in the sibling pack documents having got wrong.
 */
export const R_RANGE = 650;
export const R_SLOW_PCT = 0.35;
export const R_SLOW_MS = 1_500;
/** Was 40s; cut for the practice room's 20s ceiling, kept as the highest cooldown in her kit. */
export const R_COOLDOWN_MS = 17_000;
export const R_MANA = 60;

export default class VengefulSpirit_R extends Spell {
  image = api.asset('spell_vengefulspirit_r');
  name = 'Hoán Đổi Hư Không (VengefulSpirit_R)';
  description =
    `Đổi chỗ tức thì với một tướng địch trong tầm ${R_RANGE}. ` +
    `Mục tiêu bị <span class="buff">làm chậm ${Math.round(R_SLOW_PCT * 100)}%</span> trong ` +
    `<span class="time">${R_SLOW_MS / 1000} giây</span> sau khi hạ cánh. Không gây sát thương.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  range = R_RANGE;

  /** The swap that just happened, for as long as it is drawn. Read by the test. */
  live: VengefulSpirit_R_Object | null = null;

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
      Reach.withinRange(R_RANGE, this.owner, target)
    );
  }

  /**
   * Grounding is checked here as well as inside `blinkOwnerTo`, so a grounded
   * cast is refused before it is charged for rather than being paid for and
   * then doing nothing.
   */
  checkCastCondition(): boolean {
    if (this.owner.grounded) return false;
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

    // Read both ends before either body moves.
    const hers = this.owner.position.copy();
    const theirs = victim.position.copy();

    // Her first, because this is the call that may refuse. See the header.
    if (!this.blinkOwnerTo(theirs.x, theirs.y)) return;
    // `teleportTo` rather than a `Dash`: this is an instant exchange, not a
    // journey, and a dash would have the victim visibly travel a route that the
    // ability does not give them.
    victim.teleportTo(hers.x, hers.y);

    const reeling = new Slow(R_SLOW_MS, this.owner, victim);
    reeling.percent = R_SLOW_PCT;
    // A second swap inside the window rewinds one slow rather than stacking
    // ten deep, which `Slow`'s default add type would.
    reeling.buffAddType = BuffAddType.RENEW_EXISTING;
    reeling.image = this.image;
    reeling.stackId = 'dota_vengefulspirit_r_reel';
    victim.addBuff(reeling);

    const exchange = new VengefulSpirit_R_Object(this.owner);
    exchange.hers = hers;
    exchange.theirs = theirs;
    this.live = exchange;
    this.game.objectManager.addObject(exchange);
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}

/**
 * The exchange, drawn at both ends at once.
 *
 * Two columns and a thread between them, and the thread's travellers move in
 * *opposite* directions along it — that is the one thing the picture has to
 * say, because a swap looks identical to a blink from either end alone. A
 * player who only sees her arrive needs to be told somebody went the other way.
 */
export class VengefulSpirit_R_Object extends SpellObject {
  /** Where she was, and where they were. Set by the spell. */
  hers = createVector(0, 0);
  theirs = createVector(0, 0);

  private ageMs = 0;
  private readonly lifeTime = 460;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /** Spans both ends of the exchange, which is not a square around either. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 60;
    const left = Math.min(this.hers.x, this.theirs.x) - pad;
    const top = Math.min(this.hers.y, this.theirs.y) - pad;
    const right = Math.max(this.hers.x, this.theirs.x) + pad;
    const bottom = Math.max(this.hers.y, this.theirs.y) + pad;
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle every frame.
    return new Rectangle({ x: left, y: top, w: right - left, h: bottom - top, data: this });
  }

  draw(): void {
    const t = Math.min(1, this.ageMs / this.lifeTime);
    const swept = 1 - (1 - t) * (1 - t);
    const fading = 1 - t;

    push();
    // The thread the exchange ran along.
    stroke(178, 140, 240, 130 * fading);
    strokeWeight(2);
    line(this.hers.x, this.hers.y, this.theirs.x, this.theirs.y);

    // Two travellers, crossing. Opposite directions along the same thread is
    // the whole message.
    noStroke();
    for (const [from, to, hue] of [
      [this.hers, this.theirs, 235],
      [this.theirs, this.hers, 170],
    ] as const) {
      const x = lerp(from.x, to.x, swept);
      const y = lerp(from.y, to.y, swept);
      fill(hue, 150, 255, 220 * fading);
      circle(x, y, 16 * (1 - swept * 0.4) + 6);
    }

    // A column at each end: a ring that closes inward on the spot somebody
    // arrived at, so both ends read as a landing rather than a departure.
    noFill();
    for (const end of [this.hers, this.theirs]) {
      stroke(206, 178, 255, 200 * fading);
      strokeWeight(3);
      circle(end.x, end.y, 20 + (1 - swept) * 90);
      stroke(150, 110, 220, 120 * fading);
      strokeWeight(1.5);
      circle(end.x, end.y, 34 + (1 - swept) * 60);
    }
    pop();
  }
}
