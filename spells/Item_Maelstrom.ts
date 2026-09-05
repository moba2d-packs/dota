import type { AttackableUnit, CastSpec, OnHitEvent, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;

/**
 * Búa Bão Tố — every third swing, the hammer answers with lightning.
 *
 *   swing, swing   -> ordinary hits, the charge builds
 *   the third      -> a bolt: magic damage to the target and to the two
 *                     enemies standing nearest them
 *   alone          -> the bolt still fires; it simply has nowhere to jump
 *
 * ## Counted, like the basher, and for the same reason
 *
 * The source item procs on a chance; this one procs on the count (see
 * `Item_Basher.ts` for the whole argument). The two counters deliberately
 * differ — three and four — so a carry holding both is not handed one rhythm
 * with two payloads.
 *
 * ## The chain damage is its own hit, in its own colour
 *
 * `OnHitEvent.damage` is what the swing landed for; the lightning does not
 * scale off it and does not fold into it — each strike is a separate
 * `takeDamage` of `CHAIN_DAMAGE`, typed `MAGIC`, labelled for the recap. And
 * the proc itself must never count toward the next proc, which is what the
 * `echo` check refuses: a chain that stepped its own counter would cascade.
 *
 * ## Jumps are measured from the *victim*
 *
 * The lightning spreads from the body that was struck, not from the wielder —
 * a melee carry in a scrum chains to the scrum, and a sniper poking one
 * isolated target gets exactly the one bolt. That is what makes the item a
 * teamfight purchase rather than a flat damage rider.
 */
export const HITS_PER_CHAIN = 3;
export const CHAIN_DAMAGE = 8;
/** How far the lightning jumps, measured from the struck victim. */
export const CHAIN_RADIUS = 250;
/** How many extra bodies one bolt reaches beyond the victim. */
export const CHAIN_TARGETS = 2;
export const STACK_ID = 'dota_item_maelstrom';

export class Item_Maelstrom_Charge extends Buff {
  name = 'Búa Bão Tố';
  hudVisible = false;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;

  /** Swings landed since the last bolt. */
  private count = 0;

  onHit(hit: OnHitEvent): void {
    if (hit.echo) return;
    const victim = hit.victim;
    if (!victim || victim.isDead || victim.toRemove) return;

    this.count += 1;
    if (this.count < HITS_PER_CHAIN) return;
    this.count = 0;

    const wielder = this.targetUnit;
    const struck: AttackableUnit[] = [victim];

    // The two nearest other enemies, measured from the victim — see the header.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: victim.position.x, y: victim.position.y, r: CHAIN_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(wielder.teamId)],
    }) as AttackableUnit[];
    const jumps = found
      .filter(
        other =>
          other &&
          other !== victim &&
          !other.isDead &&
          !other.toRemove &&
          other.position.dist(victim.position) <= CHAIN_RADIUS
      )
      .sort((a, b) => a.position.dist(victim.position) - b.position.dist(victim.position))
      .slice(0, CHAIN_TARGETS);
    struck.push(...jumps);

    for (const body of struck) {
      body.takeDamage(CHAIN_DAMAGE, wielder, 'MAGIC', 'Búa Bão Tố');
    }

    const bolt = new Item_Maelstrom_Object(wielder);
    bolt.strike(victim, jumps);
    this.game.objectManager.addObject(bolt);
  }
}

export default class Item_Maelstrom extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_maelstrom');
  name = 'Búa Bão Tố (Item_Maelstrom)';
  description =
    `Nội tại: mỗi đòn đánh thường thứ 3 phóng sét — ${dmg(CHAIN_DAMAGE, 'MAGIC')} ` +
    `lên mục tiêu và tối đa ${CHAIN_TARGETS} kẻ địch đứng gần mục tiêu.`;
  coolDown = 0;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: 0 },
    };
  }

  onSpellCast(): void {
    const armed = new Item_Maelstrom_Charge(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID + '_armed';
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }
}

/** How long one bolt stays on screen. */
export const BOLT_MS = 220;

/**
 * The lightning, as a snapshot: the arcs are frozen where the bodies were at
 * the strike, because that is when the damage happened. A bolt that chased
 * its targets for a fifth of a second would claim hits that never occurred.
 *
 * The jag is deterministic — offsets come off a sine of the segment index, so
 * the same bolt draws the same shape every frame and merely fades.
 */
export class Item_Maelstrom_Object extends SpellObject {
  /** World-space arcs: wielder -> victim, then victim -> each jump. */
  arcs: { fromX: number; fromY: number; toX: number; toY: number }[] = [];

  private ageMs = 0;

  strike(victim: AttackableUnit, jumps: AttackableUnit[]): void {
    this.position.set(victim.position.x, victim.position.y);
    this.arcs = [
      {
        fromX: this.owner.position.x,
        fromY: this.owner.position.y,
        toX: victim.position.x,
        toY: victim.position.y,
      },
      ...jumps.map(jump => ({
        fromX: victim.position.x,
        fromY: victim.position.y,
        toX: jump.position.x,
        toY: jump.position.y,
      })),
    ];
  }

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= BOLT_MS) this.toRemove = true;
  }

  /** A snapshot of scattered points, so the box is hand-rolled over all of them. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x;
    let top = this.position.y;
    let right = this.position.x;
    let bottom = this.position.y;
    for (const arc of this.arcs) {
      left = Math.min(left, arc.fromX, arc.toX);
      top = Math.min(top, arc.fromY, arc.toY);
      right = Math.max(right, arc.fromX, arc.toX);
      bottom = Math.max(bottom, arc.fromY, arc.toY);
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
    const fade = Math.max(0, 1 - this.ageMs / BOLT_MS);

    push();
    noFill();
    strokeCap(ROUND);
    for (let index = 0; index < this.arcs.length; index++) {
      const arc = this.arcs[index];
      const dx = arc.toX - arc.fromX;
      const dy = arc.toY - arc.fromY;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      // Perpendicular unit, for the zigzag offsets.
      const px = -dy / length;
      const py = dx / length;

      // A dim wide pass under a bright narrow one — a bolt, not a wire.
      for (const [weight, alpha] of [
        [4, 60],
        [1.8, 210],
      ] as const) {
        stroke(150, 200, 255, alpha * fade);
        strokeWeight(weight);
        beginShape();
        vertex(arc.fromX, arc.fromY);
        for (let step = 1; step < 6; step++) {
          const along = step / 6;
          // Deterministic jag: fixed per segment and per arc, fading nothing.
          const jag = Math.sin(index * 5.1 + step * 3.7) * Math.min(14, length * 0.1);
          vertex(arc.fromX + dx * along + px * jag, arc.fromY + dy * along + py * jag);
        }
        vertex(arc.toX, arc.toY);
        endShape();
      }
      // A flash where each strike landed.
      noStroke();
      fill(210, 235, 255, 140 * fade);
      circle(arc.toX, arc.toY, 14 * fade + 4);
      noFill();
    }
    pop();
  }
}
