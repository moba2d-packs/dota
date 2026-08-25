import type {
  AttackableUnit,
  Buff,
  CastContext,
  CastSpec,
  CancelReason,
  Rectangle,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Disarm = api.buffs.Disarm;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Cuồng Đao — he opens up into a spinning wall of blades and walks around
 * inside it.
 *
 *   press          -> the blades open on a 150 ring and turn with him
 *   every 400ms    -> everything hostile inside the ring is cut
 *   for 3 seconds  -> and he cannot swing his sword, because it is already busy
 *
 * ## The arithmetic, stated because the total is above the burst band
 *
 * A tick lands the moment the blades open and one every `Q_TICK_MS` after, so
 * `ceil(3000 / 400)` = **8** of them fit inside the spin: 8 x 6 = **48** to
 * somebody who stands in all of it. `docs/VFX_STANDARD.md`'s 15-35 band prices
 * a *burst* — a nuke that lands whether you react or not — and this is the
 * other kind of number entirely: every one of those eight ticks is a separate
 * 400ms in which the victim could have walked 150px and taken nothing. The
 * instantaneous payload is 6, which is what the band is really about, and the
 * full 48 is only ever paid by someone who chose to stand still for three
 * seconds. `Juggernaut_Q.test.ts` asserts both halves.
 *
 * ## Why the tick loop lives in the object and not the spell
 *
 * `Pudge_W` ticks from `Spell.onUpdate` because a toggle *is* the spell being
 * held — end the spell and the cloud must stop that instant. This one is a
 * fixed three seconds that the runtime itself ends (`active.maxDurationMs`),
 * and the object is what the player is looking at. Putting the clock where the
 * art is means the damage and the flash on the rim cannot drift apart by a
 * frame, and the spin keeps its own time whatever the runtime state does.
 *
 * ## Why `TETHERED`
 *
 * He must be able to *walk* while spinning — that is the whole ability — so
 * `HELD` (the default, `move: true`) would end it on his first step.
 * `TETHERED` is the form that says exactly this: the effect stands in the
 * world bound to his body, he may walk and be shoved, and losing control of
 * himself still ends it. Being stunned out of a Blade Fury is legible; being
 * stunned out of it by pressing D is not.
 */
export const Q_DURATION_MS = 3_000;
export const Q_TICK_MS = 400;
export const Q_DAMAGE_PER_TICK = 6;
export const Q_RADIUS = 150;
export const Q_COOLDOWN_MS = 12_000;
export const Q_MANA = 50;

/**
 * One at `age = 0` and one every `Q_TICK_MS` after, for as long as the spin
 * lasts — `ceil` rather than `floor` because the opening tick is free.
 */
export const Q_TICKS = Math.ceil(Q_DURATION_MS / Q_TICK_MS);
/** What a body that never leaves the ring pays in total. See the header. */
export const Q_MAX_TOTAL_DAMAGE = Q_DAMAGE_PER_TICK * Q_TICKS;

export default class Juggernaut_Q extends Spell {
  image = api.asset('spell_juggernaut_q');
  name = 'Cuồng Đao (Juggernaut_Q)';
  description =
    `Juggernaut xoay tròn trong <span class="time">${Q_DURATION_MS / 1000} giây</span>, ` +
    `gây <span class="damage">${Q_DAMAGE_PER_TICK} sát thương</span> mỗi ` +
    `<span class="time">${Q_TICK_MS / 1000} giây</span> cho mọi kẻ địch trong bán kính ` +
    `${Q_RADIUS} (tối đa <span class="damage">${Q_MAX_TOTAL_DAMAGE}</span>). ` +
    `Trong lúc xoay anh không thể đánh thường.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'SELF' as const;
  range = Q_RADIUS;

  /** The live spin, for cleanup and for the test. Null whenever nothing is spinning. */
  spin: Juggernaut_Q_Object | null = null;
  /** The disarm this cast applied, so an early end re-arms him instead of leaving it to time out. */
  private busyHands: Buff | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      // The runtime holds the activation open for exactly the spin, so it is
      // the runtime that calls `onComplete` when the three seconds are up —
      // nothing here has to count them a second time.
      active: { maxDurationMs: Q_DURATION_MS },
      resource: { commitAt: 'start', refundOn: [] },
      // From the press, not from the end: three seconds of spin followed by a
      // twelve-second wait is a fifteen-second ability wearing a twelve on its
      // icon, and the player reads the icon.
      cooldown: { startAt: 'start', durationMs: this.coolDown },
      interrupts: SpellForm.TETHERED,
    };
  }

  onSpellCast(): void {
    const spin = new Juggernaut_Q_Object(this.owner);
    this.spin = spin;
    this.game.objectManager.addObject(spin);

    // Disarm, not silence and not root: the one thing a spinning Juggernaut
    // cannot do is swing the sword he is spinning with. `Disarm` leaves
    // `CAN_MOVE` and `CAN_CAST` alone, which is exactly the shape wanted.
    const busyHands = new Disarm(Q_DURATION_MS, this.owner, this.owner);
    busyHands.image = this.image;
    // Without an id every bare Disarm in the match shares one stack pool, so
    // an enemy's disarm would refresh — and be refreshed by — this one.
    busyHands.stackId = 'dota_juggernaut_q_disarm';
    this.owner.addBuff(busyHands);
    this.busyHands = busyHands;
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.stopSpinning();
  }

  onComplete(): void {
    this.stopSpinning();
  }

  deactivate(): void {
    this.stopSpinning();
    super.deactivate();
  }

  onRemoved(): void {
    this.stopSpinning();
    super.onRemoved();
  }

  /** Idempotent: four teardown paths reach it and two of them run back to back. */
  private stopSpinning(): void {
    if (this.spin) {
      this.spin.toRemove = true;
      this.spin = null;
    }
    if (this.busyHands) {
      // He gets his sword back the moment the spin ends, however it ended. A
      // disarm left to time out on its own would outlive a spin a stun cut
      // short.
      this.busyHands.deactivateBuff?.();
      this.busyHands = null;
    }
  }

  drawPreview(): void {
    super.drawPreview(Q_RADIUS);
  }
}

/**
 * The blades. A `SpellObject` rather than caster VFX because it reaches
 * `Q_RADIUS` past his body, and `Champion.draw()` is skipped whenever
 * `ObjectManager` culls or fogs him — which would leave the damage landing
 * inside an invisible ring.
 */
export class Juggernaut_Q_Object extends SpellObject {
  /** Ground art: `Z_INDEX_MAP` is keyed by exact constructor, so a subclass names its own layer or falls to 99, above the feet of everyone standing in it. */
  zIndex = GROUND_Z_INDEX;

  /** How long the blades have been out. Drives both the tick clock and the rotation. */
  age = 0;
  private ticksFired = 0;
  private sincePulseMs = 9_999;
  /** Seeded once in `onAdded`. `random()` inside `draw` re-rolls per frame and boils. */
  private blades: { offset: number; reach: number; rate: number }[] = [];

  onAdded(): void {
    this.position = this.owner.position.copy();
    // Four blades, evenly spaced so the ring reads as a solid wall rather than
    // a crowd, each drifting at its own rate so the wheel does not look rigid.
    for (let i = 0; i < 4; i++) {
      this.blades.push({
        offset: (i / 4) * TWO_PI,
        reach: random(0.86, 1),
        rate: random(0.0042, 0.0052),
      });
    }
  }

  /** The rim flashes at the instant the damage lands, so the reach is never a guess. */
  pulse(): void {
    this.sincePulseMs = 0;
  }

  update(): void {
    if (this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    // Scheduled off `age` rather than a "time since last tick" accumulator, so
    // eight ticks land at 0, 400 … 2800 whatever the frame lengths were and a
    // long frame cannot swallow one.
    while (this.ticksFired < Q_TICKS && this.ticksFired * Q_TICK_MS <= this.age) {
      this.ticksFired += 1;
      this.tick();
    }

    const step = Math.max(0, deltaTime);
    this.age += step;
    this.sincePulseMs += step;
    if (this.age >= Q_DURATION_MS) this.toRemove = true;
  }

  /** One sweep of the blades: everything hostile inside the ring is cut once. */
  private tick(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: Q_RADIUS }),
      // No vision filter. This damages everything the ring overlaps rather
      // than picking a unit out of it, so an enemy standing in an unlit bush
      // beside him is cut exactly like one standing in the open — vision gates
      // acquisition, never damage.
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) victim.takeDamage(Q_DAMAGE_PER_TICK, this.owner);
    this.pulse();
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((Q_RADIUS + 24) * 2);
  }

  draw(): void {
    const centre = this.position;
    // 1 at the instant a tick lands, 0 a fifth of a second later.
    const struck = Math.max(0, 1 - this.sincePulseMs / 200);
    // Winds in over the first 180ms rather than popping into existence at full
    // size — `t * t`, so the blades come out fast at the end of the windup.
    const opened = Math.min(1, this.age / 180) ** 2;
    const edge = Q_RADIUS * opened;

    push();

    // The jade wash, so the area is readable at a glance even between ticks.
    noStroke();
    fill(60, 190, 150, 26 + struck * 22);
    circle(centre.x, centre.y, edge * 2);

    // Four blades, each a tapered sweep ending exactly on the rim. Named for
    // what they are in the effect: `line` and `point` are p5 globals and a
    // local of either name would silently shadow one.
    for (const swept of this.blades) {
      const angle = swept.offset + this.age * swept.rate;
      const tipX = centre.x + Math.cos(angle) * edge * swept.reach;
      const tipY = centre.y + Math.sin(angle) * edge * swept.reach;
      const hiltX = centre.x + Math.cos(angle) * edge * 0.3;
      const hiltY = centre.y + Math.sin(angle) * edge * 0.3;

      // The trail the blade has just come through, so the spin has a direction.
      const trailAngle = angle - 0.55;
      stroke(60, 190, 150, 70);
      strokeWeight(3);
      line(
        centre.x + Math.cos(trailAngle) * edge * 0.55,
        centre.y + Math.sin(trailAngle) * edge * 0.55,
        centre.x + Math.cos(trailAngle) * edge * swept.reach,
        centre.y + Math.sin(trailAngle) * edge * swept.reach
      );

      stroke(235, 255, 245, 225);
      strokeWeight(4);
      line(hiltX, hiltY, tipX, tipY);
      noStroke();
      fill(255, 255, 255, 235);
      circle(tipX, tipY, 7);
    }

    // The hard rim, on the radius the damage actually uses. Two strokes: a
    // dark backing so it survives pale ground, and the jade edge over it.
    noFill();
    stroke(15, 40, 35, 130);
    strokeWeight(4 + struck * 3);
    circle(centre.x, centre.y, edge * 2);
    stroke(120, 245, 200, 165 + struck * 90);
    strokeWeight(2 + struck * 3);
    circle(centre.x, centre.y, edge * 2);
    pop();
  }
}
