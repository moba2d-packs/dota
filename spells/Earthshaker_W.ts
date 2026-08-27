import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Airborne = api.buffs.Airborne;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;

/**
 * Thần Chú Đá — he plants the totem and everything nearby leaves the ground.
 *
 *   press          -> the totem comes down; the shock goes out at its real radius
 *   standing in it -> damage, and thrown into the air
 *   in the air     -> nothing they can do about it until they land
 *
 * ## Airborne rather than a stun, and why they are not the same
 *
 * `Stun` takes away acting; `Airborne` sets `Suppressed` and lifts the body,
 * which is a *displacement* — it reads differently, it interacts differently
 * with the things that clear crowd control, and it is what "the ground jumped"
 * should feel like. The kit already stuns twice (Q floors them, E rattles
 * them); a third would make three abilities that are the same verb.
 */
export const W_RADIUS = 240;
export const W_DAMAGE = 24;
export const W_AIRBORNE_MS = 900;
/** How high the totem throws them. `Airborne`'s own default is a gentler 20. */
export const W_HEIGHT = 30;
export const W_COOLDOWN_MS = 12_000;
export const W_MANA = 35;

export default class Earthshaker_W extends Spell {
  image = api.asset('spell_earthshaker_w');
  name = 'Thần Chú Đá (Earthshaker_W)';
  description =
    `Nện totem xuống đất, gây <span class="damage">${W_DAMAGE} sát thương phép</span> và ` +
    `<span class="buff">hất tung</span> mọi kẻ địch trong bán kính ${W_RADIUS} trong ` +
    `<span class="time">${W_AIRBORNE_MS / 1000} giây</span>.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'SELF' as const;
  range = W_RADIUS;

  /** The shock that is out, for as long as it is drawn. Read by the test. */
  live: Earthshaker_W_Object | null = null;

  onSpellCast(): void {
    // **No vision filter** — an area effect touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: W_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const thrown: AttackableUnit[] = [];
    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the shock actually draws.
      if (victim.position.dist(this.owner.position) > W_RADIUS) continue;

      victim.takeDamage(W_DAMAGE, this.owner, 'MAGIC');
      // After the damage: `addBuff` refuses a corpse rather than throwing one
      // into the air.
      if (victim.isDead) continue;
      const lifted = new Airborne(W_AIRBORNE_MS, this.owner, victim);
      lifted.height = W_HEIGHT;
      lifted.image = this.image;
      victim.addBuff(lifted);
      thrown.push(victim);
    }

    const shock = new Earthshaker_W_Object(this.owner);
    shock.position = this.owner.position.copy();
    shock.thrown = thrown;
    this.live = shock;
    this.game.objectManager.addObject(shock);
  }

  drawPreview(): void {
    super.drawPreview(W_RADIUS);
  }
}

/**
 * The shock: a ring of lifted dust travelling outward, and a plume under each
 * body that actually left the ground.
 *
 * The plumes are the part that carries information — the ring says an area
 * happened, the plumes say *who is in the air*, which is the thing the player
 * has to act on. They are drawn under the victims, growing, because the buff
 * pushes them up: outward-and-down art over an upward throw would be telling
 * the player the opposite of what the game just did.
 */
export class Earthshaker_W_Object extends SpellObject {
  /** Who the totem threw. Set by the spell; drawn as plumes. */
  thrown: AttackableUnit[] = [];

  private ageMs = 0;
  private readonly lifeTime = 520;
  /** Seeded once — `random()` inside `draw()` re-rolls per frame and flickers. */
  private readonly shards = Array.from({ length: 14 }, (_, i) => ({
    angle: (i / 14) * Math.PI * 2 + random(-0.2, 0.2),
    reach: random(0.55, 1),
    size: random(5, 11),
  }));

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /** The plumes sit on victims that move independently of this object's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - W_RADIUS;
    let top = this.position.y - W_RADIUS;
    let right = this.position.x + W_RADIUS;
    let bottom = this.position.y + W_RADIUS;
    for (const victim of this.thrown) {
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
    const swept = 1 - (1 - t) * (1 - t);
    const fading = 1 - t;

    push();
    // The true radius, hard, so where the throw stopped is not a guess.
    noFill();
    stroke(168, 128, 78, 235 * fading);
    strokeWeight(4);
    circle(centre.x, centre.y, W_RADIUS * 2 * swept);

    // Shards kicked up along the ring, riding the same edge outward.
    noStroke();
    for (const shard of this.shards) {
      const along = W_RADIUS * swept * shard.reach;
      fill(148, 112, 70, 200 * fading);
      circle(
        centre.x + Math.cos(shard.angle) * along,
        centre.y + Math.sin(shard.angle) * along,
        shard.size * (0.6 + fading * 0.8)
      );
    }

    // A plume under each body that was thrown, growing upward with them.
    for (const victim of this.thrown) {
      if (!victim || victim.toRemove) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      const risen = swept * body * 0.7;
      fill(196, 158, 108, 170 * fading);
      // Widest at the feet and narrowing as it climbs, so it reads as lift.
      beginShape();
      vertex(victim.position.x - body * 0.42, victim.position.y + body * 0.24);
      vertex(victim.position.x + body * 0.42, victim.position.y + body * 0.24);
      vertex(victim.position.x + body * 0.16, victim.position.y - risen);
      vertex(victim.position.x - body * 0.16, victim.position.y - risen);
      endShape(CLOSE);
    }
    pop();
  }
}
