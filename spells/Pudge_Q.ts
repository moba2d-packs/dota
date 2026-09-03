import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Dash = api.buffs.Dash;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const dmg = api.text.dmg;

/**
 * Móc Thịt — a chain thrown in a straight line that drags the first thing it
 * catches back to the caster.
 *
 * The script this was written from, one line per thing the player sees:
 *
 *   press          -> the hook leaves his hand and a chain pays out behind it
 *   it catches     -> the victim takes the damage and starts moving toward him
 *   it catches     -> the chain reels in, and the hook stays on the victim
 *   it misses      -> the hook reaches full range and comes back empty
 *
 * Two of those four are why this is a plain `SpellObject` and not a
 * `MissileSpellObject`: the missile base flies one way and dies on arrival, and
 * both the empty return and the reel-in are a second leg it has no shape for.
 */
export const Q_DAMAGE = 30;
export const Q_RANGE = 520;
export const Q_SPEED = 15;
/** How fast a caught body is reeled in. Faster than the throw — a catch should feel like a yank. */
export const Q_PULL_SPEED = 20;
/** The hook's own catch radius, on top of the victim's body. */
export const Q_HOOK_RADIUS = 26;
export const Q_COOLDOWN_MS = 12_000;
export const Q_MANA = 40;
/**
 * Upper bound on the pull buff, not the travel time — `Dash` deactivates well
 * before this once it reaches its destination. Long enough to cross the full
 * range at `Q_PULL_SPEED` with room to spare.
 */
export const Q_PULL_DURATION_MS = 1_200;

type Phase = 'out' | 'reeling' | 'returning';

export class Pudge_Q_Object extends SpellObject {
  speed = Q_SPEED;
  size = Q_HOOK_RADIUS * 2;
  damage = Q_DAMAGE;

  phase: Phase = 'out';
  /** Set once, on the catch. The chain follows this body home. */
  caught: AttackableUnit | null = null;

  /** Where the throw ends if it catches nothing. Set by the spell. */
  destination = createVector(0, 0);

  /** Seeded once: a chain that re-rolls its own links every frame shimmers instead of swinging. */
  private linkPhase = 0;

  onAdded(): void {
    this.linkPhase = random(TWO_PI);
  }

  update(): void {
    if (this.owner.isDead) {
      this.toRemove = true;
      return;
    }

    if (this.phase === 'out') {
      this.stepToward(this.destination, this.speed);
      if (this.tryCatch()) return;
      if (this.position.dist(this.destination) < this.speed) this.phase = 'returning';
      return;
    }

    if (this.phase === 'reeling') {
      const victim = this.caught;
      // The victim may have died, been removed, or had the pull cancelled out
      // from under it — in every case the chain has nothing left to hold.
      if (!victim || victim.isDead || victim.toRemove) {
        this.phase = 'returning';
        this.caught = null;
        return;
      }
      // The hook rides the body it caught rather than running its own path
      // home: the two are one object to the player, and a hook that arrives
      // ahead of its victim reads as two separate effects.
      this.position.set(victim.position.x, victim.position.y);
      if (this.position.dist(this.owner.position) < this.owner.collisionRadius + Q_HOOK_RADIUS) {
        this.toRemove = true;
      }
      return;
    }

    this.stepToward(this.owner.position, this.speed * 1.4);
    if (this.position.dist(this.owner.position) < this.speed * 1.4) this.toRemove = true;
  }

  private stepToward(target: { x: number; y: number }, speed: number): void {
    const delta = createVector(target.x - this.position.x, target.y - this.position.y);
    if (delta.mag() <= speed) {
      this.position.set(target.x, target.y);
      return;
    }
    delta.setMag(speed);
    this.position.add(delta);
  }

  /**
   * The catch. Returns true when it happened, so `update` can stop stepping
   * this frame — a hook that both catches and keeps flying leaves the chain
   * one frame ahead of the body.
   */
  private tryCatch(): boolean {
    const hits = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: Q_HOOK_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    const victim = hits[0] as AttackableUnit | undefined;
    if (!victim) return false;

    victim.takeDamage(this.damage, this.owner, 'MAGIC');
    this.caught = victim;
    this.phase = 'reeling';

    // The pull is a `Dash` on the *victim*, which is what makes it a real
    // displacement: it takes their movement away, it is interrupted by the
    // same things every other displacement is, and it lands them at his feet
    // rather than teleporting them there.
    if (Dash.CanDash(victim)) {
      victim.stopMovement?.();
      victim.markDisplaced?.();
      const reeled = new Dash(Q_PULL_DURATION_MS, this.owner, victim);
      reeled.dashDestination = this.owner.position.copy();
      reeled.dashSpeed = Q_PULL_SPEED;
      victim.addBuff(reeled);
    }
    return true;
  }

  /**
   * The chain reaches all the way back to the caster, so the box is the span
   * between two moving points and **not** a square around this object's own
   * centre — `squareDisplayBoundingBox`'s cache key is position and size, and
   * would go stale the moment the caster walked without the hook moving.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = Q_HOOK_RADIUS + 20;
    const left = Math.min(this.position.x, this.owner.position.x) - pad;
    const top = Math.min(this.position.y, this.owner.position.y) - pad;
    const right = Math.max(this.position.x, this.owner.position.x) + pad;
    const bottom = Math.max(this.position.y, this.owner.position.y) + pad;
    // **`data: this` is not optional.** `ObjectManager` puts this rectangle
    // straight into the display quadtree and the draw pass reads
    // `entry.data.zIndex` back off it — omit it and every frame throws
    // "Cannot read properties of undefined (reading 'zIndex')" out of
    // `ObjectManager.draw`, which the game catches and turns into an in-game
    // banner rather than a page error. Neither `verify` nor a Playwright
    // page-error check can see that; it was found by looking at a screenshot.
    // `squareDisplayBoundingBox` fills the field in for you, which is why the
    // hand-rolled branch is the only one that can get it wrong.
    return new Rectangle({ x: left, y: top, w: right - left, h: bottom - top, data: this });
  }

  draw(): void {
    // `link`, `chain`, `barb` — never `line`, `point` or `color`, which are p5
    // globals in this project and are silently shadowed by a local of the
    // same name.
    const anchor = this.owner.position;
    const hook = this.position;
    const span = dist(anchor.x, anchor.y, hook.x, hook.y);
    const held = this.phase === 'reeling';

    push();
    // The chain, as real links rather than a stroke: the count follows the
    // span, so a reeling chain visibly shortens instead of just getting paler.
    const links = Math.max(2, Math.floor(span / 26));
    strokeCap(ROUND);
    for (let i = 1; i <= links; i++) {
      const along = i / (links + 1);
      const linkX = lerp(anchor.x, hook.x, along);
      const linkY = lerp(anchor.y, hook.y, along);
      const swing = Math.sin(this.linkPhase + along * 8) * (held ? 1.5 : 4);
      const normalX = span > 0 ? -(hook.y - anchor.y) / span : 0;
      const normalY = span > 0 ? (hook.x - anchor.x) / span : 0;
      stroke(held ? 210 : 176, held ? 60 : 150, held ? 50 : 130, 230);
      strokeWeight(6);
      point(linkX + normalX * swing, linkY + normalY * swing);
    }

    // The barb, pointed the way it is travelling, so an outbound throw and a
    // reel-in do not look the same.
    const heading = held ? Math.atan2(anchor.y - hook.y, anchor.x - hook.x) : Math.atan2(hook.y - anchor.y, hook.x - anchor.x);
    translate(hook.x, hook.y);
    rotate(heading);
    noStroke();
    fill(230, 220, 200, 240);
    // A curved shank ending in a point: a circle here would read as any of a
    // dozen other projectiles in this game.
    beginShape();
    vertex(-14, -5);
    vertex(6, -9);
    vertex(16, 0);
    vertex(4, 10);
    vertex(-6, 4);
    vertex(-14, 6);
    endShape(CLOSE);
    fill(150, 40, 35, held ? 220 : 90);
    circle(10, 0, 9);
    pop();
  }
}

export default class Pudge_Q extends Spell {
  image = api.asset('spell_pudge_q');
  name = 'Móc Thịt (Pudge_Q)';
  description =
    `Phóng móc câu theo hướng chỉ định. Kẻ địch đầu tiên trúng nhận ` +
    `${dmg(Q_DAMAGE, 'MAGIC')} và bị <span class="buff">kéo về</span> phía Pudge.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'DIRECTION' as const;
  range = Q_RANGE;

  live: Pudge_Q_Object | null = null;

  onSpellCast(): void {
    const hook = new Pudge_Q_Object(this.owner);
    hook.position = this.owner.position.copy();
    hook.destination = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, Q_RANGE).to;
    this.live = hook;
    this.game.objectManager.addObject(hook);
  }

  drawPreview(): void {
    super.drawPreview(Q_RANGE);
  }
}
