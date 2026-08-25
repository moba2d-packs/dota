import type { Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Speedup = api.buffs.Speedup;
const StatAmp = api.buffs.StatAmp;
const Rectangle = api.utils.Quadtree.Rectangle;

/**
 * Hồn Lửa — she catches light, and for six seconds she moves and swings like it.
 *
 *   press      -> flame catches on her and she is visibly faster
 *   six seconds-> both halves wear off together
 *   she dies   -> the flame goes out with her rather than burning on a corpse
 *
 * ## Which of the two shapes this is
 *
 * The brief offered a stat modifier or an `ON_ATTACK_HIT` listener; this is
 * the stat modifier, and it is `StatAmp` rather than a hand-rolled
 * `StatsModifier`. `StatAmp` *is* that hand-rolled buff — it builds a
 * `StatsModifier` in `onCreate` and adds it to `targetUnit.stats` in
 * `onActivate`, taking it off again in `onDeactivate` — and choosing it means
 * the put-it-back half is written once, in the engine, instead of once per
 * ability. The listener shape was rejected on the leak: four subscribe/
 * unsubscribe sites (`onCancel`, `onComplete`, `deactivate`, `onRemoved`), any
 * one of which outlives the match if it is missed, to buy a bonus the stat
 * system already expresses.
 *
 * Movement is `Speedup` rather than a second `StatAmp` on `speed` for the same
 * reason in the other direction: `Speedup` is the engine's name for exactly
 * this, and a slow that has to fight it needs to find it under the name every
 * other haste in the game uses.
 */
export const E_DURATION_MS = 6_000;
/** Movement, as a fraction of her base. */
export const E_MOVE_SPEED_PCT = 0.28;
/** Swing rate, as a fraction of her base attacks per second. */
export const E_ATTACK_SPEED_PCT = 0.4;
export const E_COOLDOWN_MS = 16_000;
export const E_MANA = 40;

/** How wide the flame sits around her body. Drawn only. */
export const E_AURA_RADIUS = 34;
/** How far she moves before the wake drops another ember. Drawn only. */
export const E_WAKE_STEP_PX = 16;
/** How many embers the wake holds. Drawn only. */
export const E_WAKE_LENGTH = 12;

export default class Lina_E extends Spell {
  image = api.asset('spell_lina_e');
  name = 'Hồn Lửa (Lina_E)';
  description =
    `Lina bốc cháy trong <span class="time">${E_DURATION_MS / 1000} giây</span>: ` +
    `<span class="buff">+${Math.round(E_MOVE_SPEED_PCT * 100)}% tốc chạy</span> và ` +
    `<span class="buff">+${Math.round(E_ATTACK_SPEED_PCT * 100)}% tốc đánh</span>.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = 0;

  /** The flame riding her. Read by the test, and by nothing else. */
  live: Lina_E_Object | null = null;

  onSpellCast(): void {
    const hastened = new Speedup(E_DURATION_MS, this.owner, this.owner);
    hastened.percent = E_MOVE_SPEED_PCT;
    hastened.image = this.image;
    // Without an id it shares one stack pool with every other bare Speedup in
    // the match, including an enemy support's.
    hastened.stackId = 'dota_lina_e_haste';
    this.owner.addBuff(hastened);

    const swift = new StatAmp(E_DURATION_MS, this.owner, this.owner);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
    // modifier, and `addBuff` is what runs it. Assigning afterwards buys
    // nothing and fails silently.
    swift.bonuses = { attackSpeed: { percentBaseBonus: E_ATTACK_SPEED_PCT } };
    swift.image = this.image;
    swift.stackId = 'dota_lina_e_attack_speed';
    this.owner.addBuff(swift);

    const flame = new Lina_E_Object(this.owner);
    this.live = flame;
    this.game.objectManager.addObject(flame);
  }

  drawPreview(): void {
    super.drawPreview(E_AURA_RADIUS);
  }
}

/**
 * The flame that rides her: an aura on the body and a wake of embers behind it.
 *
 * A `SpellObject` rather than something drawn from `Champion.draw()` because
 * the wake reaches well past her body — and `ObjectManager.draw` skips a
 * champion it has culled or fogged, which would take the effect with it.
 *
 * It runs its own clock rather than shadowing the buff. Both are six seconds
 * and both are stated by the same constant, and an own clock is what makes it
 * testable without a live buff layer under it.
 */
export class Lina_E_Object extends SpellObject {
  private ageMs = 0;
  /** Where she has been, newest last. Not a `TrailSystem`: this one tapers and burns down. */
  private wake: { x: number; y: number; bornMs: number }[] = [];
  /** Seeded once. `random()` inside `draw` re-rolls every frame and boils rather than licking. */
  private tongues: number[] = [];

  onAdded(): void {
    this.position = this.owner.position.copy();
    for (let i = 0; i < 7; i++) this.tongues.push(random(0.6, 1.3));
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= E_DURATION_MS) {
      this.toRemove = true;
      return;
    }

    this.position.set(this.owner.position.x, this.owner.position.y);
    const newest = this.wake[this.wake.length - 1];
    const moved = newest
      ? Math.hypot(this.position.x - newest.x, this.position.y - newest.y)
      : Infinity;
    if (moved >= E_WAKE_STEP_PX) {
      this.wake.push({ x: this.position.x, y: this.position.y, bornMs: this.ageMs });
      if (this.wake.length > E_WAKE_LENGTH) this.wake.shift();
    }
  }

  /**
   * Spans the whole wake, which trails behind a body that keeps moving — so
   * this is a real `Rectangle` and not `squareDisplayBoundingBox`, whose cache
   * key is this object's own position and size and could not see the tail
   * change shape while she stood still.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = E_AURA_RADIUS + 16;
    let left = this.position.x;
    let right = this.position.x;
    let top = this.position.y;
    let bottom = this.position.y;
    for (const ember of this.wake) {
      if (ember.x < left) left = ember.x;
      if (ember.x > right) right = ember.x;
      if (ember.y < top) top = ember.y;
      if (ember.y > bottom) bottom = ember.y;
    }
    return new Rectangle({
      x: left - pad,
      y: top - pad,
      w: right - left + pad * 2,
      h: bottom - top + pad * 2,
      data: this,
    });
  }

  draw(): void {
    // `ember`, `tongue`, `waning` — never `point`, `map` or `color`, which are
    // p5 globals here and are silently shadowed by a local of the same name.
    const waning = Math.max(0, 1 - this.ageMs / E_DURATION_MS);

    push();
    noStroke();

    // 1. The wake, oldest first so newer embers paint over older ones. Each
    //    one shrinks and darkens with its own age, which is what makes the
    //    trail read as burning down rather than as a fading line.
    for (const ember of this.wake) {
      const burned = Math.min(1, (this.ageMs - ember.bornMs) / 520);
      if (burned >= 1) continue;
      const alive = 1 - burned;
      fill(238, 118 + 90 * alive, 34, 200 * alive * waning);
      circle(ember.x, ember.y, 20 * alive + 4);
    }

    // 2. The flame on her body: tongues around the aura radius, breathing on
    //    this object's own clock rather than on a frame counter, so the
    //    animation runs at the same speed however the frame rate wanders.
    const breath = this.ageMs / 140;
    for (let i = 0; i < this.tongues.length; i++) {
      const around = (i / this.tongues.length) * TWO_PI + this.ageMs / 900;
      const lick = (this.tongues[i] ?? 1) * (0.78 + 0.22 * Math.sin(breath + i));
      const reach = E_AURA_RADIUS * lick;
      fill(255, 176, 60, 190 * waning);
      circle(
        this.position.x + Math.cos(around) * reach,
        this.position.y + Math.sin(around) * reach,
        13 * lick + 3
      );
    }
    pop();
  }
}
