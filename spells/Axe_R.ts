import type {
  AttackableUnit,
  ExecuteFallback,
  ExecuteSpell,
  Rectangle,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Speedup = api.buffs.Speedup;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const Reach = api.combat.Reach;
const effectiveHealth = api.combat.ExecuteTargeting.effectiveHealth;
const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
const BuffAddType = api.enums.BuffAddType;

/**
 * Lưỡi Hái Tử Thần — one swing that is a formality against anyone already
 * finished, and merely a heavy blow against anyone who is not.
 *
 *   press with a dying enemy in reach -> that one, and it kills them outright
 *   press with only healthy ones      -> the weakest of them takes a heavy blow
 *   the swing kills                   -> Axe and his side run it off, faster
 *   press with nobody in reach        -> refused, and it costs nothing
 *
 * ## Why this is `SELF` and picks its own victim
 *
 * There is no unit-targeted click in this game, so an execute has to choose.
 * Every ability that chose for itself before core's `ExecuteTargeting` existed
 * chose *nearest* — which is precisely the enemy you did not mean when a
 * different one is one blow from dead. The seam inverts that: lethality first,
 * geometry only to break a tie, with `executeFallback` deciding what happens
 * when nobody is killable.
 *
 * The same two methods feed the on-screen "this one dies" ring, which is why
 * `executeDamageAgainst` must be the *same formula* the swing actually uses.
 * An estimate that runs high paints a mark promising a kill the cast does not
 * deliver — so the two branches below are written once and read twice.
 *
 * **`executeCandidates` does no visibility filtering.** Core's own
 * `visibleCandidates` wrapper applies `canSee` around it, so the targeting and
 * the mark cannot disagree; a candidate query that filtered as well would be
 * the same rule stated twice, in two places, drifting apart.
 */
export const R_RANGE = 220;
/** At or under this much effective health, the swing is a beheading. */
export const R_THRESHOLD = 30;
/** What it does to anyone above the line. Inside the 40–60 band an ultimate belongs in. */
export const R_DAMAGE = 45;
export const R_HASTE_MS = 6_000;
export const R_HASTE_PCT = 0.3;
/** How far the kill's rush carries to his own side. */
export const R_HASTE_RADIUS = 700;
export const R_COOLDOWN_MS = 30_000;
export const R_MANA = 50;

export default class Axe_R extends Spell implements ExecuteSpell {
  image = api.asset('spell_axe_r');
  name = 'Lưỡi Hái Tử Thần (Axe_R)';
  description =
    `Chém một đòn quyết định vào kẻ địch gần nhất trong tầm ${R_RANGE}. ` +
    `Nếu mục tiêu còn <span class="damage">${R_THRESHOLD} máu</span> trở xuống, ` +
    `<span class="buff">hành quyết ngay lập tức</span>; nếu không, gây ` +
    `<span class="damage">${R_DAMAGE} sát thương</span>. ` +
    `Giết được mục tiêu sẽ <span class="buff">tăng ${Math.round(R_HASTE_PCT * 100)}% tốc chạy</span> ` +
    `cho Axe và đồng đội trong <span class="time">${R_HASTE_MS / 1000} giây</span>.`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  /** Auto-locking: the seam below picks the victim, not the cursor. */
  targetingMode = 'SELF' as const;
  range = R_RANGE;

  /** With nobody killable, take the one closest to dying rather than the closest. */
  readonly executeFallback: ExecuteFallback = 'weakest';

  /** The swing that is out, for as long as one is. Read by the test. */
  live: Axe_R_Object | null = null;

  checkCastCondition(): boolean {
    return !!this.findVictim();
  }

  findVictim(): AttackableUnit | null {
    return pickExecuteTarget(this);
  }

  /**
   * Everyone in reach. No visibility filter and no re-check of the radius —
   * core wraps this with `canSee`, and `Reach.effectiveRange` is the same
   * number the description states.
   */
  executeCandidates(): AttackableUnit[] {
    return this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: Reach.effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];
  }

  /**
   * The blow, as a number. Both branches are what `onSpellCast` actually deals
   * — see the header on why that identity is the whole contract.
   */
  executeDamageAgainst(target: AttackableUnit): number {
    const pool = effectiveHealth(target);
    return pool <= R_THRESHOLD ? pool : R_DAMAGE;
  }

  onSpellCast(): void {
    const victim = this.findVictim();
    if (!victim) return;

    const pool = effectiveHealth(victim);
    const beheading = pool <= R_THRESHOLD;

    // The kill test is that `takeDamage` is synchronous: latch alive before,
    // read dead after. Anything that waits a frame credits the wrong swing.
    const wasAlive = !victim.isDead;
    victim.takeDamage(
      this.executeDamageAgainst(victim),
      this.owner,
      // A beheading is dealt as `TRUE` so armour cannot leave the victim
      // standing on one point after the mark promised they would not.
      beheading ? 'TRUE' : 'MAGIC',
      'Lưỡi Hái Tử Thần'
    );
    const killed = wasAlive && victim.isDead;

    if (killed) this.payTheTeam();

    const swing = new Axe_R_Object(this.owner);
    swing.victim = victim;
    swing.beheading = beheading;
    this.live = swing;
    this.game.objectManager.addObject(swing);
  }

  /** The rush a kill buys, for him and whoever is close enough to share it. */
  private payTheTeam(): void {
    const nearby = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: R_HASTE_RADIUS,
      }),
      // `type(AttackableUnit)` first: `SpellObject` copies its owner's `teamId`,
      // so team alone also returns every friendly spell object in range — a
      // swing still on the field from the last kill among them — and handing one
      // a buff is `addBuff` on something that has no such method. See
      // `VengefulSpirit_E`'s own note for what that `TypeError` does to a match.
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
      ],
    });

    const paid = new Set<AttackableUnit>([this.owner, ...nearby]);
    for (const ally of paid) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      const rush = new Speedup(R_HASTE_MS, this.owner, ally);
      rush.percent = R_HASTE_PCT;
      // A second kill inside the window rewinds one haste rather than stacking
      // a second onto the same body.
      rush.buffAddType = BuffAddType.RENEW_EXISTING;
      rush.image = this.image;
      rush.stackId = 'dota_axe_r_rush';
      ally.addBuff(rush);
    }
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}

/**
 * The swing, landing on the one it was aimed at.
 *
 * A beheading and an ordinary blow are drawn as two visibly different things —
 * one rule, one region: the blow is a single arc and a bright impact, the
 * beheading adds a ring closing *inward* on the body plus a burst, because the
 * two outcomes are the entire decision the ability makes and a player has to be
 * able to tell from across the screen which one they just got.
 */
export class Axe_R_Object extends SpellObject {
  /** Who it landed on. Set by the spell. */
  victim: AttackableUnit | null = null;
  /** Whether this was the beheading branch. */
  beheading = false;

  private ageMs = 0;
  private readonly lifeTime = 420;
  /** Where the victim was when it landed — a corpse stops moving, but may be removed. */
  private struck = createVector(0, 0);

  onAdded(): void {
    if (this.victim) this.struck.set(this.victim.position.x, this.victim.position.y);
  }

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /**
   * Spans the caster and the place the blow landed — the arc is drawn between
   * them, so a square around either centre would clip it.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = 70;
    const left = Math.min(this.owner.position.x, this.struck.x) - pad;
    const top = Math.min(this.owner.position.y, this.struck.y) - pad;
    const right = Math.max(this.owner.position.x, this.struck.x) + pad;
    const bottom = Math.max(this.owner.position.y, this.struck.y) + pad;
    // `data: this` is not optional — the display quadtree reads
    // `entry.data.zIndex` back off this rectangle.
    return new Rectangle({ x: left, y: top, w: right - left, h: bottom - top, data: this });
  }

  draw(): void {
    const t = Math.min(1, this.ageMs / this.lifeTime);
    const swept = 1 - (1 - t) * (1 - t);
    const fading = 1 - t;
    const landed = this.struck;

    push();
    // The chop: an arc travelling from Axe into the victim, so the direction
    // of the blow is unambiguous. It sweeps inward because that is where the
    // damage went.
    const dx = landed.x - this.owner.position.x;
    const dy = landed.y - this.owner.position.y;
    const heading = Math.atan2(dy, dx);
    const span = Math.hypot(dx, dy);
    noFill();
    stroke(236, 88, 46, 220 * fading);
    strokeWeight(6 * fading + 2);
    const reach = span * (0.25 + swept * 0.85);
    arc(
      this.owner.position.x,
      this.owner.position.y,
      reach * 2,
      reach * 2,
      heading - 0.55,
      heading + 0.55
    );

    // The impact, on the body that took it.
    noStroke();
    fill(255, 236, 214, 200 * fading);
    circle(landed.x, landed.y, 26 + swept * 22);

    if (this.beheading) {
      // A beheading only: a hard ring closing *in* on the spot, and a burst of
      // shards out of it. Two motions, opposite directions, so this never reads
      // as the ordinary blow above.
      const closing = 1 - swept;
      noFill();
      stroke(255, 70, 50, 235 * fading);
      strokeWeight(4);
      circle(landed.x, landed.y, 40 + closing * 130);

      stroke(255, 190, 150, 220 * fading);
      strokeWeight(3);
      for (let shard = 0; shard < 8; shard++) {
        const away = (shard / 8) * Math.PI * 2;
        const inner = 14 + swept * 26;
        const outer = inner + 22 * fading + 8;
        line(
          landed.x + Math.cos(away) * inner,
          landed.y + Math.sin(away) * inner,
          landed.x + Math.cos(away) * outer,
          landed.y + Math.sin(away) * outer
        );
      }
    }
    pop();
  }
}
