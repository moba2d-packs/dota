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
const Root = api.buffs.Root;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;

/**
 * Băng Giá — she picks one enemy and freezes their feet to the ground.
 *
 *   press on an enemy within 380 -> the shell closes on them and they are rooted
 *   every 450ms                  -> the shell cracks and takes a bite out of them
 *   the root runs out            -> four bites later, the shell falls away
 *   they die first               -> it stops on that tick, mid-sequence
 *
 * A `UNIT` spell, so it declares `targetTeam: 'ENEMY'`, validates the target
 * and overrides `press()`. None of the three is optional: without `targetTeam`
 * the resolver defaults to `'ANY'`, which includes `request.caster`, and a
 * press over empty ground then resolves *her* — the ability roots and eats the
 * person who cast it. Four shipped abilities in this engine's history did
 * exactly that.
 *
 * ## Why the ticks live on a `SpellObject` and not on this spell
 *
 * The activation is instant — `PRESS`, no channel, no active window — so the
 * runtime runs `onSpellCast` and `onComplete` inside the same keypress and the
 * spell is in `COOLDOWN` before the first tick is due. A clock kept here would
 * have to be nursed through a state the runtime considers finished. The shell
 * rides the victim instead and keeps its own clock, which also gives the one
 * behaviour a spell-side clock gets wrong: it stops the moment the victim
 * dies, rather than swinging at a corpse for the rest of the root.
 *
 * That is also why `shell` is dropped in `deactivate`/`onRemoved` only. Hanging
 * the teardown on `onComplete` — the shape `Pudge_R` uses, correctly, for a
 * channel — would delete the shell in the same tick it was created.
 */
export const W_TICK_MS = 450;
export const W_TICKS = 4;
export const W_DAMAGE_PER_TICK = 6;
export const W_ROOT_MS = W_TICK_MS * W_TICKS;
export const W_RANGE = 380;
export const W_COOLDOWN_MS = 9_000;
export const W_MANA = 40;

/** `W_DAMAGE_PER_TICK * W_TICKS` — 24, inside the 15–35 band a normal ability belongs in. */
export const W_TOTAL_DAMAGE = W_DAMAGE_PER_TICK * W_TICKS;

export default class CrystalMaiden_W extends Spell {
  image = api.asset('spell_crystalmaiden_w');
  name = 'Băng Giá (CrystalMaiden_W)';
  description =
    `Đóng băng chân một tướng địch trong <span class="time">${W_ROOT_MS / 1000} giây</span>, ` +
    `gây ${dmg(W_DAMAGE_PER_TICK, 'MAGIC')} mỗi ` +
    `<span class="time">${W_TICK_MS / 1000} giây</span> ` +
    `(tổng ${dmgValue(W_TOTAL_DAMAGE, 'MAGIC')}).`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  range = W_RANGE;

  /** The live shell, for as long as one is out. Read by the test, and by teardown. */
  shell: CrystalMaiden_W_Object | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
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
      target instanceof AttackableUnit &&
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

    const frozen = new Root(W_ROOT_MS, this.owner, victim);
    frozen.image = this.image;
    // Without an id it shares one stack pool with every other bare Root in the
    // match, so somebody else's root would refresh — or evict — this one.
    frozen.stackId = 'dota_crystalmaiden_w_root';
    victim.addBuff(frozen);

    this.dropShell();
    const shell = new CrystalMaiden_W_Object(this.owner, victim);
    this.shell = shell;
    // Tied to the body it rides and to the buff it illustrates: `addBuff` does
    // not always keep the instance it was handed, so the shell resolves
    // whatever actually landed rather than watching an instance nobody ticks.
    shell.attachTo(victim, frozen);
    this.game.objectManager.addObject(shell);
  }

  deactivate(): void {
    this.dropShell();
    super.deactivate();
  }

  onRemoved(): void {
    this.dropShell();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is out. */
  private dropShell(): void {
    if (!this.shell) return;
    this.shell.toRemove = true;
    this.shell = null;
  }
}

/**
 * The shell: spikes closing **inward** on the victim, and a crack across their
 * body on every bite.
 *
 * Deliberately the opposite motion to Q, which throws its shards outward from
 * a point on the ground. Two abilities in the same kit that both mean "ice"
 * have to be told apart in a fight by their movement, not their colour.
 *
 * It owns the damage clock as well as the drawing — see the spell's header for
 * why — so it is the thing that stops when the victim dies.
 */
export class CrystalMaiden_W_Object extends SpellObject {
  readonly victim: AttackableUnit;
  ticksDone = 0;
  private ageMs = 0;
  private sinceTickMs = 0;
  private sinceCrackMs = 9_999;

  /**
   * Seeded at construction rather than in `onAdded`: `addObject` only calls
   * `onAdded` on the next `ObjectManager.update`, and re-rolling in `draw`
   * would make the shell shimmer instead of close.
   */
  private spikes: { angle: number; length: number; width: number }[] = [];
  private cracks: { angle: number; reach: number }[] = [];

  constructor(owner: AttackableUnit, victim: AttackableUnit) {
    super(owner);
    this.victim = victim;
    for (let i = 0; i < 10; i++) {
      const spoke = (i / 10) * Math.PI * 2;
      this.spikes.push({
        angle: spoke + random(-0.1, 0.1),
        length: random(26, 40),
        width: random(6, 11),
      });
    }
    for (let i = 0; i < 5; i++) {
      this.cracks.push({ angle: random(0, Math.PI * 2), reach: random(10, 22) });
    }
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    if (this.victim.isDead || this.victim.toRemove) {
      this.toRemove = true;
      return;
    }

    this.position.set(this.victim.position.x, this.victim.position.y);
    const step = Math.max(0, deltaTime);
    this.ageMs += step;
    this.sinceTickMs += step;
    this.sinceCrackMs += step;

    while (this.sinceTickMs >= W_TICK_MS && this.ticksDone < W_TICKS) {
      this.sinceTickMs -= W_TICK_MS;
      this.ticksDone += 1;
      this.sinceCrackMs = 0;
      this.victim.takeDamage(W_DAMAGE_PER_TICK, this.owner, 'MAGIC');
      // A corpse takes no more bites, and the shell is not drawn on one.
      if (this.victim.isDead || this.victim.toRemove) {
        this.toRemove = true;
        return;
      }
    }

    if (this.ticksDone >= W_TICKS || this.ageMs >= W_ROOT_MS) this.toRemove = true;
  }

  /** Rides the victim, so the box is a square around this object's own centre. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(140);
  }

  draw(): void {
    const held = this.position;
    const body = this.victim.animatedValues?.displaySize ?? 40;
    // How far through the closing we are: the spikes start out wide and drive
    // in. `1 - (1 - t)^2` snaps them shut rather than drifting.
    const closing = Math.min(1, this.ageMs / 260);
    const shut = 1 - (1 - closing) * (1 - closing);
    const bite = Math.max(0, 1 - this.sinceCrackMs / 200);

    push();
    // The shell itself, hugging the body.
    noFill();
    stroke(190, 232, 255, 200 + bite * 55);
    strokeWeight(2.5 + bite * 2.5);
    circle(held.x, held.y, body + 16 - shut * 6);

    // Spikes pointing **at** them: the tip is on the body and the base is out
    // where the spike came from, so the whole shape reads as an inward drive.
    noStroke();
    for (const spike of this.spikes) {
      const standoff = body / 2 + 2;
      const base = standoff + spike.length * (1 - shut);
      const tipX = held.x + Math.cos(spike.angle) * standoff;
      const tipY = held.y + Math.sin(spike.angle) * standoff;
      const side = spike.angle + Math.PI / 2;
      const across = spike.width * (0.4 + 0.6 * (1 - shut));

      fill(224, 246, 255, 210 + bite * 45);
      beginShape();
      vertex(tipX, tipY);
      vertex(
        held.x + Math.cos(spike.angle) * base + Math.cos(side) * across,
        held.y + Math.sin(spike.angle) * base + Math.sin(side) * across
      );
      vertex(
        held.x + Math.cos(spike.angle) * base - Math.cos(side) * across,
        held.y + Math.sin(spike.angle) * base - Math.sin(side) * across
      );
      endShape(CLOSE);
    }

    // The bite lands **on** the victim, never beside them: a white flash across
    // the body plus fracture lines that open out of it.
    if (bite > 0) {
      const opened = 1 - (1 - bite) * (1 - bite);
      noStroke();
      fill(255, 255, 255, 150 * bite);
      circle(held.x, held.y, body * 0.7 * opened + 6);
      stroke(255, 255, 255, 230 * bite);
      strokeWeight(2);
      for (const crack of this.cracks) {
        const reach = crack.reach * opened;
        line(
          held.x - Math.cos(crack.angle) * reach * 0.4,
          held.y - Math.sin(crack.angle) * reach * 0.4,
          held.x + Math.cos(crack.angle) * reach,
          held.y + Math.sin(crack.angle) * reach
        );
      }
    }
    pop();
  }
}
