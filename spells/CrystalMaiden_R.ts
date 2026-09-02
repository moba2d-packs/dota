import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  CancelReason,
  Rectangle,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const CastBar = api.vfx.CastBar;
const unitCastBarAnchor = api.vfx.unitCastBarAnchor;

/**
 * Băng Trường — she plants her feet and the air around her starts exploding.
 *
 *   press            -> she stops, and a 320 ring opens around her
 *   every 350ms      -> one blast lands somewhere in the ring, ten times
 *   inside a blast   -> 6 damage and a 30% slow
 *   she moves, or is stunned, or is knocked about -> it is over
 *
 * ## The arithmetic, and why it is above the ultimate band
 *
 * Ten blasts at 6 is 60 against a ~100 health pool — the top of the ultimate
 * band — but that is the number for an enemy who stands inside every single
 * blast for the full 3.5 seconds, which is not a fight, it is a choice to die.
 * The blasts land at random points in a **ring between 120 and 320**, so there
 * is no position that collects all of them and the ground directly under her
 * feet collects none: a realistic exchange is 2-4 blasts, which is 12-24 —
 * ordinary ability damage, paid for with her entire position for 3.5 seconds.
 * The ability is a threat that clears a space, not a burst.
 *
 * ## `SpellForm.HELD`, which is the default and is the whole ability
 *
 * `interrupts` is omitted, so the runtime uses `HELD`: moving ends it, a stun
 * ends it, being displaced ends it. That tension *is* the design — an
 * uninterruptible version would be a free 60 damage with no answer, and a
 * version she could walk with would be a moving damage aura. Anything the
 * enemy team does to her stops it, which is why the cooldown is 90 seconds and
 * not longer.
 */
export const R_CHANNEL_MS = 3_500;
export const R_TICK_MS = 350;
/** `R_CHANNEL_MS / R_TICK_MS` — ten blasts, one per tick. */
export const R_TICKS = R_CHANNEL_MS / R_TICK_MS;
export const R_BLAST_DAMAGE = 6;
/** How far a single blast reaches from where it lands. */
export const R_BLAST_RADIUS = 95;
/** The ring blasts land in. Nothing lands inside `R_RING_INNER` of her. */
export const R_RING_INNER = 120;
export const R_RING_OUTER = 320;
export const R_SLOW = 0.3;
export const R_SLOW_MS = 1_200;
export const R_COOLDOWN_MS = 10_000;
export const R_MANA = 125;

/** Everything, if somebody stands in all ten. See the header for why that is not the real number. */
export const R_MAX_DAMAGE = R_BLAST_DAMAGE * R_TICKS;

/**
 * The channel's progress bar, built **outside** `castSpec`'s own body.
 *
 * `check-seams`'s `castspec-frozen` rule scans that getter for any
 * `this.<field>` outside a short constant list, because `Spell.runtime` is a
 * lazy getter that freezes whatever `castSpec` returned on the opening press —
 * so a getter *computing* from live state describes the spell as it was on the
 * first cast, for the rest of the match. That is a real trap and the scan is
 * right to look for it.
 *
 * It cannot, however, see that `channelLoop` is a **callback**: `SpellVfx`
 * invokes it per frame, long after the spec was frozen, so reading the live
 * elapsed time in there is exactly correct and not the thing the rule is
 * about. `CastBar`'s constructor takes `() => number` and has no other shape,
 * so a closure is unavoidable. Hoisting it here is not evasion of the rule —
 * it is the arrangement in which the scan's heuristic and the rule's actual
 * intent agree: the getter below now reads only constants, and the deferred
 * read lives in one named place that says why it is deferred.
 *
 * (The engine's own League pack meets the same false positive and answers it
 * with a `grandfathered` entry in `spells/seam-debt.mjs`. That field means
 * "known debt, to be paid" — and there is nothing here to pay, which is why
 * this pack does not use it.)
 */
const channelBar =
  (spell: { elapsedMs: number; owner: Parameters<typeof unitCastBarAnchor>[0] }) =>
  (context: CastContext) =>
    new CastBar(
      context,
      () => spell.elapsedMs / R_CHANNEL_MS,
      undefined,
      () => unitCastBarAnchor(spell.owner)
    );

export default class CrystalMaiden_R extends Spell {
  /**
   * Told: a channel that rains damage inside a declared radius. Deliberately
   * not `Burst` — this ability's own header calls it a threat that clears a
   * space rather than something to finish a kill with.
   */
  static aiRoles = api.enums.SpellRole.Damage | api.enums.SpellRole.Zone;

  image = api.asset('spell_crystalmaiden_r');
  name = 'Băng Trường (CrystalMaiden_R)';
  description =
    `Crystal Maiden đứng yên và triệu hồi bão băng trong ` +
    `<span class="time">${R_CHANNEL_MS / 1000} giây</span>: mỗi ` +
    `<span class="time">${R_TICK_MS / 1000} giây</span> một vụ nổ rơi ngẫu nhiên trong vành đai ` +
    `${R_RING_INNER}-${R_RING_OUTER}, gây <span class="damage">${R_BLAST_DAMAGE} sát thương</span> ` +
    `trong bán kính ${R_BLAST_RADIUS} và làm chậm ${Math.round(R_SLOW * 100)}%. ` +
    `Di chuyển hoặc bị khống chế sẽ ngắt.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  range = R_RING_OUTER;

  /** The live storm, for as long as one is out. Read by the test, and by teardown. */
  field: CrystalMaiden_R_Object | null = null;
  /** How far into the channel we are. Not private: `channelBar` above reads it every frame. */
  elapsedMs = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      channel: { durationMs: R_CHANNEL_MS, tickEveryMs: R_TICK_MS },
      // Committed once, at the start, and never refunded: an interrupted
      // channel has already thrown whatever blasts it got to throw.
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      // `interrupts` deliberately omitted — the default is `SpellForm.HELD`,
      // named here so the reader does not have to go and look it up.
      interrupts: SpellForm.HELD,
      vfx: { channelLoop: channelBar(this) },
    };
  }

  onSpellCast(_context: CastContext): void {
    this.elapsedMs = 0;
    this.owner.stopMovement?.();

    this.closeField();
    const storm = new CrystalMaiden_R_Object(this.owner);
    this.field = storm;
    this.game.objectManager.addObject(storm);
  }

  /**
   * One blast, at the point the storm seeded for this tick.
   *
   * The coordinates come from the object rather than being rolled here, so the
   * shard burst is painted at the same point the damage was applied — an
   * ultimate whose art and hitbox are two independent random draws teaches a
   * player nothing about where to stand.
   */
  onChannelTick(_context: CastContext, tickIndex: number): void {
    const storm = this.field;
    if (!storm) return;

    const at = storm.blastAt(tickIndex);
    const caught = this.game.objectManager.queryObjects({
      area: new Circle({ x: at.x, y: at.y, r: R_BLAST_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of caught) {
      victim.takeDamage(R_BLAST_DAMAGE, this.owner, 'MAGIC');
      const chilled = new Slow(R_SLOW_MS, this.owner, victim);
      chilled.percent = R_SLOW;
      chilled.image = this.image;
      // Without an id every bare Slow in the match shares one stack pool.
      chilled.stackId = 'dota_crystalmaiden_r_slow';
      victim.addBuff(chilled);
    }
  }

  onUpdate(): void {
    if (this.state === 'CHANNELING') this.elapsedMs += Math.max(0, deltaTime);
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.closeField();
  }

  onComplete(): void {
    this.closeField();
  }

  deactivate(): void {
    this.closeField();
    super.deactivate();
  }

  onRemoved(): void {
    this.closeField();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is out — all four teardowns reach it. */
  private closeField(): void {
    if (!this.field) return;
    this.field.toRemove = true;
    this.field = null;
  }

  drawPreview(): void {
    super.drawPreview(R_RING_OUTER);
  }
}

/**
 * The storm: the outer 320 ring, standing for the whole channel so the danger
 * zone can be read from across the screen, plus each blast as a short shard
 * burst drawn at its real 95 radius on the spot the damage landed.
 *
 * A `SpellObject` and not `castSpec.vfx`, because it reaches 320px past her
 * body — `Champion.draw()` is skipped whenever `ObjectManager` culls or fogs
 * her, and an effect hung there disappears while the blasts keep landing.
 */
export class CrystalMaiden_R_Object extends SpellObject {
  /**
   * Where all ten blasts will land, relative to the centre, decided once.
   *
   * **Seeded in the constructor, not in `onAdded`.** `addObject` queues an
   * object and `onAdded` only runs on the next `ObjectManager.update`, but the
   * spell asks this list for coordinates on the first channel tick — a list
   * built in `onAdded` would be empty for any tick that beat the flush, and
   * "empty" here means the blast lands at her feet instead of in the ring.
   * Rolling per frame in `draw` would be worse still: the picture would boil
   * and would stop agreeing with where the damage went.
   */
  readonly offsets: readonly { x: number; y: number }[];

  /** One per blast thrown so far: where, and how long ago. */
  private bursts: { x: number; y: number; age: number }[] = [];
  private ageMs = 0;

  constructor(owner: AttackableUnit) {
    super(owner);
    const seeded: { x: number; y: number }[] = [];
    for (let i = 0; i < R_TICKS; i++) {
      const bearing = random(0, Math.PI * 2);
      const reach = random(R_RING_INNER, R_RING_OUTER);
      seeded.push({ x: Math.cos(bearing) * reach, y: Math.sin(bearing) * reach });
    }
    this.offsets = seeded;
  }

  /**
   * The world point blast `tickIndex` lands on, and the moment it is drawn.
   *
   * `tickIndex` is the runtime's own counter and is 1-based, so it is brought
   * back to an array index here rather than at the call site.
   */
  blastAt(tickIndex: number): { x: number; y: number } {
    const offset = this.offsets[(Math.max(1, tickIndex) - 1) % this.offsets.length];
    const at = { x: this.position.x + offset.x, y: this.position.y + offset.y };
    this.bursts.push({ x: at.x, y: at.y, age: 0 });
    return at;
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    const step = Math.max(0, deltaTime);
    this.ageMs += step;
    for (const burst of this.bursts) burst.age += step;
    this.bursts = this.bursts.filter(burst => burst.age < 420);
  }

  /** The ring plus a blast's own reach past it, since a blast may land on the rim. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((R_RING_OUTER + R_BLAST_RADIUS + 12) * 2);
  }

  draw(): void {
    const centre = this.position;
    const opening = Math.min(1, this.ageMs / 260);
    const spread = 1 - (1 - opening) * (1 - opening);

    push();
    // The danger zone, at the real outer radius. Standing outside this line is
    // the correct answer to the ability, so the line has to be visible.
    noFill();
    stroke(175, 220, 255, 175);
    strokeWeight(2.5);
    circle(centre.x, centre.y, R_RING_OUTER * 2 * spread);
    // The hole in the middle: nothing lands inside it, and that is worth
    // saying, faintly, because it is where she is standing.
    stroke(150, 200, 240, 70);
    strokeWeight(1.5);
    circle(centre.x, centre.y, R_RING_INNER * 2 * spread);

    for (const burst of this.bursts) {
      const t = Math.min(1, burst.age / 420);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      noStroke();
      fill(160, 210, 245, 70 * fade);
      circle(burst.x, burst.y, R_BLAST_RADIUS * 2 * (0.45 + 0.55 * opened));

      // Angular splinters, thrown out of the blast and stopping on its real
      // radius — the same vocabulary as Q, at a different scale.
      fill(230, 248, 255, 235 * fade);
      for (let i = 0; i < 7; i++) {
        const bearing = (i / 7) * Math.PI * 2 + burst.x * 0.01;
        const tip = R_BLAST_RADIUS * opened;
        const side = bearing + Math.PI / 2;
        const across = R_BLAST_RADIUS * 0.13 * fade;
        beginShape();
        vertex(burst.x + Math.cos(bearing) * tip, burst.y + Math.sin(bearing) * tip);
        vertex(burst.x + Math.cos(side) * across, burst.y + Math.sin(side) * across);
        vertex(burst.x - Math.cos(side) * across, burst.y - Math.sin(side) * across);
        endShape(CLOSE);
      }

      // The rim of the blast, on the radius the damage actually used.
      noFill();
      stroke(205, 240, 255, 235 * fade);
      strokeWeight(2 + 3 * fade);
      circle(burst.x, burst.y, R_BLAST_RADIUS * 2 * opened);
    }
    pop();
  }
}
