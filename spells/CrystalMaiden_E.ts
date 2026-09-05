import type { AttackableUnit, CastContext, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;

/**
 * Hào Quang Pháp Thuật — a field she carries for eight seconds that hands mana
 * back to everyone on her side standing in it, herself included.
 *
 *   press                  -> the field opens around her and follows her
 *   every 500ms            -> every ally inside 400 gets 3 mana, and a mote to say so
 *   she dies               -> it goes with her
 *
 * ## It gives back more than it costs, on purpose
 *
 * 8000ms at one pulse per 500ms is 16 pulses; 16 x 3 = 48 mana handed out per
 * ally in range for the whole duration, against a 30 mana price. On herself
 * alone that is +18 over the life of one cast, and with two allies beside her
 * it is +114. A support aura that came out behind is a button nobody presses;
 * the cost is there to stop it being spammed on an empty lane, not to make the
 * arithmetic close.
 *
 * ## `restoreMana`, never `stats.mana`
 *
 * Granting is not billing. `spendMana` is the one door for *charging* a caster
 * and it runs through the match rules, which is why a rules variant can zero
 * every cost in the game with one flip — and why a refill written against the
 * same field would be zeroed with them. `AttackableUnit.restoreMana` lives out
 * on the unit beside `takeHeal` precisely so that cannot happen.
 *
 * ## No vision filter
 *
 * This does not *pick* a unit: it grants to every ally its circle overlaps, so
 * an ally in an unlit bush inside the field is fed exactly like one in the
 * open. `visibleTo` is the gate on acquisition, and there is no acquisition
 * here.
 */
export const E_RADIUS = 400;
export const E_DURATION_MS = 8_000;
export const E_TICK_MS = 500;
export const E_MANA_PER_TICK = 3;
/** Trimmed under the practice room's 20s cooldown ceiling. */
export const E_COOLDOWN_MS = 15_000;
export const E_MANA = 30;

/** 16 pulses over the life of one cast. Exported so the test never restates the arithmetic. */
export const E_TICKS = E_DURATION_MS / E_TICK_MS;
/** What one ally standing in it for the whole duration is handed: 48. */
export const E_TOTAL_PER_ALLY = E_TICKS * E_MANA_PER_TICK;

export default class CrystalMaiden_E extends Spell {
  /**
   * `Buff` alone: the aura restores mana, and `scoreSpell` has no term for
   * mana at all. Flat 5 is what a steroid is worth here, and 5 is a number a
   * bot can act on — the inferred `Buff | Shield` came to 0.
   */
  static aiRoles = api.enums.SpellRole.Buff;

  image = api.asset('spell_crystalmaiden_e');
  name = 'Hào Quang Pháp Thuật (CrystalMaiden_E)';
  description =
    `Mở một vùng hào quang bán kính ${E_RADIUS} quanh Crystal Maiden trong ` +
    `<span class="time">${E_DURATION_MS / 1000} giây</span>. Mỗi ` +
    `<span class="time">${E_TICK_MS / 1000} giây</span>, đồng minh bên trong (kể cả cô) hồi ` +
    `<span class="buff">${E_MANA_PER_TICK} năng lượng</span> ` +
    `(tổng <span class="buff">${E_TOTAL_PER_ALLY}</span>).`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = E_RADIUS;

  /** The live field, for as long as one is out. Read by the test, and by teardown. */
  aura: CrystalMaiden_E_Object | null = null;

  onSpellCast(_context: CastContext): void {
    this.dropAura();
    const field = new CrystalMaiden_E_Object(this.owner);
    this.aura = field;
    this.game.objectManager.addObject(field);
  }

  /**
   * The activation is instant — `PRESS`, no channel, no active window — so
   * `onComplete` fires inside the same keypress as `onSpellCast` and hanging
   * teardown there would delete the field on the frame it opened. The field
   * runs on its own clock and ends itself; these two hooks are the scene going
   * away underneath it.
   */
  deactivate(): void {
    this.dropAura();
    super.deactivate();
  }

  onRemoved(): void {
    this.dropAura();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is out. */
  private dropAura(): void {
    if (!this.aura) return;
    this.aura.toRemove = true;
    this.aura = null;
  }

  drawPreview(): void {
    super.drawPreview(E_RADIUS);
  }
}

/**
 * The field. A `SpellObject` and not `castSpec.vfx` because it reaches 400px
 * past her body — `Champion.draw()` is skipped whenever `ObjectManager` culls
 * or fogs her, and an effect hung there disappears while the mana keeps
 * arriving.
 *
 * It owns the pulse clock as well as the drawing, so what the motes show is
 * literally who was fed.
 */
export class CrystalMaiden_E_Object extends SpellObject {
  ticksDone = 0;
  private ageMs = 0;
  private sinceTickMs = 0;

  /** One per ally fed on the last pulse: where it is going, and how far along it is. */
  private motes: { toX: number; toY: number; age: number }[] = [];

  /**
   * Seeded at construction rather than in `onAdded`: `addObject` only calls
   * `onAdded` on the next `ObjectManager.update`, and a phase re-rolled inside
   * `draw` makes the rings jitter instead of turn.
   */
  private readonly phase: number = random(0, Math.PI * 2);

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;
    this.sinceTickMs += step;
    for (const mote of this.motes) mote.age += step;
    // A mote's whole job is to say "that one, just now"; past 400ms it is
    // saying it about a pulse that has already been replaced.
    this.motes = this.motes.filter(mote => mote.age < 400);

    while (this.sinceTickMs >= E_TICK_MS && this.ticksDone < E_TICKS) {
      this.sinceTickMs -= E_TICK_MS;
      this.ticksDone += 1;
      this.pulse();
    }

    if (this.ticksDone >= E_TICKS || this.ageMs >= E_DURATION_MS) this.toRemove = true;
  }

  /** One pulse: everyone on her side inside the ring is handed mana, and shown getting it. */
  private pulse(): void {
    const fed = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: E_RADIUS }),
      filters: [
        // `type` narrows to the unit class, `teamId` to her own side, and
        // `excludeDead` drops corpses. Deliberately not `canTakeDamageFromTeam`
        // inverted: this is not a hit and an untargetable ally is still an ally.
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
        PredefinedFilters.excludeDead,
      ],
    }) as AttackableUnit[];

    for (const ally of fed) {
      ally.restoreMana(E_MANA_PER_TICK);
      this.motes.push({ toX: ally.position.x, toY: ally.position.y, age: 0 });
    }
  }

  /** Paints the whole 400 ring, so the box is that ring plus its stroke. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((E_RADIUS + 16) * 2);
  }

  draw(): void {
    const centre = this.position;
    const opening = Math.min(1, this.ageMs / 320);
    const spread = 1 - (1 - opening) * (1 - opening);
    const closing = Math.max(0, Math.min(1, (E_DURATION_MS - this.ageMs) / 400));
    const strength = spread * closing;

    push();
    noStroke();
    fill(150, 200, 245, 16 * strength);
    circle(centre.x, centre.y, E_RADIUS * 2 * spread);

    // Concentric rings, the outermost one on the real 400 radius: the player
    // has to be able to see where the field stops without counting bodies.
    noFill();
    for (let i = 0; i < 3; i++) {
      const breathe = 0.62 + 0.38 * i + 0.02 * Math.sin(this.phase + this.ageMs / 420 + i);
      stroke(185, 225, 255, (i === 2 ? 190 : 95) * strength);
      strokeWeight(i === 2 ? 2.5 : 1.5);
      circle(centre.x, centre.y, E_RADIUS * 2 * Math.min(1, breathe) * spread);
    }

    // One mote per ally fed on the last pulse, travelling from her to them —
    // this is what turns "somebody got mana" into "you did, and so did they".
    noStroke();
    for (const mote of this.motes) {
      const travelled = Math.min(1, mote.age / 260);
      const eased = 1 - (1 - travelled) * (1 - travelled);
      const moteX = centre.x + (mote.toX - centre.x) * eased;
      const moteY = centre.y + (mote.toY - centre.y) * eased;
      fill(215, 245, 255, 235 * (1 - travelled));
      circle(moteX, moteY, 9 - 4 * travelled);
      fill(160, 210, 250, 120 * (1 - travelled));
      circle(moteX, moteY, 16 - 7 * travelled);
    }
    pop();
  }
}
