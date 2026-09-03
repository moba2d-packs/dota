import type {
  AttackableUnit,
  Buff,
  CastContext,
  CastSpec,
  CancelReason,
  Rectangle,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Unit = api.units.AttackableUnit;
const Untargetable = api.buffs.Untargetable;
const Circle = api.utils.Quadtree.Circle;
const RectangleArea = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;
const SpellForm = api.enums.SpellForm;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;

/**
 * Đao Vô Song — he vanishes, and for a second and a bit he is only ever beside
 * somebody, cutting them.
 *
 *   press on an enemy in reach -> he is standing next to them, and they are cut
 *   every 300ms, three more    -> whoever is nearest him now is cut instead
 *   the whole 1200ms           -> nothing can target him
 *
 * `R_DAMAGE_PER_STRIKE * R_STRIKES` = **56**, the top of the ultimate band
 * against a ~100 health pool. Against one enemy alone all four land on them;
 * in a crowd it re-picks the nearest each time, which is what makes it a
 * teamfight ultimate rather than a single-target execute.
 *
 * ## A `UNIT` spell, and the three things that are not optional
 *
 * `targetTeam: 'ENEMY'`, a validated target, and an overridden `press()`.
 * Without the first, `TargetResolver` defaults to `'ANY'`, which includes
 * `request.caster` — and with the cursor on empty ground the
 * nearest-to-cursor fallback resolves *him*, so the ultimate blinks him beside
 * himself and cuts him four times. Four shipped abilities in this engine's
 * history did exactly that, each on the day it was written.
 *
 * ## Why the sequence is in `onUpdate` and not in the object
 *
 * Every strike is a *blink*, and `Spell.blinkOwnerTo` is where blinking lives:
 * it is the one place `Ground` is enforced, and a spell that reached for
 * `owner.teleportTo` itself would opt out of that rule silently. So the clock
 * that fires the strikes sits beside the thing it has to call. The object
 * beside it is the picture — the cuts and the trail — and holds no rules.
 *
 * ## The Untargetable is the thing that must never leak
 *
 * Every path out of the ability takes it off again: the window ending
 * (`onComplete`), an early end (`onCancel`), the scene going away
 * (`deactivate`) and the spell being dropped off a champion (`onRemoved`).
 * `endSlashing` is idempotent, because two of those four run back to back —
 * `deactivate()` calls `runtime.cancel('SCENE_EXIT')`, which reaches
 * `onCancel`, before this class's own override gets to run. A champion left
 * permanently untargetable is not a bug a player can work around.
 */
export const R_RANGE = 300;
export const R_DURATION_MS = 1_200;
export const R_STRIKES = 4;
export const R_DAMAGE_PER_STRIKE = 14;
/** How far he looks for the next body once he is already in there. */
export const R_STRIKE_RADIUS = 220;
/** Where he lands relative to the body he is cutting — beside it, not on it. */
export const R_BLINK_OFFSET_PX = 46;
export const R_COOLDOWN_MS = 60_000;
export const R_MANA = 100;

/** 1200 / 4 — the first lands on the press, the rest at 300, 600 and 900. */
export const R_STRIKE_INTERVAL_MS = R_DURATION_MS / R_STRIKES;
/** `R_DAMAGE_PER_STRIKE * R_STRIKES` — 56, the top of the ultimate band. */
export const R_TOTAL_DAMAGE = R_DAMAGE_PER_STRIKE * R_STRIKES;

export default class Juggernaut_R extends Spell {
  image = api.asset('spell_juggernaut_r');
  name = 'Đao Vô Song (Juggernaut_R)';
  description =
    `Juggernaut lao đến mục tiêu và chém <span class="buff">${R_STRIKES} lần</span> trong ` +
    `<span class="time">${R_DURATION_MS / 1000} giây</span>, mỗi nhát ` +
    `${dmg(R_DAMAGE_PER_STRIKE, 'PHYSICAL')} lên kẻ địch gần nhất ` +
    `(tổng ${dmgValue(R_TOTAL_DAMAGE, 'PHYSICAL')}). Trong lúc đó anh không thể bị chọn làm mục tiêu.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  range = R_RANGE;

  /** The cuts and the trail. Null whenever nothing is in flight. */
  slashes: Juggernaut_R_Object | null = null;
  /** Held so an early end can take it off rather than leaving it to time out. */
  private ungrabbable: Buff | null = null;
  private elapsedMs = 0;
  /** How many of `R_STRIKES` have landed. Read by the test. */
  strikesLanded = 0;
  /** Which side of the first victim he came in on, so the circling reads as one path. */
  private entryAngle = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      // The runtime holds the activation open for exactly the sequence, so it
      // is the runtime that calls `onComplete` at 1200ms.
      active: { maxDurationMs: R_DURATION_MS },
      resource: { commitAt: 'start', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
      // `INDEPENDENT`: he is untargetable and mid-blink for the whole window.
      // Nothing should be able to reach in and stop it, and the default `HELD`
      // ends on movement — which a blink is.
      interrupts: SpellForm.INDEPENDENT,
    };
  }

  /** Caster-centred and both bodies are wide, so `Reach` owns the number rather than the literal. */
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
    const first = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(first)) return;

    this.endSlashing();
    this.elapsedMs = 0;
    this.strikesLanded = 0;
    // The side he came in on. Every later blink steps a quarter-turn round
    // from here, so the afterimage trail reads as one continuous path rather
    // than four teleports to the same spot.
    this.entryAngle = Math.atan2(
      this.owner.position.y - first.position.y,
      this.owner.position.x - first.position.x
    );

    const ungrabbable = new Untargetable(R_DURATION_MS, this.owner, this.owner);
    ungrabbable.image = this.image;
    // Without an id every bare Untargetable in the match shares one stack pool.
    ungrabbable.stackId = 'dota_juggernaut_r_untargetable';
    this.owner.addBuff(ungrabbable);
    this.ungrabbable = ungrabbable;

    const slashes = new Juggernaut_R_Object(this.owner);
    this.slashes = slashes;
    this.game.objectManager.addObject(slashes);

    // The first cut is the press: he is standing beside them before the player
    // has let go of the key.
    this.strikeAt(first);
  }

  onUpdate(): void {
    if (this.state !== 'ACTIVE') return;
    this.elapsedMs += Math.max(0, deltaTime);

    // Scheduled off elapsed time rather than a "since last strike"
    // accumulator, so the four land at 0, 300, 600 and 900 whatever the frame
    // lengths were and a long frame cannot swallow one.
    while (
      this.strikesLanded < R_STRIKES &&
      this.strikesLanded * R_STRIKE_INTERVAL_MS <= this.elapsedMs
    ) {
      const victim = this.nearestEnemy();
      if (!victim) {
        // Nobody left in reach. The strike is spent rather than banked — a
        // held-back strike would fire four at once the moment somebody walked
        // back into range.
        this.strikesLanded += 1;
        continue;
      }
      this.strikeAt(victim);
    }
  }

  /**
   * One cut: he lands beside them and they take it, exactly once.
   *
   * There is no cross-strike hit set here, and that is the ability rather than
   * an oversight: four cuts on a lone target *is* the 56. The set rule guards a
   * sweep that passes through a body several times in one motion, and each of
   * these is a separate strike with its own 300ms and its own re-pick.
   */
  private strikeAt(victim: AttackableUnit): void {
    const around = this.entryAngle + this.strikesLanded * (TWO_PI / R_STRIKES);
    // `blinkOwnerTo` and never `owner.teleportTo`: it is the one place
    // `Ground` is enforced. A refused blink still cuts — being rooted in place
    // should cost him the repositioning, not the ultimate.
    this.blinkOwnerTo(
      victim.position.x + Math.cos(around) * R_BLINK_OFFSET_PX,
      victim.position.y + Math.sin(around) * R_BLINK_OFFSET_PX
    );

    victim.takeDamage(R_DAMAGE_PER_STRIKE, this.owner, 'PHYSICAL');
    this.strikesLanded += 1;
    this.slashes?.strike(victim, this.owner.position.x, this.owner.position.y);
  }

  /** The nearest body he may cut, from where he is standing right now. */
  private nearestEnemy(): AttackableUnit | null {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: R_STRIKE_RADIUS,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        // This *picks* a unit out of a query, which is acquisition, so it takes
        // the vision seam — without it he would find a body through a wall and
        // blink to it, which is the exact bug a wall-piercing leap once shipped.
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    let nearest: AttackableUnit | null = null;
    let closest = Infinity;
    for (const candidate of candidates) {
      const gap = this.owner.position.dist(candidate.position);
      if (gap >= closest) continue;
      closest = gap;
      nearest = candidate;
    }
    return nearest;
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.endSlashing();
  }

  onComplete(): void {
    this.endSlashing();
  }

  deactivate(): void {
    this.endSlashing();
    super.deactivate();
  }

  onRemoved(): void {
    this.endSlashing();
    super.onRemoved();
  }

  /** Idempotent: four teardown paths reach it and two of them run back to back. */
  private endSlashing(): void {
    if (this.slashes) {
      this.slashes.toRemove = true;
      this.slashes = null;
    }
    if (this.ungrabbable) {
      // He is targetable again the instant the sequence ends, however it
      // ended. A buff left to time out on its own would outlive a sequence a
      // cancel cut short, and there is no way for a player to work around a
      // champion nothing can click.
      this.ungrabbable.deactivateBuff?.();
      this.ungrabbable = null;
    }
  }
}

/** How long one cut stays on the body it was made on. */
const CUT_LIFE_MS = 260;
/** How long one afterimage stays where he stood. Under the window, so the trail has drained by the end of it. */
const GHOST_LIFE_MS = 520;

/**
 * The picture: a cut on each body he reached, and the path he took between
 * them.
 *
 * A `SpellObject` rather than caster VFX, because both halves reach well past
 * his own body — `Champion.draw()` is skipped whenever `ObjectManager` culls
 * or fogs him, and an effect hung there disappears while the damage lands.
 */
export class Juggernaut_R_Object extends SpellObject {
  /** Where each cut landed, on whose body, and which way the blade went. */
  private cuts: { victim: AttackableUnit; ageMs: number; tilt: number }[] = [];
  /** Where he has stood, oldest first — the afterimage trail. */
  private ghosts: { x: number; y: number; ageMs: number }[] = [];

  onAdded(): void {
    this.position = this.owner.position.copy();
  }

  /** Called by the spell as each cut lands, with the body and where he was standing when he made it. */
  strike(victim: AttackableUnit, fromX: number, fromY: number): void {
    // Rolled once, here, and kept: `random()` inside `draw` re-rolls every
    // frame and the mark boils instead of sitting on the wound.
    this.cuts.push({ victim, ageMs: 0, tilt: random(-0.8, 0.8) });
    this.ghosts.push({ x: fromX, y: fromY, ageMs: 0 });
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    for (const cut of this.cuts) cut.ageMs += step;
    for (const ghost of this.ghosts) ghost.ageMs += step;
    this.cuts = this.cuts.filter(
      cut => cut.ageMs < CUT_LIFE_MS && !cut.victim.isDead && !cut.victim.toRemove
    );
    this.ghosts = this.ghosts.filter(ghost => ghost.ageMs < GHOST_LIFE_MS);
  }

  /**
   * Spans him, every body he has cut and every place he has stood. A real
   * `Rectangle` and not the square helper: the helper is centred on this
   * object and cannot watch a list of other people's positions.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = 50;
    let left = this.position.x;
    let top = this.position.y;
    let right = this.position.x;
    let bottom = this.position.y;
    const stretch = (x: number, y: number): void => {
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    };
    for (const cut of this.cuts) stretch(cut.victim.position.x, cut.victim.position.y);
    for (const ghost of this.ghosts) stretch(ghost.x, ghost.y);
    // **`data: this` is not optional.** `ObjectManager` puts this rectangle
    // straight into the display quadtree and the draw pass reads
    // `entry.data.zIndex` back off it — omit it and every frame throws
    // "Cannot read properties of undefined (reading 'zIndex')" out of
    // `ObjectManager.draw`, which the game catches and turns into an in-game
    // banner rather than a page error. Neither `verify` nor a Playwright
    // page-error check can see that; it was found by looking at a screenshot.
    // `squareDisplayBoundingBox` fills the field in for you, which is why the
    // hand-rolled branch is the only one that can get it wrong.
    return new RectangleArea({
      x: left - pad,
      y: top - pad,
      w: right - left + pad * 2,
      h: bottom - top + pad * 2, data: this });
  }

  draw(): void {
    push();

    // The path first, under everything: a line from each place he stood to the
    // next, then a fading silhouette at each. This is the half that says
    // *where he went*, which four identical slashes in one place would not.
    for (let i = 0; i < this.ghosts.length; i++) {
      const ghost = this.ghosts[i];
      const fading = 1 - ghost.ageMs / GHOST_LIFE_MS;
      const next = i + 1 < this.ghosts.length ? this.ghosts[i + 1] : null;
      if (next) {
        stroke(120, 245, 200, 120 * fading);
        strokeWeight(3);
        line(ghost.x, ghost.y, next.x, next.y);
      }
      noFill();
      stroke(150, 250, 210, 190 * fading);
      strokeWeight(2);
      circle(ghost.x, ghost.y, 34 * fading + 12);
    }

    // The cuts, each on the body it was made on, so the impact lands on the
    // victim rather than somewhere near them.
    for (const cut of this.cuts) {
      const struck = cut.victim.position;
      // `1 - (1 - t) * (1 - t)` — opens fast and fades, the way a cut does.
      const through = cut.ageMs / CUT_LIFE_MS;
      const opened = 1 - (1 - through) * (1 - through);
      const fading = 1 - through;
      const reach = 16 + opened * 26;
      const swept = Math.cos(cut.tilt) * reach;
      const rise = Math.sin(cut.tilt) * reach;

      stroke(15, 45, 38, 170 * fading);
      strokeWeight(9);
      line(struck.x - swept, struck.y - rise, struck.x + swept, struck.y + rise);
      stroke(235, 255, 245, 250 * fading);
      strokeWeight(4);
      line(struck.x - swept, struck.y - rise, struck.x + swept, struck.y + rise);
      noStroke();
      fill(120, 245, 200, 200 * fading);
      circle(struck.x, struck.y, 14 * fading + 6);
    }
    pop();
  }
}
