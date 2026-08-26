import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;

/**
 * Xoáy Phản Đòn — armour that answers back. While it is armed, anything that
 * hits Axe gets a full turn of the blade for its trouble.
 *
 *   press          -> the blade is loaded; nothing else happens
 *   he takes a hit -> he spins, and everyone standing close is cut
 *   another hit at once -> nothing; the blade has not come back round yet
 *   six seconds    -> it unloads
 *
 * ## Why this is a reaction and not a damage modifier
 *
 * `Buff.modifyIncomingDamage` runs in insertion order with each buff handing
 * the next what is left, so a retaliation written there sees a different number
 * depending on what else happens to be on the unit — behind a shield, only the
 * overflow. `Buff.onDamageTaken` runs after the whole mitigation chain and
 * cannot change either number, which is exactly right for something that
 * *reacts* to being hit. Core's own `DamageReflect` lives there for the same
 * reason, and this is the hand-written cousin of it: a reflect pays the
 * attacker back a share of their own hit, and a helix does not care who threw
 * it — it cuts everyone within reach for a flat amount.
 *
 * ## The recovery is the whole balance of it
 *
 * With no internal cooldown, a minion wave hitting Axe four times in one frame
 * spins four times in that frame. `E_SPIN_COOLDOWN_MS` is what makes the
 * ability "a spin, often" rather than "a spin per incoming hit", and the
 * arming buff's own clock is what measures it.
 */
export const E_DURATION_MS = 6_000;
export const E_RADIUS = 200;
export const E_SPIN_DAMAGE = 12;
/** How long the blade takes to come back round. See the header. */
export const E_SPIN_COOLDOWN_MS = 700;
export const E_COOLDOWN_MS = 14_000;
export const E_MANA = 30;

/**
 * The armed state, and the thing that actually spins.
 *
 * It carries its own clock rather than reading a spell's: the ability is on
 * cooldown for most of the time this is live, so anything hung off the spell's
 * own state would be measuring the wrong thing.
 */
export class Axe_E_Armed extends Buff {
  name = 'Xoáy Phản Đòn';

  /** Starts ready, so the very first hit taken spins. */
  private sinceSpin = E_SPIN_COOLDOWN_MS;

  onUpdate(): void {
    this.sinceSpin += Math.max(0, deltaTime);
  }

  onDamageTaken(swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (this.toRemove || swung <= 0) return;
    // Self-damage is not being attacked — an ability that bills its caster in
    // health must not also trigger their retaliation.
    if (!attacker || attacker === this.targetUnit) return;
    if (this.sinceSpin < E_SPIN_COOLDOWN_MS) return;

    this.sinceSpin = 0;
    this.spin();
  }

  private spin(): void {
    const axe = this.targetUnit;
    if (axe.isDead) return;

    // **No vision filter.** Vision gates picking one unit out of a crowd; this
    // is an area effect centred on a body, and someone standing in an unlit
    // bush next to a spinning axe is still standing next to a spinning axe.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: axe.position.x, y: axe.position.y, r: E_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(axe.teamId)],
    }) as AttackableUnit[];

    const cut: AttackableUnit[] = [];
    for (const victim of found) {
      // `queryObjects` answers on bounds, so the edge is re-checked against the
      // radius the ability actually claims.
      if (!victim || victim.isDead) continue;
      if (victim.position.dist(axe.position) > E_RADIUS) continue;
      victim.takeDamage(E_SPIN_DAMAGE, axe, 'PHYSICAL', 'Xoáy Phản Đòn');
      cut.push(victim);
    }

    const helix = new Axe_E_Object(axe);
    helix.cut = cut;
    this.game.objectManager.addObject(helix);
  }
}

export default class Axe_E extends Spell {
  image = api.asset('spell_axe_e');
  name = 'Xoáy Phản Đòn (Axe_E)';
  description =
    `Trong <span class="time">${E_DURATION_MS / 1000} giây</span>, mỗi lần Axe trúng đòn ` +
    `hắn xoay rìu gây <span class="damage">${E_SPIN_DAMAGE} sát thương vật lý</span> ` +
    `lên mọi kẻ địch trong bán kính ${E_RADIUS}. ` +
    `Mỗi vòng xoay cách nhau <span class="time">${E_SPIN_COOLDOWN_MS / 1000} giây</span>.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = E_RADIUS;

  onSpellCast(): void {
    const armed = new Axe_E_Armed(E_DURATION_MS, this.owner, this.owner);
    armed.image = this.image;
    // A bare `Buff` defaults its stack id to its own class, which is already
    // unique here — but naming it keeps it legible beside the rest of the kit
    // and survives the class ever being renamed.
    armed.stackId = 'dota_axe_e_armed';
    this.owner.addBuff(armed);
  }

  drawPreview(): void {
    super.drawPreview(E_RADIUS);
  }
}

/**
 * One turn of the blade.
 *
 * Short and outward, because that is what the ability does: the damage is a
 * ring around his body and it is dealt in one instant. The hard rim sits on the
 * true radius so the player can read where the cut stopped, and each victim
 * carries its own slash — an impact belongs on the body that took it, not
 * scattered at random angles around the caster.
 */
export class Axe_E_Object extends SpellObject {
  /** Who this turn caught. Set by the buff; drawn as impacts. */
  cut: AttackableUnit[] = [];

  private ageMs = 0;
  private readonly lifeTime = 340;
  /** Seeded once — `random()` inside `draw()` re-rolls per frame and flickers. */
  private readonly spinOffset = random(TWO_PI);

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /**
   * The slashes sit on victims that move independently of this object's centre,
   * so the box spans them rather than being a square around it.
   */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - E_RADIUS;
    let top = this.position.y - E_RADIUS;
    let right = this.position.x + E_RADIUS;
    let bottom = this.position.y + E_RADIUS;
    for (const victim of this.cut) {
      if (!victim) continue;
      left = Math.min(left, victim.position.x);
      top = Math.min(top, victim.position.y);
      right = Math.max(right, victim.position.x);
      bottom = Math.max(bottom, victim.position.y);
    }
    // `data: this` is not optional — the display quadtree reads `entry.data.zIndex`
    // back off this rectangle every frame.
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
    // Snap out, then fade: the cut has already happened, so the art is the
    // follow-through rather than a windup.
    const swept = 1 - (1 - t) * (1 - t);
    const fading = 1 - t;

    push();
    // The true cut radius. Hardest line in the effect, because it is the only
    // one that tells the player where the ability stopped.
    noFill();
    stroke(214, 78, 40, 220 * fading);
    strokeWeight(3);
    circle(centre.x, centre.y, E_RADIUS * 2 * swept);

    // Two blade arcs a half-turn apart, sweeping outward with the ring. Two
    // rather than a full disc so the *rotation* is legible — a filled circle
    // would say "an area" and not "he spun".
    strokeWeight(7);
    strokeCap(SQUARE);
    for (let blade = 0; blade < 2; blade++) {
      const from = this.spinOffset + blade * Math.PI + swept * 2.4;
      stroke(255, 160, 80, 200 * fading);
      arc(
        centre.x,
        centre.y,
        E_RADIUS * 1.7 * swept,
        E_RADIUS * 1.7 * swept,
        from,
        from + 0.9
      );
    }

    // The impacts, on the bodies that took them.
    noStroke();
    for (const victim of this.cut) {
      if (!victim || victim.toRemove) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      fill(255, 230, 200, 190 * fading);
      circle(victim.position.x, victim.position.y, body * 0.55 * (0.5 + swept * 0.5));
      // A short slash across the body, angled away from Axe, so the direction
      // the blade travelled through them is readable.
      const away = Math.atan2(
        victim.position.y - centre.y,
        victim.position.x - centre.x
      );
      stroke(255, 120, 70, 230 * fading);
      strokeWeight(3);
      const reach = body * 0.5;
      line(
        victim.position.x - Math.cos(away + 1.2) * reach,
        victim.position.y - Math.sin(away + 1.2) * reach,
        victim.position.x + Math.cos(away + 1.2) * reach,
        victim.position.y + Math.sin(away + 1.2) * reach
      );
      noStroke();
    }
    pop();
  }
}
