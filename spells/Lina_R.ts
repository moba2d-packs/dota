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
const AttackableUnit = api.units.AttackableUnit;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;
const Rectangle = api.utils.Quadtree.Rectangle;
const dmg = api.text.dmg;

/**
 * Lôi Quang Kiếm — one enemy, one bolt, no travel time and no dodge.
 *
 *   press on an enemy in reach -> lightning falls on them and they take it all
 *   press on an ally           -> refused
 *   press on empty ground      -> refused, and she is not charged for it
 *   press on someone too far   -> refused
 *
 * A `UNIT` spell, so it declares `targetTeam: 'ENEMY'`, validates the target in
 * two places and overrides `press()`. None of the three is optional: without
 * `targetTeam` the resolver defaults to `'ANY'`, which includes
 * `request.caster`, and a press over empty ground resolves *her* — four shipped
 * abilities in this engine's history called their ultimate down on their own
 * caster that way, each on the day it was written.
 *
 * The damage is applied at the press. The bolt's descent is 90ms of drawing on
 * top of a hit that has already landed, which is the honest way round for an
 * ability sold as instant: the alternative — damage on the visual's arrival —
 * is a dodge window the player was never told about.
 */
export const R_DAMAGE = 55;
export const R_RANGE = 420;
/** Was 50s; cut for the practice room's 20s ceiling, kept above the rest of her kit so it still reads as the ultimate. */
export const R_COOLDOWN_MS = 18_000;
export const R_MANA = 100;

/** How long the bolt takes to come down. Drawn only; the damage is already done. */
export const R_STRIKE_MS = 90;
/** How long the whole strike stays on screen, scorch included. */
export const R_BOLT_MS = 520;
/** How far above the impact the bolt starts. Drawn only. */
export const R_BOLT_HEIGHT = 260;
/** How far the zigzag wanders off the vertical. Drawn only. */
export const R_BOLT_JITTER = 26;
/** How many segments the zigzag is cut into. Drawn only. */
export const R_BOLT_NODES = 9;

export default class Lina_R extends Spell {
  image = api.asset('spell_lina_r');
  name = 'Lôi Quang Kiếm (Lina_R)';
  description =
    `Giáng một tia sét vào một tướng địch trong tầm ${R_RANGE}, gây ngay lập tức ` +
    `${dmg(R_DAMAGE, 'MAGIC')}.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  range = R_RANGE;

  /** The bolt on screen. Read by the test, and by nothing else. */
  live: Lina_R_Object | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      resource: { commitAt: 'start', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
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
      target instanceof AttackableUnit &&
      !target.isDead &&
      !target.toRemove &&
      // The identity clause and the team clause are two separate refusals, not
      // one written twice: a caster is on her own team, so dropping either one
      // alone still lets her strike herself.
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
    const victim = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(victim)) return;

    const bolt = new Lina_R_Object(this.owner);
    // Pinned where the victim stood at the instant of the strike, not to the
    // victim. The strike *is* that instant — following the body afterwards
    // would drag a fallen bolt across the map behind a runner, and would put
    // it on a corpse's respawn point when the hit killed them.
    bolt.position = victim.position.copy();
    this.live = bolt;
    this.game.objectManager.addObject(bolt);

    victim.takeDamage(R_DAMAGE, this.owner, 'MAGIC');
  }

  drawPreview(): void {
    super.drawPreview(R_RANGE);
  }
}

/**
 * The bolt: one jagged line out of the sky, a white flash where it lands, and
 * a scorch that outlives it by a moment.
 *
 * A `SpellObject` and not `castSpec.vfx`, because it reaches 260px above the
 * impact and well away from her body — `Champion.draw()` is skipped whenever
 * the caster is culled or fogged, and an effect hung there disappears while
 * its damage lands.
 */
export class Lina_R_Object extends SpellObject {
  private ageMs = 0;
  /**
   * The zigzag, seeded once in `onAdded`. A bolt that re-rolls its own kinks
   * every frame is static noise; one that keeps them is a bolt.
   */
  private kinks: number[] = [];

  onAdded(): void {
    for (let i = 0; i <= R_BOLT_NODES; i++) {
      // Straightening to nothing at the bottom, so the strike ends exactly on
      // the victim rather than a jitter's width away from them.
      const down = i / R_BOLT_NODES;
      this.kinks.push(random(-R_BOLT_JITTER, R_BOLT_JITTER) * (1 - down * down));
    }
  }

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= R_BOLT_MS) this.toRemove = true;
  }

  /**
   * Reaches from the impact point up to the top of the bolt, which is not a
   * square around this object's own centre — so it is a hand-built rectangle
   * rather than `squareDisplayBoundingBox`, which would have to be 520px on a
   * side to cover a 260px column and would cull nothing.
   */
  getDisplayBoundingBox(): Rectangle {
    const halfWidth = R_BOLT_JITTER + 40;
    const below = 46;
    return new Rectangle({
      x: this.position.x - halfWidth,
      y: this.position.y - R_BOLT_HEIGHT - 10,
      w: halfWidth * 2,
      h: R_BOLT_HEIGHT + 10 + below,
      data: this,
    });
  }

  draw(): void {
    // `bolt`, `struck`, `falling` — never `line`, `point` or `color`, which are
    // p5 globals in this project and are silently shadowed by a local of the
    // same name.
    const impact = this.position;
    const falling = Math.min(1, this.ageMs / R_STRIKE_MS);
    const spent = Math.min(1, this.ageMs / R_BOLT_MS);
    // The bolt itself is gone long before the scorch is.
    const alive = Math.max(0, 1 - Math.min(1, this.ageMs / (R_BOLT_MS * 0.45)));

    push();
    if (alive > 0) {
      // Drawn top-down as far as the descent has come, so the strike travels
      // rather than appearing whole. Two strokes: a wide gold halo and a thin
      // white core, which is what separates lightning from a painted stripe.
      const reached = Math.ceil(R_BOLT_NODES * falling);
      for (let pass = 0; pass < 2; pass++) {
        noFill();
        stroke(
          255,
          pass === 0 ? 190 : 250,
          pass === 0 ? 70 : 226,
          (pass === 0 ? 180 : 250) * alive
        );
        strokeWeight(pass === 0 ? 11 : 4);
        beginShape();
        for (let i = 0; i <= reached; i++) {
          const down = i / R_BOLT_NODES;
          vertex(impact.x + (this.kinks[i] ?? 0), impact.y - R_BOLT_HEIGHT * (1 - down));
        }
        endShape();
      }
    }

    // The flash lands on the victim, never near them, and eases out — a linear
    // fade reads as a placeholder.
    const struck = Math.max(0, 1 - this.ageMs / 170);
    if (struck > 0) {
      const opened = 1 - (1 - struck) * (1 - struck);
      noStroke();
      fill(255, 253, 238, 240 * struck);
      circle(impact.x, impact.y, 22 + (1 - opened) * 54);
    }

    // The scorch, outlasting both. Small, and on the same layer as the strike
    // on purpose: it is the last 300ms of one event, not a decal left behind.
    noStroke();
    fill(92, 44, 22, 130 * (1 - spent));
    circle(impact.x, impact.y, 34);
    pop();
  }
}
