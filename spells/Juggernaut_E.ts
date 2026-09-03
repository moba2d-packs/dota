import type {
  AttackableUnit,
  BasicAttackHit,
  CastContext,
  CastSpec,
  CancelReason,
  Rectangle,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const EventType = api.enums.EventType;
const SpellForm = api.enums.SpellForm;
const DEFAULT_CHAMPION_ATTACK = api.units.DEFAULT_CHAMPION_ATTACK;
const RectangleArea = api.utils.Quadtree.Rectangle;
const dmg = api.text.dmg;

/**
 * Vũ Đao — for eight seconds his sword bites deeper. Nothing else changes: he
 * walks the same, casts the same and swings at the same rate.
 *
 *   press                 -> the blade lights up and stays lit
 *   every basic attack    -> the victim takes another 9 on top of the swing
 *   eight seconds later   -> the light goes out and so does the listener
 *
 * ## `ON_ATTACK_HIT` is basic attacks only, and that is the point
 *
 * `combat/BasicAttack.ts` is the sole emitter, so nothing hung on this event
 * can ever be triggered by a spell. That is a trap for an on-hit *proc* (a
 * shield-burn once shipped here and punished nobody, because the author
 * expected spells to feed it) and exactly the right seam for a basic-attack
 * steroid, which is what this is. For "someone damaged me", the seam is
 * `Buff.onDamageTaken` instead.
 *
 * ## The unsubscribe is the whole risk in this file
 *
 * A listener on `game.eventManager` outlives the spell, the champion and the
 * match — nothing collects it — so every path out of the ability has to take
 * it off: the window ending (`onComplete`), a stun ending it early
 * (`onCancel`), the scene going away (`deactivate`) and the spell being
 * dropped off a champion (`onRemoved`). `stopDancing` is idempotent, because
 * two of those four run back to back: `deactivate()` calls
 * `runtime.cancel('SCENE_EXIT')`, which reaches `onCancel`, before this
 * class's own override gets to run.
 *
 * ## The tuning, and where it sits against the band
 *
 * 9 per swing on top of a basic attack's own 14 is a two-thirds increase, and
 * the whole window at the engine's default 1.1 swings a second is
 * `E_WINDOW_BONUS`. That is above `docs/VFX_STANDARD.md`'s 15-35 burst band,
 * and it is a different kind of number: none of it lands unless he is in
 * melee range for eight seconds, a disarm or a kite deletes it outright, and
 * it is worth exactly zero the instant nobody is standing in front of him.
 * `Juggernaut_E.test.ts` asserts both the per-swing figure and the window.
 */
export const E_DURATION_MS = 8_000;
export const E_BONUS_DAMAGE = 9;
export const E_COOLDOWN_MS = 18_000;
export const E_MANA = 40;

/** Swings the window fits at the engine's own default rate. Read from core so a retune there cannot leave this comment lying. */
export const E_WINDOW_HITS = Math.floor(
  (E_DURATION_MS / 1000) * DEFAULT_CHAMPION_ATTACK.attacksPerSecond
);
/** What the whole window is worth to a champion who never misses a swing. See the header. */
export const E_WINDOW_BONUS = E_BONUS_DAMAGE * E_WINDOW_HITS;

export default class Juggernaut_E extends Spell {
  /**
   * Told: an on-hit steroid that adds physical damage to every swing for the
   * duration. It shields nothing, and it is sustained rather than a
   * finisher, so no `Burst`.
   */
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Buff;

  image = api.asset('spell_juggernaut_e');
  name = 'Vũ Đao (Juggernaut_E)';
  description =
    `Trong <span class="time">${E_DURATION_MS / 1000} giây</span>, mỗi đòn đánh thường của ` +
    `Juggernaut gây thêm ${dmg(E_BONUS_DAMAGE, 'PHYSICAL')}.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;

  /** The glow riding his body while the window is open. Null whenever it is shut. */
  glow: Juggernaut_E_Object | null = null;
  /** `eventManager.on` hands back its own remover; holding it is the only way to take the listener off again. */
  private unsubscribe: (() => void) | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      // The runtime holds the window open, so it is the runtime that calls
      // `onComplete` at eight seconds and nothing here counts them twice.
      active: { maxDurationMs: E_DURATION_MS },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
      // `INDEPENDENT`: a sharpened blade is not something he is *performing*.
      // The default `HELD` ends on movement, which would switch the steroid off
      // on his first step towards the person he sharpened it for.
      interrupts: SpellForm.INDEPENDENT,
    };
  }

  onSpellCast(): void {
    // Belt and braces against a second subscription: a spell re-cast without
    // its window having closed would otherwise stack listeners, and each one
    // deals the bonus again.
    this.stopDancing();

    const glow = new Juggernaut_E_Object(this.owner);
    this.glow = glow;
    this.game.objectManager.addObject(glow);

    this.unsubscribe = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => {
      if (!hit || hit.attacker !== this.owner) return;
      const victim = hit.victim;
      if (!victim || victim.isDead || victim.toRemove) return;

      victim.takeDamage(E_BONUS_DAMAGE, this.owner, 'PHYSICAL');
      // The slash is drawn **on** the victim, at the moment the bonus lands —
      // an on-hit effect the player cannot locate is an on-hit effect they
      // cannot tell is running.
      this.glow?.slashOn(victim);
    });
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.stopDancing();
  }

  onComplete(): void {
    this.stopDancing();
  }

  deactivate(): void {
    this.stopDancing();
    super.deactivate();
  }

  onRemoved(): void {
    this.stopDancing();
    super.onRemoved();
  }

  /** Idempotent, because four teardown paths reach it and two of them run back to back. */
  private stopDancing(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.glow) {
      this.glow.toRemove = true;
      this.glow = null;
    }
  }
}

/** How long one slash mark stays on the body it landed on. */
const SLASH_LIFE_MS = 300;

/**
 * The lit blade, and every slash it has just made.
 *
 * A `SpellObject` rather than caster VFX because the slashes land on other
 * people's bodies: `Champion.draw()` is skipped whenever `ObjectManager` culls
 * or fogs him, and an effect hung there disappears while the damage lands.
 */
export class Juggernaut_E_Object extends SpellObject {
  /** Where the last few swings landed. Short-lived, so this never grows. */
  private slashes: { victim: AttackableUnit; ageMs: number; tilt: number }[] = [];
  private age = 0;

  onAdded(): void {
    this.position = this.owner.position.copy();
  }

  /** Called by the spell the moment the bonus lands, with the body it landed on. */
  slashOn(victim: AttackableUnit): void {
    // Rolled once, here, and kept: `random()` inside `draw` re-rolls every
    // frame and the mark boils instead of sitting on the wound.
    this.slashes.push({ victim, ageMs: 0, tilt: random(-0.7, 0.7) });
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.age += step;
    for (const slash of this.slashes) slash.ageMs += step;
    this.slashes = this.slashes.filter(
      slash => slash.ageMs < SLASH_LIFE_MS && !slash.victim.isDead && !slash.victim.toRemove
    );
  }

  /**
   * Spans his body and every body he has just cut, so a slash on somebody at
   * the edge of the screen is not deleted with his own bounding box. A real
   * `Rectangle` and not the square helper: the helper is centred on this
   * object and cannot watch a list of other people.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = 44;
    let left = this.position.x;
    let top = this.position.y;
    let right = this.position.x;
    let bottom = this.position.y;
    for (const slash of this.slashes) {
      const body = slash.victim.position;
      if (body.x < left) left = body.x;
      if (body.x > right) right = body.x;
      if (body.y < top) top = body.y;
      if (body.y > bottom) bottom = body.y;
    }
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
    const body = this.position;
    // Winds in over 200ms rather than appearing at full brightness.
    const lit = Math.min(1, this.age / 200);
    // A slow breath, so the steroid reads as *running* rather than as a decal
    // somebody forgot to clear.
    const breath = 0.5 + 0.5 * Math.sin(this.age / 260);

    push();
    // The blade riding his body: an arc of light off one shoulder, not a ring
    // around him — a ring would be read as an area of effect, and this has no
    // area at all.
    noFill();
    stroke(120, 245, 200, (90 + breath * 90) * lit);
    strokeWeight(3);
    circle(body.x, body.y, 44 + breath * 5);
    stroke(235, 255, 245, 200 * lit);
    strokeWeight(4);
    line(body.x + 8, body.y - 18, body.x + 20, body.y + 12);

    // The cuts, each on the body it was made on.
    for (const slash of this.slashes) {
      const struck = slash.victim.position;
      // `1 - (1 - t) * (1 - t)` — opens fast and fades, the way a cut does.
      const through = slash.ageMs / SLASH_LIFE_MS;
      const opened = 1 - (1 - through) * (1 - through);
      const fading = 1 - through;
      const reach = 12 + opened * 22;
      const swept = Math.cos(slash.tilt) * reach;
      const rise = Math.sin(slash.tilt) * reach;

      stroke(15, 45, 38, 150 * fading);
      strokeWeight(7);
      line(struck.x - swept, struck.y - rise, struck.x + swept, struck.y + rise);
      stroke(235, 255, 245, 245 * fading);
      strokeWeight(3);
      line(struck.x - swept, struck.y - rise, struck.x + swept, struck.y + rise);
    }
    pop();
  }
}
