import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const dmg = api.text.dmg;

/**
 * Chấn Động Dư Âm — one slam, and then the slam bouncing off everybody it
 * caught, back through everybody else.
 *
 *   press with one enemy near  -> a heavy slam, and that is all
 *   press into four of them    -> the slam plus three echoes, on each of them
 *   press into a whole team    -> the same, up to the cap
 *
 * ## The enemy decides what this is worth, not this file
 *
 * That is the entire design. `R_BASE_DAMAGE` is an ultimate's worth on its own,
 * and every extra body standing in it adds `R_ECHO_DAMAGE` *to everyone* — so
 * the ability rewards the other team's grouping rather than the caster's aim.
 * A number that did not scale would make this an ordinary nuke with a bigger
 * radius.
 *
 * ## Why there is a cap
 *
 * Without one, a minion wave is a guaranteed team kill: nine bodies is eight
 * echoes on each of them, which against a ~100 health pool is lethal several
 * times over from one press with no aim involved. `R_MAX_ECHOES` is where the
 * scaling stops being a reward and starts being a coin flip about how many
 * creeps happened to be there.
 *
 * ## One pass, then one payout
 *
 * The count has to be taken *before* any damage lands. Damaging as the query is
 * walked would let an early death shrink the echo count for everyone after it,
 * so the same press would deal different damage to the first body in the list
 * than to the last — for a reason no player could see.
 */
export const R_RADIUS = 420;
export const R_BASE_DAMAGE = 44;
export const R_ECHO_DAMAGE = 6;
/** Where the crowd bonus stops. See the header — this is not a tuning knob. */
export const R_MAX_ECHOES = 4;
export const R_COOLDOWN_MS = 40_000;
export const R_MANA = 60;

export default class Earthshaker_R extends Spell {
  /**
   * Told, and it is the largest area in the pack: an instant nuke whose
   * damage grows with how many bodies are packed into it. `Burst` because
   * pressing it is a commitment, which is what the flag prices.
   */
  static aiRoles =
    api.enums.SpellRole.Damage |
    api.enums.SpellRole.Zone |
    api.enums.SpellRole.Burst;

  image = api.asset('spell_earthshaker_r');
  name = 'Chấn Động Dư Âm (Earthshaker_R)';
  description =
    `Nện xuống gây ${dmg(R_BASE_DAMAGE, 'MAGIC')} lên kẻ địch ` +
    `trong bán kính ${R_RADIUS}. Mỗi kẻ địch trúng đòn tạo thêm một dư âm gây ` +
    `+${dmg(R_ECHO_DAMAGE, 'MAGIC')} lên tất cả những kẻ còn lại ` +
    `(tối đa ${R_MAX_ECHOES} dư âm).`;
  coolDown = R_COOLDOWN_MS;
  manaCost = R_MANA;
  targetingMode = 'SELF' as const;
  range = R_RADIUS;

  /** The slam that is out, for as long as it is drawn. Read by the test. */
  live: Earthshaker_R_Object | null = null;

  onSpellCast(): void {
    // **No vision filter** — an area effect touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: R_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    // One pass to decide who is in it, and only then the payout — see the
    // header on why the count cannot be taken while damage is landing.
    const caught: AttackableUnit[] = [];
    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the slam actually draws.
      if (victim.position.dist(this.owner.position) > R_RADIUS) continue;
      caught.push(victim);
    }

    const echoes = Math.min(Math.max(0, caught.length - 1), R_MAX_ECHOES);
    const payload = R_BASE_DAMAGE + echoes * R_ECHO_DAMAGE;
    for (const victim of caught) {
      victim.takeDamage(payload, this.owner, 'MAGIC');
    }

    const slam = new Earthshaker_R_Object(this.owner);
    slam.position = this.owner.position.copy();
    slam.caught = caught;
    slam.echoes = echoes;
    this.live = slam;
    this.game.objectManager.addObject(slam);
  }

  drawPreview(): void {
    super.drawPreview(R_RADIUS);
  }
}

/**
 * The slam, and one visible echo per body it counted.
 *
 * The echoes are drawn as rings expanding *out of each victim*, which is
 * literally what the damage did — the player can count the rings and see why
 * the number was what it was. A single big ring would deal the same damage and
 * teach the player nothing about the ability they just pressed.
 */
export class Earthshaker_R_Object extends SpellObject {
  /** Who the slam caught, and how many echoes it paid for. Set by the spell. */
  caught: AttackableUnit[] = [];
  echoes = 0;

  private ageMs = 0;
  private readonly lifeTime = 620;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /** The echoes bloom from victims that move independently of this centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 60;
    let left = this.position.x - R_RADIUS;
    let top = this.position.y - R_RADIUS;
    let right = this.position.x + R_RADIUS;
    let bottom = this.position.y + R_RADIUS;
    for (const victim of this.caught) {
      if (!victim) continue;
      left = Math.min(left, victim.position.x);
      top = Math.min(top, victim.position.y);
      right = Math.max(right, victim.position.x);
      bottom = Math.max(bottom, victim.position.y);
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
    const centre = this.position;
    const t = Math.min(1, this.ageMs / this.lifeTime);
    const fading = 1 - t;

    push();
    // The slam itself: one hard ring out to the true radius in the first
    // third, so the area is readable before the echoes crowd the picture.
    const primary = Math.min(1, this.ageMs / 220);
    const swept = 1 - (1 - primary) * (1 - primary);
    noFill();
    stroke(206, 150, 84, 240 * fading);
    strokeWeight(5);
    circle(centre.x, centre.y, R_RADIUS * 2 * swept);

    // One echo per body, starting after the slam has read, each expanding out
    // of the victim it came from.
    const echoAge = Math.max(0, this.ageMs - 180);
    const echoT = Math.min(1, echoAge / 380);
    if (echoT > 0) {
      const echoSwept = 1 - (1 - echoT) * (1 - echoT);
      for (const victim of this.caught) {
        if (!victim || victim.toRemove) continue;
        stroke(238, 196, 128, 170 * (1 - echoT));
        strokeWeight(2.5);
        circle(victim.position.x, victim.position.y, echoSwept * 150);
      }
    }

    // The impacts, on the bodies that took them.
    noStroke();
    for (const victim of this.caught) {
      if (!victim || victim.toRemove) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      fill(255, 228, 178, 190 * fading);
      circle(victim.position.x, victim.position.y, body * 0.6 * (0.4 + swept * 0.6));
    }
    pop();
  }
}
