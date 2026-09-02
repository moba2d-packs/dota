import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Taunt = api.buffs.Taunt;
const StatAmp = api.buffs.StatAmp;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;

/**
 * Tiếng Gọi Cuồng Nộ — he roars, and everyone close enough has to come and
 * swing at him whether they meant to or not.
 *
 *   press            -> the roar goes out as a ring at the radius it really has
 *   anyone inside it -> stops what they were doing and walks at Axe
 *   for as long as it lasts -> his armour is up, because he asked for this
 *   it ends          -> they get their own orders back
 *
 * ## Why there is no damage line here
 *
 * Berserker's Call deals none in Dota, and giving it some would make it the
 * wrong ability: the whole point is that it is the *setup*, and what collects
 * is `Axe_E`'s helix spinning into four bodies that were made to stand next to
 * him. An ability that already taunts, buys armour and deals a nuke's worth of
 * damage would not need the rest of the kit.
 *
 * ## The one thing a taunt must not do
 *
 * `Taunt` leaves `CAN_ATTACK` and `CAN_MOVE` alone — it is the one control
 * effect that does, and core's own buff is what gets that right. Clearing
 * `CAN_ATTACK` would make `BasicAttackController` drop the forced order on the
 * same frame it was given; clearing `CAN_MOVE` would root the victim out of
 * reach and leave him roaring at four people who cannot reach him. This spell
 * therefore applies the engine's `Taunt` and adds nothing of its own to the
 * victim.
 */
export const Q_RADIUS = 260;
export const Q_TAUNT_MS = 2_200;
/** Flat armour while the roar lasts. He is standing in the middle of it on purpose. */
export const Q_ARMOR = 8;
export const Q_COOLDOWN_MS = 15_000;
export const Q_MANA = 45;

export default class Axe_Q extends Spell {
  /**
   * Told: the taunt is the ability. It deals no damage at all, so `Damage`
   * is off — what it does is force everyone in the radius onto him, which is
   * exactly the case `Cc` is priced for, plus the armour to survive having
   * done it.
   */
  static aiRoles = api.enums.SpellRole.Cc | api.enums.SpellRole.Buff | api.enums.SpellRole.Zone;

  image = api.asset('spell_axe_q');
  name = 'Tiếng Gọi Cuồng Nộ (Axe_Q)';
  description =
    `Axe gầm lên, <span class="buff">khiêu khích</span> mọi kẻ địch trong bán kính ` +
    `${Q_RADIUS} trong <span class="time">${Q_TAUNT_MS / 1000} giây</span>, buộc chúng ` +
    `phải đánh hắn. Trong lúc đó Axe nhận <span class="buff">+${Q_ARMOR} giáp</span>.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'SELF' as const;
  range = Q_RADIUS;

  /** The roar that is out, for as long as one is. Read by the test. */
  live: Axe_Q_Object | null = null;

  onSpellCast(): void {
    // Armour first, so it is already up on the frame the first taunted body
    // starts walking at him.
    const braced = new StatAmp(Q_TAUNT_MS, this.owner, this.owner);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build its
    // modifier and `addBuff` is what runs it. Assigning afterwards fails
    // silently.
    braced.bonuses = { armor: { flatBonus: Q_ARMOR } };
    braced.image = this.image;
    // Without an id it shares one stack pool with every other bare `StatAmp`
    // in the match, including an enemy's.
    braced.stackId = 'dota_axe_q_armor';
    this.owner.addBuff(braced);

    const called = this.enemiesInEarshot();
    for (const victim of called) {
      const forced = new Taunt(Q_TAUNT_MS, this.owner, victim);
      forced.image = this.image;
      forced.stackId = 'dota_axe_q_taunt';
      victim.addBuff(forced);
    }

    const roar = new Axe_Q_Object(this.owner);
    roar.called = called;
    this.live = roar;
    this.game.objectManager.addObject(roar);
  }

  /**
   * **No vision filter, deliberately.** Vision gates *acquisition* — picking
   * one unit out of a crowd — and never damage or an area effect. A champion
   * standing in an unlit bush two paces from a roaring Axe can hear him.
   */
  private enemiesInEarshot(): AttackableUnit[] {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: Q_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];
    // `queryObjects` answers with everything whose *bounds* meet the circle, so
    // the edge is re-checked against the radius the description states.
    return found.filter(
      unit => unit && !unit.isDead && unit.position.dist(this.owner.position) <= Q_RADIUS
    );
  }

  drawPreview(): void {
    super.drawPreview(Q_RADIUS);
  }
}

/**
 * The roar: one ring at the true radius, and a leash from each victim back to
 * him.
 *
 * The leashes are the part that carries information. A ring alone says "an
 * area happened"; the leashes say *who is now walking at Axe*, which is the
 * only thing this ability actually did. They are drawn pointing **inward**,
 * along the victim's own path home, because the buff pulls them in — an
 * outward sweep over an inward pull tells the player the opposite of what the
 * game just did.
 */
export class Axe_Q_Object extends SpellObject {
  /** Who the roar caught. Set by the spell, read only for drawing. */
  called: AttackableUnit[] = [];

  private ageMs = 0;
  private readonly lifeTime = Q_TAUNT_MS;

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime || this.owner.isDead) this.toRemove = true;
  }

  /**
   * The leashes reach out to bodies that move independently of this object's
   * own centre, so the box spans them rather than being a square around it —
   * `squareDisplayBoundingBox` memoises on `(position, size)` and would go
   * stale the moment a victim walked without Axe moving.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - Q_RADIUS;
    let top = this.position.y - Q_RADIUS;
    let right = this.position.x + Q_RADIUS;
    let bottom = this.position.y + Q_RADIUS;
    for (const victim of this.called) {
      if (!victim || victim.isDead) continue;
      left = Math.min(left, victim.position.x);
      top = Math.min(top, victim.position.y);
      right = Math.max(right, victim.position.x);
      bottom = Math.max(bottom, victim.position.y);
    }
    // `data: this` is not optional — `ObjectManager` puts this rectangle
    // straight into the display quadtree and the draw pass reads
    // `entry.data.zIndex` back off it. Only the hand-rolled branch can get
    // this wrong; `squareDisplayBoundingBox` fills it in.
    return new Rectangle({
      x: left - pad,
      y: top - pad,
      w: right - left + pad * 2,
      h: bottom - top + pad * 2,
      data: this,
    });
  }

  draw(): void {
    const centre = this.position;
    const t = Math.min(1, this.ageMs / this.lifeTime);
    // The shout itself: a hard ring that snaps out to the real radius in the
    // first fifth of a second and then simply holds there, so the player can
    // read the edge for as long as the taunt is live.
    const opening = Math.min(1, this.ageMs / 180);
    const swept = 1 - (1 - opening) * (1 - opening);
    const fading = 1 - t * t;

    push();
    noFill();
    // The true hit radius, drawn as the hardest line in the effect. If the
    // player has to guess where this edge is, the ability has failed.
    stroke(232, 96, 42, 210 * fading);
    strokeWeight(3.5);
    circle(centre.x, centre.y, Q_RADIUS * 2 * swept);
    // A second, softer ring just inside it reads as breath rather than as a
    // second rule — one focal point, dimmed because it carries less.
    stroke(255, 170, 90, 90 * fading);
    strokeWeight(1.5);
    circle(centre.x, centre.y, Q_RADIUS * 2 * swept - 14);

    // The leashes, inward. Each one is drawn from the victim toward Axe and
    // stops short of both bodies, with a barb at the Axe end so the direction
    // of travel is unambiguous at a glance.
    for (const victim of this.called) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      const dx = centre.x - victim.position.x;
      const dy = centre.y - victim.position.y;
      const span = Math.hypot(dx, dy) || 1;
      const ux = dx / span;
      const uy = dy / span;
      const standoff = (victim.animatedValues?.displaySize ?? 40) / 2 + 4;
      const inner = this.owner.collisionRadius + 8;
      if (span <= standoff + inner) continue;

      stroke(255, 140, 70, 150 * fading);
      strokeWeight(2);
      line(
        victim.position.x + ux * standoff,
        victim.position.y + uy * standoff,
        centre.x - ux * inner,
        centre.y - uy * inner
      );
      // The barb sits at the Axe end, pointing at him: the pull's destination.
      noStroke();
      fill(255, 170, 90, 200 * fading);
      const barbX = centre.x - ux * inner;
      const barbY = centre.y - uy * inner;
      const side = Math.atan2(uy, ux) + Math.PI / 2;
      beginShape();
      vertex(barbX + ux * 9, barbY + uy * 9);
      vertex(barbX + Math.cos(side) * 5, barbY + Math.sin(side) * 5);
      vertex(barbX - Math.cos(side) * 5, barbY - Math.sin(side) * 5);
      endShape(CLOSE);
    }
    pop();
  }
}
