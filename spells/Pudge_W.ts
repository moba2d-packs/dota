import type { AttackableUnit, CastContext, CastSpec, CancelReason, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Slow = api.buffs.Slow;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const SpellForm = api.enums.SpellForm;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;

/**
 * Rữa Nát — a cloud he carries, on until he turns it off, that hurts everything
 * near him including himself.
 *
 *   press          -> the cloud opens around him and stays
 *   an enemy in it -> takes damage every half second and is slowed
 *   every tick     -> he pays for it out of his own health, never mana
 *   press again    -> it closes
 *
 * ## Why `INDEPENDENT` and not `TETHERED`
 *
 * `CancelPolicy`'s question is where the live effect lives, and a toggle is
 * the awkward case: the cloud is on his own body, which sounds `HELD`, but
 * `HELD` and `AIMED` and `TETHERED` all end on crowd control — so a stun in a
 * fight would silently switch his damage off and hand him back a spell he has
 * to remember to press again. A toggle the player has to re-check after every
 * stun is a toggle the player will forget. It ends when he ends it, or when he
 * dies, which is the one thing every form agrees on.
 *
 * ## Why the health cost is clamped
 *
 * It is his health, not his mana, and that is the whole character of the
 * ability — but `takeDamage` would let it kill him, and a player who dies to a
 * button they pressed forty seconds ago has been given no decision to make.
 * The drain stops at `SELF_FLOOR_HP`. That is a deliberate departure from the
 * source material, recorded here rather than left for a reader to think a bug.
 */
export const W_TICK_MS = 500;
export const W_DAMAGE_PER_TICK = 5;
/** What each tick costs him. Roughly a third of what it deals. */
export const W_SELF_PER_TICK = 2;
/** The drain never takes him below this. See the header. */
export const W_SELF_FLOOR_HP = 5;
export const W_RADIUS = 145;
export const W_SLOW = 0.25;
/** Just over one tick, so a victim standing in it stays slowed without stacking. */
export const W_SLOW_MS = 700;
export const W_COOLDOWN_MS = 3_000;

export default class Pudge_W extends Spell {
  image = api.asset('spell_pudge_w');
  name = 'Rữa Nát (Pudge_W)';
  description =
    `Bật/tắt đám khí độc quanh Pudge: kẻ địch bên trong nhận ` +
    `${dmg(W_DAMAGE_PER_TICK, 'MAGIC')} mỗi ` +
    `<span class="time">${W_TICK_MS / 1000} giây</span> và bị làm chậm ${Math.round(W_SLOW * 100)}%. ` +
    `Chính Pudge cũng mất <span class="buff">${W_SELF_PER_TICK} máu</span> mỗi nhịp.`;
  coolDown = W_COOLDOWN_MS;
  // Free at the door and paid for by the tick, in health. `manaCost` is the
  // engine's one resource question and the answer here is genuinely zero.
  manaCost = 0;
  targetingMode = 'SELF' as const;
  range = W_RADIUS;

  cloud: Pudge_W_Object | null = null;
  private sinceTickMs = 0;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'TOGGLE',
      targeting: 'SELF',
      active: {},
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: SpellForm.INDEPENDENT,
    };
  }

  onActivate(): void {
    this.sinceTickMs = 0;
    const cloud = new Pudge_W_Object(this.owner);
    this.cloud = cloud;
    this.game.objectManager.addObject(cloud);
  }

  onRecast(): void {
    this.close();
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.close();
  }

  onComplete(): void {
    this.close();
  }

  deactivate(): void {
    this.close();
    super.deactivate();
  }

  onRemoved(): void {
    this.close();
    super.onRemoved();
  }

  onUpdate(): void {
    if (this.state !== 'ACTIVE') return;
    if (this.owner.isDead) {
      this.cancel('DEATH');
      return;
    }

    this.sinceTickMs += Math.max(0, deltaTime);
    while (this.sinceTickMs >= W_TICK_MS) {
      this.sinceTickMs -= W_TICK_MS;
      this.tick();
    }
  }

  /** One pulse: everything inside pays, and so does he. */
  private tick(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: W_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      victim.takeDamage(W_DAMAGE_PER_TICK, this.owner, 'MAGIC');
      const slowed = new Slow(W_SLOW_MS, this.owner, victim);
      slowed.percent = W_SLOW;
      slowed.image = this.image;
      // Without an id every bare Slow in the match shares one stack pool, so
      // this one would be refreshed by — and refresh — somebody else's.
      slowed.stackId = 'dota_pudge_w_slow';
      victim.addBuff(slowed);
    }

    // Not `takeDamage`: this is upkeep, not a hit. Routing it through the
    // damage path would credit a kill, fire every on-damage-taken reflect he
    // is standing next to, and let his own cloud finish him.
    const health = this.owner.stats.health;
    health.baseValue = Math.max(W_SELF_FLOOR_HP, health.baseValue - W_SELF_PER_TICK);
    this.cloud?.pulse();
  }

  private close(): void {
    if (!this.cloud) return;
    this.cloud.toRemove = true;
    this.cloud = null;
  }
}

/**
 * The cloud. A `SpellObject` rather than caster VFX because it reaches well
 * past his body, and `Champion.draw()` is skipped whenever `ObjectManager`
 * culls or fogs him — which would leave the damage landing invisibly.
 */
export class Pudge_W_Object extends SpellObject {
  /** Ground art, so it must name its layer: `Z_INDEX_MAP` is keyed by exact constructor and a subclass inherits nothing. */
  zIndex = GROUND_Z_INDEX;

  /** Seeded once in `onAdded`. Re-rolling these inside `draw` boils instead of drifting. */
  private motes: { angle: number; radius: number; rate: number; size: number }[] = [];
  private sincePulseMs = 9_999;

  onAdded(): void {
    this.position = this.owner.position.copy();
    for (let i = 0; i < 16; i++) {
      this.motes.push({
        angle: random(TWO_PI),
        radius: random(0.25, 0.95),
        rate: random(0.0004, 0.0011) * (random() < 0.5 ? -1 : 1),
        size: random(6, 13),
      });
    }
  }

  /** Called by the spell on every damage tick, so the ring flashes *when it hits*. */
  pulse(): void {
    this.sincePulseMs = 0;
  }

  update(): void {
    if (this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.sincePulseMs += Math.max(0, deltaTime);
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((W_RADIUS + 30) * 2);
  }

  draw(): void {
    const centre = this.position;
    // How far through the flash we are, 1 at the tick and 0 a fifth of a
    // second later. The ring is the hit radius, so the flash is what tells
    // the player the damage just landed and exactly how far it reached.
    const flash = Math.max(0, 1 - this.sincePulseMs / 200);

    push();
    noStroke();
    fill(120, 150, 60, 34 + flash * 26);
    circle(centre.x, centre.y, W_RADIUS * 2);

    for (const mote of this.motes) {
      const drift = mote.angle + millis() * mote.rate;
      const moteX = centre.x + Math.cos(drift) * W_RADIUS * mote.radius;
      const moteY = centre.y + Math.sin(drift) * W_RADIUS * mote.radius;
      fill(150, 190, 80, 110);
      circle(moteX, moteY, mote.size);
    }

    // The hard rim sits on the real radius, so the edge is never a guess.
    noFill();
    stroke(170, 210, 90, 150 + flash * 90);
    strokeWeight(2 + flash * 3);
    circle(centre.x, centre.y, W_RADIUS * 2);
    pop();
  }
}
