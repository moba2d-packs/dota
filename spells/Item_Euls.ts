import type {
  AttackableUnit,
  CastContext,
  CastSpec,
  Rectangle,
  TargetingRequest,
} from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Unit = api.units.AttackableUnit;
const Airborne = api.buffs.Airborne;
const Untargetable = api.buffs.Untargetable;
const Rectangle = api.utils.Quadtree.Rectangle;
const TargetResolver = api.combat.TargetResolver;
const Reach = api.combat.Reach;

/**
 * Vương Trượng Eul's active: one enemy goes up in a cyclone and comes down a
 * second and a half later, having missed the fight.
 *
 *   press on an enemy within 550 -> the wind takes them off their feet
 *   while they are up            -> nothing can touch them, either way
 *   1.5s                         -> they land, and both halves end together
 *
 * ## The untargetable beat is the item, not a rider on it
 *
 * `Airborne` alone would make this a stun with a longer animation. The point of
 * a cyclone is that the victim is *removed from the fight in both directions* —
 * they cannot act and cannot be finished off — which is what makes Eul's a
 * setup tool for the caster's team and, in Dota, a self-cast escape. So the two
 * buffs are applied together and given the same duration, and the test checks
 * they end together rather than leaving somebody permanently untouchable on the
 * ground.
 *
 * ## Enemy only, and why that is a narrowing rather than a missing half
 *
 * Dota's Eul's takes either side. A `UNIT` spell that accepted both would have
 * to declare `targetTeam: 'ANY'`, and `'ANY'` includes `request.caster` — a
 * press over empty ground then resolves the wearer and cyclones *him*. Four
 * shipped abilities in this engine have had exactly that bug, so `'ENEMY'`
 * closes it by construction.
 */
export const CYCLONE_MS = 1_500;
export const RANGE = 550;
/** Trimmed under the practice room's 20s cooldown ceiling, kept just under Blade Mail's so the two items keep their relative order. */
export const COOLDOWN_MS = 11_000;
/** How high the wind takes them. `Airborne`'s own default is a gentler 20. */
export const LIFT = 34;

export default class Item_Euls extends Spell {
  image = api.asset('item_euls_scepter');
  name = 'Vương Trượng Eul (Item_Euls)';
  description =
    `Kích hoạt: <span class="buff">cuốn tung</span> một tướng địch trong ` +
    `<span class="time">${CYCLONE_MS / 1000} giây</span>. Trong lúc bay, mục tiêu ` +
    `<span class="buff">không thể hành động và cũng không thể bị nhắm tới</span>. ` +
    `Không gây sát thương.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  range = RANGE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  get targetingRequest(): Readonly<TargetingRequest> {
    return {
      ...super.targetingRequest,
      range: Reach.effectiveRange(this.range, this.owner),
      targetTeam: 'ENEMY',
      queryCandidates: () => this.game.objectManager.objects,
      isTargetable: candidate => this.isValidTarget(candidate),
      getTargetInfo: candidate =>
        this.isValidTarget(candidate)
          ? {
              position: candidate.position,
              teamId: candidate.teamId,
              selectionRadius: candidate.animatedValues?.displaySize
                ? candidate.animatedValues.displaySize / 2
                : candidate.collisionRadius,
            }
          : null,
    };
  }

  private isValidTarget(target?: unknown): target is AttackableUnit {
    return (
      target instanceof Unit &&
      !target.isDead &&
      !target.toRemove &&
      target !== this.owner &&
      target.teamId !== this.owner.teamId &&
      Reach.withinRange(RANGE, this.owner, target)
    );
  }

  checkCastCondition(): boolean {
    return this.isValidTarget(this.castContext?.target);
  }

  press(context: CastContext): boolean {
    if (context.target !== undefined) {
      if (!this.isValidTarget(context.target)) return false;
      return super.press(context);
    }
    const resolved = TargetResolver.resolve('UNIT', {
      ...context,
      casterTeamId: this.owner.teamId,
      ...this.targetingRequest,
    });
    return resolved.ok ? super.press(resolved.context) : false;
  }

  onSpellCast(context: CastContext): void {
    const victim = context?.target as AttackableUnit | undefined;
    if (!this.isValidTarget(victim)) return;

    const lifted = new Airborne(CYCLONE_MS, this.owner, victim);
    lifted.height = LIFT;
    lifted.image = this.image;
    victim.addBuff(lifted);

    // Same duration, deliberately: the two are one effect to the player, and a
    // mismatch is either a body that lands still untouchable or one that can be
    // shot out of the air.
    const outOfReach = new Untargetable(CYCLONE_MS, this.owner, victim);
    outOfReach.image = this.image;
    outOfReach.stackId = 'dota_item_euls_cyclone';
    victim.addBuff(outOfReach);

    const wind = new Item_Euls_Object(this.owner);
    wind.victim = victim;
    wind.attachTo(victim, lifted);
    this.game.objectManager.addObject(wind);
  }

  drawPreview(): void {
    super.drawPreview(Reach.effectiveRange(this.range, this.owner));
  }
}

/**
 * The cyclone: a funnel of stacked rings around the victim, narrow at the
 * bottom and wide at the top.
 *
 * It rides the victim rather than the ground it started over, and it is drawn
 * *upward* — the rings climb over the object's life — because the buff lifts
 * them. Art spreading outward along the floor would say "an area happened
 * here", which is a different item.
 */
export class Item_Euls_Object extends SpellObject {
  /** Who is in the air. Set by the spell. */
  victim: AttackableUnit | null = null;

  private ageMs = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    const victim = this.victim;
    if (!victim || victim.isDead || victim.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(victim.position.x, victim.position.y);
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= CYCLONE_MS) this.toRemove = true;
  }

  /** Rides the victim, so a square around this object's own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(160);
  }

  draw(): void {
    const at = this.position;
    const body = this.victim?.animatedValues?.displaySize ?? 40;
    const t = Math.min(1, this.ageMs / CYCLONE_MS);
    // Spins up quickly, holds, and drops them at the end.
    const spun = Math.min(1, this.ageMs / 240);
    const settling = Math.max(0, Math.min(1, (CYCLONE_MS - this.ageMs) / 260));

    push();
    noFill();
    strokeCap(ROUND);
    // Five rings climbing the funnel: the lowest is tight to the feet, the
    // highest is wide and faint. Their vertical offsets are what make this read
    // as lift rather than as a ring on the floor.
    for (let ring = 0; ring < 5; ring++) {
      const up = ring / 4;
      const lift = up * (body * 0.95) * spun;
      const width = body * (0.42 + up * 0.75) * spun;
      // Each ring turns at its own rate, so the funnel shears the way wind does.
      const wobble = Math.sin(this.ageMs / 90 + ring * 1.3) * 3 * spun;
      stroke(176, 214, 236, (200 - up * 90) * settling);
      strokeWeight(2.5 - up);
      ellipse(at.x + wobble, at.y - lift, width * 2, width * 0.72);
    }

    // Two streaks corkscrewing up the outside, so the direction of the spin is
    // legible and it does not read as five unrelated hoops.
    for (let streak = 0; streak < 2; streak++) {
      const phase = this.ageMs / 110 + streak * Math.PI;
      stroke(226, 242, 250, 170 * settling);
      strokeWeight(2);
      beginShape();
      for (let step = 0; step <= 6; step++) {
        const up = step / 6;
        const wide = body * (0.42 + up * 0.75) * spun;
        vertex(
          at.x + Math.cos(phase + up * 4.2) * wide,
          at.y - up * (body * 0.95) * spun + Math.sin(phase + up * 4.2) * wide * 0.34
        );
      }
      endShape();
    }
    // A faint shadow drawn small on the ground, so a player can still tell
    // where the body will land.
    noStroke();
    fill(30, 40, 50, 70 * (1 - t) * settling);
    ellipse(at.x, at.y + body * 0.3, body * 0.5, body * 0.2);
    pop();
  }
}
