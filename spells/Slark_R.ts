import type { Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Invisible = api.buffs.Invisible;
const Phasing = api.buffs.Phasing;
const Speedup = api.buffs.Speedup;
const Rectangle = api.utils.Quadtree.Rectangle;
const BuffAddType = api.enums.BuffAddType;
const heal = api.text.heal;

/**
 * Vũ Điệu Bóng Tối — for five seconds he is not there: unseen, unblockable,
 * faster, and mending.
 *
 *   press        -> he goes out, and the water closes over him
 *   every 500ms  -> a little health back
 *   five seconds -> all four come off together
 *   he dies      -> the dance stops rather than playing over a corpse
 *
 * ## Why `Invisible` and `Phasing` are both here
 *
 * Stealth you can be body-blocked out of is not stealth. `Invisible` sets the
 * `Stealthed` status; `Phasing` clears *unit* collision only, so he slips
 * through the wave he is hiding in — while walls still stop him, which is the
 * deliberate difference between this and the `Ghosted` a `Dash` sets. Three
 * seconds of terrain phasing would let him swim out of the map.
 *
 * ## The regeneration is on an object, not on a buff
 *
 * A heal is not a stat and there is no engine buff that means "mend this much,
 * this often". The dance's own object owns that clock — which also gives the
 * one behaviour a spell-side clock gets wrong for free: it stops the moment he
 * dies, instead of healing a corpse for the rest of the duration.
 */
export const R_DURATION_MS = 5_000;
export const R_SPEED_PCT = 0.35;
export const R_TICK_MS = 500;
export const R_REGEN_PER_TICK = 4;
/** `R_REGEN_PER_TICK * (R_DURATION_MS / R_TICK_MS)` — 40 over the full dance. */
export const R_TOTAL_REGEN = R_REGEN_PER_TICK * (R_DURATION_MS / R_TICK_MS);
export const R_COOLDOWN_MS = 45_000;
export const R_MANA = 50;

export default class Slark_R extends Spell {
  /**
   * Told: it heals over its duration alongside the stealth and the speed.
   * `Heal` is the honest flag even though it makes the bot value the ability
   * most when it is losing — which, for this ultimate, it genuinely is.
   */
  static aiRoles = api.enums.SpellRole.Heal | api.enums.SpellRole.Buff;

  image = api.asset('spell_slark_r');
  name = 'Vũ Điệu Bóng Tối (Slark_R)';
  description =
    `Slark <span class="buff">tàng hình</span> trong ` +
    `<span class="time">${R_DURATION_MS / 1000} giây</span>, ` +
    `<span class="buff">đi xuyên qua các đơn vị</span>, ` +
    `<span class="buff">+${Math.round(R_SPEED_PCT * 100)}% tốc chạy</span> và hồi ` +
    `${heal(R_REGEN_PER_TICK, ' máu')} mỗi ` +
    `<span class="time">${R_TICK_MS / 1000} giây</span> (tổng ` +
    `${heal(R_TOTAL_REGEN)}).`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  targetingMode = 'SELF' as const;
  range = 0;

  /** The dance that is running, for as long as one is. Read by the test. */
  live: Slark_R_Object | null = null;

  onSpellCast(): void {
    const hidden = new Invisible(R_DURATION_MS, this.owner, this.owner);
    hidden.image = this.image;
    hidden.stackId = 'dota_slark_r_hidden';
    this.owner.addBuff(hidden);

    // Unit collision only — walls still stop him. See the header.
    const slipping = new Phasing(R_DURATION_MS, this.owner, this.owner);
    slipping.image = this.image;
    slipping.stackId = 'dota_slark_r_phasing';
    this.owner.addBuff(slipping);

    const swift = new Speedup(R_DURATION_MS, this.owner, this.owner);
    swift.percent = R_SPEED_PCT;
    // A recast rewinds one haste rather than stacking a second onto him, which
    // `Speedup`'s default add type would.
    swift.buffAddType = BuffAddType.RENEW_EXISTING;
    swift.image = this.image;
    swift.stackId = 'dota_slark_r_haste';
    this.owner.addBuff(swift);

    this.dropDance();
    const dance = new Slark_R_Object(this.owner);
    this.live = dance;
    // Tied to the buff it illustrates rather than to a clock of its own:
    // `addBuff` does not always keep the instance it was handed, so the object
    // watches whatever actually landed.
    dance.attachTo(this.owner, hidden);
    this.game.objectManager.addObject(dance);
  }

  deactivate(): void {
    this.dropDance();
    super.deactivate();
  }

  onRemoved(): void {
    this.dropDance();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is running. */
  private dropDance(): void {
    if (!this.live) return;
    this.live.toRemove = true;
    this.live = null;
  }
}

/**
 * The dance: a ripple that rides him, and the clock that mends him.
 *
 * Drawn deliberately faint. This is a *concealed* state — the one case where
 * the size floor inverts and being hard to see is the entire point — so it is a
 * thin displaced outline rather than a fill, and it says "something is here"
 * without saying "here he is".
 */
export class Slark_R_Object extends SpellObject {
  private ageMs = 0;
  private sinceTick = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;
    this.sinceTick += step;

    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= R_TICK_MS) {
      this.sinceTick -= R_TICK_MS;
      // `takeHeal` clamps to max health itself, so there is no arithmetic here
      // that could overheal.
      this.owner.takeHeal(R_REGEN_PER_TICK, this.owner);
    }

    if (this.ageMs >= R_DURATION_MS) this.toRemove = true;
  }

  /** Rides his body, so a square around this object's own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(140);
  }

  draw(): void {
    const at = this.position;
    const body = this.owner.animatedValues?.displaySize ?? 40;
    const closing = Math.max(0, Math.min(1, (R_DURATION_MS - this.ageMs) / 500));

    push();
    // Three ripples at different phases, drifting outward and dying. Water
    // closing over something, rather than a glow announcing it.
    noFill();
    for (let ring = 0; ring < 3; ring++) {
      const phase = ((this.ageMs / 900) + ring / 3) % 1;
      const spread = body * 0.6 + phase * 46;
      stroke(90, 200, 200, (70 - phase * 62) * closing);
      strokeWeight(2);
      circle(at.x, at.y, spread * 2);
    }

    // A thin displaced outline where his body is: enough for a player who
    // already knows to look, not enough to hand him to one who does not.
    stroke(150, 235, 225, 60 * closing);
    strokeWeight(1.5);
    circle(at.x + 3, at.y - 2, body);
    pop();
  }
}
