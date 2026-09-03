import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Dash = api.buffs.Dash;
const Root = api.buffs.Root;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const dmg = api.text.dmg;

/**
 * Vồ Mồi — he leaves the ground, and the first thing he lands on is not going
 * anywhere.
 *
 *   press in a direction -> he covers 420 in a few frames
 *   he crosses somebody  -> that one takes the damage and is leashed in place
 *   anyone after them    -> untouched; the pounce is spent
 *   he is grounded       -> refused before it costs him anything
 *
 * ## Why a `Dash` rather than moving the body directly
 *
 * `Dash.CanDash` is where grounding is enforced for a unit moving under its own
 * power, and the buff is also what makes the leap interruptible by the same
 * things that interrupt every other leap in the game. Writing the movement by
 * hand would opt out of both and would have to re-implement them, badly.
 *
 * **`onDashUpdate`, never `dashBuff.onUpdate = …`.** `Dash` implements its
 * movement in `Dash.prototype.onUpdate`, so an instance assignment replaces the
 * frame rather than hooking it and the champion plays the ability standing
 * still. It reads exactly like a callback, which is why three abilities in the
 * sibling engine shipped with it before anyone noticed.
 */
export const W_DISTANCE = 420;
export const W_SPEED = 26;
export const W_DAMAGE = 22;
export const W_LEASH_MS = 1_600;
/** How close he has to pass to catch somebody. */
export const W_CATCH_RADIUS = 60;
/** Upper bound on the dash buff, not the flight time — it ends on arrival. */
export const W_DASH_MS = 1_200;
export const W_COOLDOWN_MS = 14_000;
export const W_MANA = 35;

export default class Slark_W extends Spell {
  image = api.asset('spell_slark_w');
  name = 'Vồ Mồi (Slark_W)';
  description =
    `Lao về phía trước ${W_DISTANCE}. Kẻ địch <span class="buff">đầu tiên</span> trên đường ` +
    `nhận ${dmg(W_DAMAGE, 'PHYSICAL')} và bị ` +
    `<span class="buff">trói chân</span> trong <span class="time">${W_LEASH_MS / 1000} giây</span>.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'DIRECTION' as const;
  range = W_DISTANCE;

  /** Set for the length of one pounce. Multi-hit protection: he catches one body. */
  private caught: AttackableUnit | null = null;

  /** Checked here so a grounded pounce fails before it charges him. */
  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(): void {
    this.caught = null;
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      W_DISTANCE
    );

    const leap = new Dash(W_DASH_MS, this.owner, this.owner);
    leap.image = this.image;
    leap.dashDestination = to;
    leap.dashSpeed = W_SPEED;
    leap.showTrail = true;
    // The hook, not an `onUpdate` assignment — see the header. Core calls this
    // *after* the step, so the check runs over ground actually covered.
    leap.onDashUpdate = () => this.tryCatch();
    this.owner.addBuff(leap);

    const wake = new Slark_W_Object(this.owner);
    wake.attachTo(this.owner, leap);
    this.game.objectManager.addObject(wake);
  }

  /**
   * The catch. One body per pounce — without the latch this would leash and
   * damage everything the leap crosses, which is a different ability.
   */
  private tryCatch(): void {
    if (this.caught) return;

    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: W_CATCH_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const prey of found) {
      if (!prey || prey.isDead || prey.toRemove) continue;
      if (prey.position.dist(this.owner.position) > W_CATCH_RADIUS) continue;

      this.caught = prey;
      prey.takeDamage(W_DAMAGE, this.owner, 'PHYSICAL');
      // After the damage: a body this killed is already dead, and `addBuff`
      // refuses a corpse rather than leaving a leash on one.
      if (prey.isDead) return;
      const leashed = new Root(W_LEASH_MS, this.owner, prey);
      leashed.image = this.image;
      leashed.stackId = 'dota_slark_w_leash';
      prey.addBuff(leashed);
      return;
    }
  }

  drawPreview(): void {
    super.drawPreview(W_DISTANCE);
  }
}

/**
 * The wake behind the leap: a low, flat shadow that stretches along his path.
 *
 * Deliberately not the round burst every other effect in this pack uses — a
 * pounce is a *direction*, and the shape has to say so. It rides his body, so
 * it opens with `dropIfAttachmentLost()` and syncs to him every frame; without
 * that it keeps drawing on the corpse and reappears at the spawn point.
 */
export class Slark_W_Object extends SpellObject {
  private ageMs = 0;
  /** The last few places he has been, for the stretch. */
  private wake: { x: number; y: number }[] = [];

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);

    this.wake.push({ x: this.position.x, y: this.position.y });
    if (this.wake.length > 12) this.wake.shift();
  }

  /** Spans the whole wake, which is a path and not a square around his centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = W_CATCH_RADIUS + 20;
    let left = this.position.x;
    let top = this.position.y;
    let right = this.position.x;
    let bottom = this.position.y;
    for (const step of this.wake) {
      left = Math.min(left, step.x);
      top = Math.min(top, step.y);
      right = Math.max(right, step.x);
      bottom = Math.max(bottom, step.y);
    }
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle every frame.
    return new Rectangle({
      x: left - pad,
      y: top - pad,
      w: right - left + pad * 2,
      h: bottom - top + pad * 2,
      data: this,
    });
  }

  draw(): void {
    push();
    // The path he has covered, fading behind him — the oldest step is the
    // faintest, so the direction of travel is readable from the shape alone.
    noFill();
    strokeCap(ROUND);
    for (let i = 0; i < this.wake.length - 1; i++) {
      const along = i / Math.max(1, this.wake.length - 1);
      stroke(60, 130, 130, 20 + along * 110);
      strokeWeight(4 + along * 14);
      line(this.wake[i].x, this.wake[i].y, this.wake[i + 1].x, this.wake[i + 1].y);
    }

    // The catch radius, on his body, so the player can read how close he has
    // to pass to land it.
    const beat = 1 + 0.06 * Math.sin(this.ageMs / 60);
    noFill();
    stroke(120, 220, 210, 130);
    strokeWeight(2);
    circle(this.position.x, this.position.y, W_CATCH_RADIUS * 2 * beat);
    pop();
  }
}
