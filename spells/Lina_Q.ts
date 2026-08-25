import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const MissileSpellObject = api.MissileSpellObject;
const VectorUtils = api.utils.VectorUtils;

/**
 * Thiêu Rồng — a wave of fire that sweeps out in a straight line and does not
 * stop at the first body.
 *
 * The script this was written from, one line per thing the player sees:
 *
 *   press            -> a crest of flame opens out of her hand
 *   it crosses a row -> every one of them burns, and the wave keeps going
 *   the same body    -> never burns twice, however long it stands in the line
 *   full range       -> the crest gutters out where the preview said it would
 *
 * Piercing is the base class's default and is therefore *not written here*:
 * `MissileSpellObject.maxHitCount` starts at `Infinity`, and `queryEnemies`
 * already excludes `hitTargets`, so one unit is hit once no matter how many
 * frames it spends inside the crest. The placeholder this replaces set
 * `maxHitCount = 1`, which is the single line that turns a wave into a bolt.
 */
export const Q_DAMAGE = 26;
export const Q_RANGE = 480;
export const Q_SPEED = 13;
/**
 * The crest's full span across the line of travel, and the missile's `size`,
 * so the width the wave is *drawn* at is the width it damages at. A wave that
 * paints wider than it hits teaches the player the wrong dodge.
 */
export const Q_HIT_WIDTH = 55;
/** How far the flame tapers behind the crest. Drawn only — nothing back here damages. */
export const Q_TAIL_PX = 74;
/** How far out of her hand the crest takes to open to full width. */
export const Q_OPEN_PX = 90;
export const Q_COOLDOWN_MS = 9_000;
export const Q_MANA = 35;

/** Wide enough for the crest plus its whole tail, in every heading. */
const Q_DISPLAY_SPAN = (Q_HIT_WIDTH / 2 + Q_TAIL_PX + 18) * 2;

export class Lina_Q_Object extends MissileSpellObject {
  speed = Q_SPEED;
  size = Q_HIT_WIDTH;
  damage = Q_DAMAGE;
  // `maxHitCount` is deliberately left at the base class's Infinity — see the
  // header. Setting it to any number here is what makes the wave a bolt.

  /** Fixed once the wave leaves her hand: a crest that re-derives its heading from a shrinking gap wobbles on arrival. */
  private heading = 0;
  private launchedFrom = createVector(0, 0);
  /** Seeded once. `random()` inside `draw()` re-rolls every frame and boils instead of licking. */
  private tongues: number[] = [];

  onAdded(): void {
    // The base class registers a trail system here; there is none on this
    // ability, but skipping the super call is how that stops being true later
    // without anyone noticing.
    super.onAdded();
    this.launchedFrom = this.position.copy();
    this.heading = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    for (let i = 0; i < 7; i++) this.tongues.push(random(0.55, 1.15));
  }

  onHit(target: AttackableUnit): void {
    target.takeDamage(this.damage, this.owner);
  }

  /**
   * A square around the crest, which is the shape the wave actually occupies —
   * so `squareDisplayBoundingBox` and its position+size cache are honest here,
   * unlike a tether, whose far end moves without this object moving. Without
   * it the box would come from `visionRadius`, which is 0 on a `SpellObject`:
   * a zero-area box, and the wave would vanish the moment its *centre* left
   * the camera while its damage kept landing.
   */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(Q_DISPLAY_SPAN);
  }

  draw(): void {
    // `crest`, `swept`, `across` — never `line`, `map` or `color`, which are p5
    // globals in this project and are silently shadowed by a local of the same
    // name. `tsc` cannot see the shadow; the browser can.
    const swept = this.position.dist(this.launchedFrom);
    // The crest opens out of her hand rather than appearing at full width, and
    // eases so the opening snaps rather than ramps.
    const opening = Math.min(1, swept / Q_OPEN_PX);
    const opened = 1 - (1 - opening) * (1 - opening);
    const halfWidth = (Q_HIT_WIDTH / 2) * (0.35 + 0.65 * opened);
    const tail = Q_TAIL_PX * (0.3 + 0.7 * opened);
    // The last stretch guttering out, so the wave ends rather than being cut.
    const spent = Math.max(0, Math.min(1, (swept - (Q_RANGE - 70)) / 70));
    const strength = 1 - spent * 0.8;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // 1. The body of the wave: wider across than it is deep, tapering to a
    //    long point behind. Two nested lens shapes, hot centre inside deep
    //    orange, because a single flat colour reads as a wall rather than fire.
    noStroke();
    for (let shell = 0; shell < 2; shell++) {
      const scaleOf = shell === 0 ? 1 : 0.58;
      fill(
        shell === 0 ? 226 : 255,
        shell === 0 ? 104 : 196,
        shell === 0 ? 24 : 88,
        (shell === 0 ? 190 : 225) * strength
      );
      beginShape();
      for (let step = 0; step <= 12; step++) {
        const across = -1 + (step / 12) * 2;
        vertex(20 * scaleOf * (1 - across * across), across * halfWidth * scaleOf);
      }
      for (let step = 12; step >= 0; step--) {
        const across = -1 + (step / 12) * 2;
        const lick = this.tongues[step % this.tongues.length] ?? 1;
        vertex(-tail * scaleOf * (1 - across * across) * lick, across * halfWidth * scaleOf);
      }
      endShape(CLOSE);
    }

    // 2. The leading edge, near-white and hard: the one line in the effect
    //    that says exactly where the damage starts.
    noFill();
    stroke(255, 246, 214, 240 * strength);
    strokeWeight(3);
    beginShape();
    for (let step = 0; step <= 12; step++) {
      const across = -1 + (step / 12) * 2;
      vertex(20 * (1 - across * across), across * halfWidth);
    }
    endShape();
    pop();
  }
}

export default class Lina_Q extends Spell {
  image = api.asset('spell_lina_q');
  name = 'Thiêu Rồng (Lina_Q)';
  description =
    `Quét một luồng lửa theo hướng chỉ định, <span class="buff">xuyên qua</span> mọi kẻ địch ` +
    `trên đường đi và gây <span class="damage">${Q_DAMAGE} sát thương</span> cho mỗi mục tiêu.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'DIRECTION' as const;
  range = Q_RANGE;

  /** The wave in flight. Read by the test, and by nothing else. */
  live: Lina_Q_Object | null = null;

  onSpellCast(): void {
    const wave = new Lina_Q_Object(this.owner);
    wave.position = this.owner.position.copy();
    // A DIRECTION cast picks the heading and the spell owns the distance:
    // `getVectorWithRange` normalises to exactly `Q_RANGE`, so aiming past the
    // preview cannot throw further than it.
    wave.destination = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      Q_RANGE
    ).to;
    this.live = wave;
    this.game.objectManager.addObject(wave);
  }

  drawPreview(): void {
    super.drawPreview(Q_RANGE);
  }
}
