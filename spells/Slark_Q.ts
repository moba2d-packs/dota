import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;

/**
 * Khế Ước Hắc Ám — he opens a vein, waits, and the dark takes the debt out of
 * everyone standing near him. Including a little out of him.
 *
 *   press           -> a sigil closes on him; nothing has happened yet
 *   0.6s later      -> it bursts, and everything close takes the damage
 *   the same instant-> every hold somebody else had on him is gone
 *   he pays         -> a small cut of his own health, every time
 *
 * ## The delay is the ability
 *
 * A purge that fires on the keypress is just a cleanse. The 600ms is what makes
 * it a *read*: pressed before the stun lands it wastes itself, pressed after it
 * gets him out, and an opponent who can see the sigil can wait it out. So the
 * delay lives on a `SpellObject` with its own clock rather than on the spell —
 * the activation is instant, so the runtime has already put the spell in
 * COOLDOWN long before the burst is due, and a clock kept on the spell would be
 * one nursed through a state the runtime considers finished.
 *
 * ## What "purge" means is core's to say, not this pack's
 *
 * `AttackableUnit.cleanse()` drops every crowd-control buff **somebody else**
 * applied, using core's own `CROWD_CONTROL_FLAGS`. Two things fall out of that
 * and both are right: a list of "what counts as CC" is not maintained here and
 * cannot drift, and his own buffs survive — a self-cast `Stasis` is a way out
 * of a fight rather than something done *to* him, and an ability that ate its
 * own team's work would be a button that punishes pressing it.
 */
export const Q_DELAY_MS = 600;
export const Q_RADIUS = 260;
export const Q_DAMAGE = 28;
/** His share of the bargain. Paid whether or not the burst catches anybody. */
export const Q_SELF_DAMAGE = 5;
export const Q_COOLDOWN_MS = 9_000;
export const Q_MANA = 30;

export default class Slark_Q extends Spell {
  image = api.asset('spell_slark_q');
  name = 'Khế Ước Hắc Ám (Slark_Q)';
  description =
    `Sau <span class="time">${Q_DELAY_MS / 1000} giây</span>, bóng tối bùng lên gây ` +
    `<span class="damage">${Q_DAMAGE} sát thương phép</span> lên kẻ địch trong bán kính ` +
    `${Q_RADIUS} và <span class="buff">gỡ bỏ mọi hiệu ứng khống chế</span> đang đặt lên Slark. ` +
    `Slark tự mất <span class="damage">${Q_SELF_DAMAGE} máu</span>.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'SELF' as const;
  range = Q_RADIUS;

  /** The pact that is running, for as long as one is. Read by the test. */
  live: Slark_Q_Object | null = null;

  onSpellCast(): void {
    const pact = new Slark_Q_Object(this.owner);
    pact.position = this.owner.position.copy();
    this.live = pact;
    this.game.objectManager.addObject(pact);
  }

  drawPreview(): void {
    super.drawPreview(Q_RADIUS);
  }
}

/**
 * The sigil, and the burst it becomes.
 *
 * Two visibly different regions for two visibly different moments: while it is
 * winding up it is a ring drawing *inward* on him (anticipation — something is
 * being gathered), and when it pays out it snaps *outward* to the true radius.
 * A player who has seen the inward ring once knows how long they have.
 */
export class Slark_Q_Object extends SpellObject {
  image = api.asset('spell_slark_q');

  private ageMs = 0;
  private burst = false;
  private readonly lifeTime = Q_DELAY_MS + 500;
  /** Who the burst caught. Drawn as impacts; not read for anything else. */
  private caught: AttackableUnit[] = [];
  /** Seeded once — `random()` inside `draw()` re-rolls per frame and flickers. */
  private readonly runes = Array.from({ length: 7 }, (_, i) => ({
    angle: (i / 7) * Math.PI * 2 + random(-0.15, 0.15),
    size: random(7, 13),
  }));

  update(): void {
    // The sigil rides him through the wind-up: it is on his body, and a pact
    // that stayed where it was cast would burst behind a moving Slark.
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);

    if (!this.burst && this.ageMs >= Q_DELAY_MS) {
      this.burst = true;
      this.payOut();
    }
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /** Once, and only once — the `burst` latch above is what guarantees it. */
  private payOut(): void {
    const slark = this.owner;

    // Core's own definition of crowd control, so this pack keeps no list that
    // could drift. Runs before the damage: getting out is the point, and a
    // burst that killed him first would make the purge academic.
    slark.cleanse();

    if (!slark.isDead) {
      // Dealt as TRUE and sourced to himself: it is a cost, not an attack, and
      // core's own rules already treat self-damage as neither vamp-able nor
      // something that provokes a retaliation.
      slark.takeDamage(Q_SELF_DAMAGE, slark, 'TRUE');
    }

    // **No vision filter** — an area effect touches whoever is standing in it,
    // lit or not. Vision gates picking one unit out of a crowd, nothing else.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: Q_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(slark.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the burst actually draws.
      if (victim.position.dist(this.position) > Q_RADIUS) continue;
      victim.takeDamage(Q_DAMAGE, slark, 'MAGIC');
      this.caught.push(victim);
    }
  }

  /** The impacts sit on victims that move independently of this object's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - Q_RADIUS;
    let top = this.position.y - Q_RADIUS;
    let right = this.position.x + Q_RADIUS;
    let bottom = this.position.y + Q_RADIUS;
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
    push();

    if (!this.burst) {
      // Anticipation: a ring drawing inward, plus runes closing with it. It
      // starts at the burst's real radius so the wind-up already states where
      // the damage will land.
      const winding = Math.min(1, this.ageMs / Q_DELAY_MS);
      const drawn = Q_RADIUS * (1 - winding * 0.72);
      noFill();
      stroke(120, 70, 170, 120 + winding * 90);
      strokeWeight(2 + winding * 2);
      circle(centre.x, centre.y, drawn * 2);

      noStroke();
      for (const rune of this.runes) {
        const along = rune.angle + winding * 1.6;
        fill(176, 120, 235, 140 + winding * 100);
        circle(
          centre.x + Math.cos(along) * drawn,
          centre.y + Math.sin(along) * drawn,
          rune.size * (0.6 + winding * 0.6)
        );
      }
    } else {
      // Climax and dissipation: outward to the true radius, then gone. The
      // opposite motion to the wind-up, so the two moments never read alike.
      const since = Math.min(1, (this.ageMs - Q_DELAY_MS) / 500);
      const swept = 1 - (1 - since) * (1 - since);
      const fading = 1 - since;

      noFill();
      stroke(150, 90, 210, 230 * fading);
      strokeWeight(4);
      circle(centre.x, centre.y, Q_RADIUS * 2 * swept);
      stroke(220, 190, 255, 120 * fading);
      strokeWeight(1.5);
      circle(centre.x, centre.y, Q_RADIUS * 2 * swept - 16);

      // The impacts, on the bodies that took them.
      noStroke();
      for (const victim of this.caught) {
        if (!victim || victim.toRemove) continue;
        const body = victim.animatedValues?.displaySize ?? 40;
        fill(198, 150, 255, 190 * fading);
        circle(victim.position.x, victim.position.y, body * 0.6 * (0.4 + swept * 0.6));
      }
    }
    pop();
  }
}
