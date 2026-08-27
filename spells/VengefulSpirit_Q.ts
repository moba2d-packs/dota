import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const HomingMissileSpellObject = api.HomingMissileSpellObject;
const Unit = api.units.AttackableUnit;
const Stun = api.buffs.Stun;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;

/**
 * Tên Lửa Phép — a bolt of spite that does not miss.
 *
 *   press on an enemy within 420 -> the bolt leaves her and turns after them
 *   they run                     -> it turns again; that is the whole point
 *   it arrives                   -> damage, and they are stunned
 *   they die on the way          -> it goes out rather than hitting a corpse
 *
 * ## Why homing rather than a skillshot
 *
 * Magic Missile is Dota's answer to "I need this person stunned *now*", and
 * every other ability in this pack that stuns is aimed. Making this one a
 * skillshot too would be a fourth version of a shape the pack already has
 * three of, and it would take away the one thing the ability is for.
 * `HomingMissileSpellObject` is the engine's expression of that: it re-aims at
 * the target's live position every frame in `onBeforeMove` and calls
 * `onTargetArrive` when the swept step actually reaches them, rather than
 * flying to a point they have already left.
 *
 * `maxHitCount` stays at the base class's `0`, which is what makes the bolt
 * pass through everyone standing between her and the person she picked.
 */
export const Q_DAMAGE = 25;
export const Q_RANGE = 420;
export const Q_SPEED = 14;
export const Q_STUN_MS = 1_400;
export const Q_COOLDOWN_MS = 11_000;
export const Q_MANA = 35;

export default class VengefulSpirit_Q extends Spell {
  image = api.asset('spell_vengefulspirit_q');
  name = 'Tên Lửa Phép (VengefulSpirit_Q)';
  description =
    `Bắn một tia phép đuổi theo một tướng địch, gây ` +
    `<span class="damage">${Q_DAMAGE} sát thương phép</span> và ` +
    `<span class="buff">choáng ${Q_STUN_MS / 1000} giây</span>. Tia phép không bao giờ trượt.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  range = Q_RANGE;

  /** The bolt in flight, for as long as one is. Read by the test. */
  live: VengefulSpirit_Q_Object | null = null;

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
      Reach.withinRange(Q_RANGE, this.owner, target)
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

    const bolt = new VengefulSpirit_Q_Object(this.owner, victim);
    bolt.position = this.owner.position.copy();
    this.live = bolt;
    this.game.objectManager.addObject(bolt);
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}

/**
 * The bolt: a spectral wedge with a wake that lags behind its turns.
 *
 * The wake is the part that carries information — it is what makes a *homing*
 * missile look homing rather than like a bolt that happened to be aimed well.
 * It is a short trail of previous positions, so every turn the bolt makes bends
 * visibly behind it.
 */
export class VengefulSpirit_Q_Object extends HomingMissileSpellObject {
  speed = Q_SPEED;
  size = 18;

  /** The last few places it has been. Seeded empty; pushed once per frame. */
  private wake: { x: number; y: number }[] = [];

  onTargetArrive(target: AttackableUnit): void {
    target.takeDamage(Q_DAMAGE, this.owner, 'MAGIC', 'Tên Lửa Phép');
    // After the damage: a target this killed is already dead, and `addBuff`
    // refuses a corpse rather than leaving a stun on one.
    if (target.isDead) return;
    // Keeps `Stun`'s own icon — it is drawn on the victim, not just in the
    // HUD. See the note in `Earthshaker_E.ts`.
    const held = new Stun(Q_STUN_MS, this.owner, target);
    held.stackId = 'dota_vengefulspirit_q_stun';
    target.addBuff(held);
  }

  update(): void {
    this.wake.push({ x: this.position.x, y: this.position.y });
    if (this.wake.length > 9) this.wake.shift();
    super.update();
  }

  draw(): void {
    const head = this.position;
    push();
    // The wake first, so the head paints over its own oldest tail rather than
    // under it.
    noFill();
    strokeCap(ROUND);
    for (let i = 0; i < this.wake.length - 1; i++) {
      const along = i / Math.max(1, this.wake.length - 1);
      stroke(150, 130, 235, 30 + along * 120);
      strokeWeight(2 + along * 5);
      line(this.wake[i].x, this.wake[i].y, this.wake[i + 1].x, this.wake[i + 1].y);
    }

    // The head, pointed the way it is actually travelling — read off the wake
    // rather than off the target, so a bolt mid-turn points along its own path.
    const previous = this.wake[this.wake.length - 2] ?? head;
    const heading = Math.atan2(head.y - previous.y, head.x - previous.x);
    translate(head.x, head.y);
    rotate(heading);
    noStroke();
    fill(206, 190, 255, 240);
    // A narrow wedge: this pack already has round bolts, and a spirit's spite
    // should not read as another fireball.
    beginShape();
    vertex(11, 0);
    vertex(-6, -6);
    vertex(-2, 0);
    vertex(-6, 6);
    endShape(CLOSE);
    fill(255, 255, 255, 200);
    circle(3, 0, 5);
    pop();
  }
}
