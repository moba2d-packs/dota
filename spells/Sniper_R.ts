import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const acceleratedSpeed = api.combat.GlobalShot.acceleratedSpeed;
const travelRamp = api.combat.GlobalShot.travelRamp;
const dmg = api.text.dmg;
const dmgValue = api.text.dmgValue;

/**
 * Ám Sát — one round, fired down a line longer than anything else in this pack
 * can reach, and worth more the further it has to go.
 *
 *   press in a direction -> the round leaves slowly and picks up speed
 *   it crosses a body    -> it stops there, and that one takes the hit
 *   fired point blank    -> barely more than an ordinary ability
 *   fired across the map -> the most damage in the pack
 *
 * ## Why the damage ramps with distance
 *
 * A long-range nuke that is equally good at every range is just a nuke with an
 * unusually forgiving cast range — there is no decision in it. The ramp is what
 * makes this a sniper's ultimate: it punishes him for taking the safe close
 * shot and pays him for the one that needed the angle. `GlobalShot.travelRamp`
 * is the engine's own expression of that curve, and `acceleratedSpeed` is the
 * matching one for the round's own speed, so the picture and the number agree
 * without either being re-derived here.
 *
 * The ramp is measured from **where the round actually is** relative to where
 * it was fired, not from a running total of per-frame steps. For a straight
 * shot the two are the same number, and the position is the one that cannot
 * drift by a partial final step.
 *
 * ## It stops on the first body
 *
 * `maxHitCount` would do this if it were a `MissileSpellObject`, but the
 * acceleration and the ramp both need the flight's own state, so this is a
 * plain `SpellObject` and the single-hit rule is the `spent` latch.
 */
export const R_RANGE = 1_400;
export const R_MIN_DAMAGE = 40;
export const R_MAX_DAMAGE = 58;
/** Distance at which the round is at full power, in both speed and damage. */
export const R_FULL_POWER_AT = 700;
export const R_SPEED_FROM = 16;
export const R_SPEED_TO = 46;
/** The round's own catch radius, on top of the victim's body. */
export const R_CALIBRE = 20;
export const R_COOLDOWN_MS = 40_000;
export const R_MANA = 60;

export default class Sniper_R extends Spell {
  image = api.asset('spell_sniper_r');
  name = 'Ám Sát (Sniper_R)';
  description =
    `Bắn một phát đạn xuyên qua ${R_RANGE} theo hướng chỉ định. Kẻ địch ` +
    `<span class="buff">đầu tiên</span> trúng đạn nhận từ ` +
    `${dmgValue(R_MIN_DAMAGE, 'PHYSICAL')} đến ` +
    `${dmg(R_MAX_DAMAGE, 'PHYSICAL')} — càng bay xa càng mạnh, ` +
    `đạt tối đa sau ${R_FULL_POWER_AT}.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  targetingMode = 'DIRECTION' as const;
  range = R_RANGE;

  /** The round in flight, for as long as one is. Read by the test. */
  live: Sniper_R_Object | null = null;

  onSpellCast(): void {
    const round = new Sniper_R_Object(this.owner);
    round.position = this.owner.position.copy();
    round.origin = this.owner.position.copy();
    round.destination = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      R_RANGE
    ).to;
    this.live = round;
    this.game.objectManager.addObject(round);
  }

  drawPreview(): void {
    super.drawPreview(R_RANGE);
  }
}

/**
 * The round: a thin bright line that gets longer as it gets faster.
 *
 * The streak's *length* is the ramp made visible — a round that is about to
 * land for 58 looks nothing like one that just left the barrel for 40, so a
 * player watching it can tell what is coming before it arrives. That is the
 * whole reason the effect is a stretched streak rather than a dot.
 */
export class Sniper_R_Object extends SpellObject {
  /** Where it was fired from, and where the flight ends. Set by the spell. */
  origin = createVector(0, 0);
  destination = createVector(0, 0);

  /** Single-hit protection — see the spell's header. */
  private spent = false;

  update(): void {
    if (this.spent) {
      this.toRemove = true;
      return;
    }

    const flown = this.position.dist(this.origin);
    const speed = acceleratedSpeed(flown, R_SPEED_FROM, R_SPEED_TO, R_FULL_POWER_AT);

    const step = createVector(
      this.destination.x - this.position.x,
      this.destination.y - this.position.y
    );
    if (step.mag() <= speed) {
      this.position.set(this.destination.x, this.destination.y);
      this.tryHit();
      this.toRemove = true;
      return;
    }
    step.setMag(speed);
    this.position.add(step);
    this.tryHit();
  }

  private tryHit(): void {
    // **No vision filter** — this is a skillshot, and a round already in flight
    // does not ask whether the shooter can see what it runs into.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: R_CALIBRE }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      if (victim.position.dist(this.position) > R_CALIBRE + victim.collisionRadius) continue;

      const power = travelRamp(this.position.dist(this.origin), R_FULL_POWER_AT);
      const payload = R_MIN_DAMAGE + (R_MAX_DAMAGE - R_MIN_DAMAGE) * power;
      victim.takeDamage(payload, this.owner, 'PHYSICAL');
      this.spent = true;
      return;
    }
  }

  /**
   * The streak reaches back along the flight path, so the box spans the round
   * and its own tail rather than being a square around a point.
   */
  getDisplayBoundingBox(): Rectangle {
    const tail = this.tailLength();
    const pad = R_CALIBRE + 20;
    const back = this.trailingPoint(tail);
    const left = Math.min(this.position.x, back.x) - pad;
    const top = Math.min(this.position.y, back.y) - pad;
    const right = Math.max(this.position.x, back.x) + pad;
    const bottom = Math.max(this.position.y, back.y) + pad;
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle every frame.
    return new Rectangle({ x: left, y: top, w: right - left, h: bottom - top, data: this });
  }

  /** How long the streak is right now: the ramp, drawn. */
  private tailLength(): number {
    return 40 + travelRamp(this.position.dist(this.origin), R_FULL_POWER_AT) * 150;
  }

  private trailingPoint(length: number): { x: number; y: number } {
    const dx = this.position.x - this.origin.x;
    const dy = this.position.y - this.origin.y;
    const span = Math.hypot(dx, dy) || 1;
    return {
      x: this.position.x - (dx / span) * length,
      y: this.position.y - (dy / span) * length,
    };
  }

  draw(): void {
    const tail = this.tailLength();
    const back = this.trailingPoint(tail);
    const power = travelRamp(this.position.dist(this.origin), R_FULL_POWER_AT);

    push();
    strokeCap(ROUND);
    // A wide, dim smear behind a narrow bright core: two layers, and the one
    // that survives is the one carrying the information — the core's length.
    stroke(210, 160, 90, 70);
    strokeWeight(7);
    line(back.x, back.y, this.position.x, this.position.y);
    stroke(255, 236, 190, 235);
    strokeWeight(2.5 + power * 1.5);
    line(back.x, back.y, this.position.x, this.position.y);

    // The head, brightening as it comes up to full power.
    noStroke();
    fill(255, 250, 235, 200 + power * 55);
    circle(this.position.x, this.position.y, 8 + power * 6);
    pop();
  }
}
