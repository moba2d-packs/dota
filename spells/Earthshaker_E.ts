import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Stun = api.buffs.Stun;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const EventType = api.enums.EventType;

/**
 * Dư Chấn — for fifteen seconds, everything else he does also shakes the
 * ground.
 *
 *   press          -> armed; the ground has not moved
 *   he casts Q     -> the crack, *and* a tremor around him
 *   he casts W, R  -> the same, every time
 *   fifteen seconds-> it stops, and so does the listening
 *
 * ## The one thing an event-driven ability has to get right
 *
 * Subscribing is easy. `game.eventManager.on(...)` returns the function that
 * undoes it, and if that is never called Aftershock keeps firing for the rest
 * of the match — and, because the listener holds a reference to the unit, for
 * the rest of the process.
 *
 * Hanging that teardown off the *spell* would mean four sites — `onCancel`,
 * `onComplete`, `deactivate` and `onRemoved` — any one of which is easy to
 * miss. Hanging it off the *buff* makes it one: the buff is the arming, and a
 * buff has exactly one way to end. `onActivate` subscribes, `onDeactivate`
 * unsubscribes, and there is no fifth path out.
 *
 * ## Why it skips the cast that armed it
 *
 * `Spell` emits `ON_POST_CAST_SPELL` after `onSpellCast` has run — which is
 * after this buff has been added. Without the guard, pressing E would set off
 * its own tremor, which is both a surprise and free damage on a button that is
 * supposed to be pure setup. `sourceSpell` is the identity to compare against,
 * and core already keeps it for the unrelated purpose of dropping an item's
 * buffs when the item is sold.
 */
export const E_DURATION_MS = 15_000;
export const E_RADIUS = 200;
export const E_DAMAGE = 10;
export const E_STUN_MS = 500;
export const E_COOLDOWN_MS = 22_000;
export const E_MANA = 25;

/** The armed state, and the only thing that knows how to stop listening. */
export class Earthshaker_E_Armed extends Buff {
  name = 'Dư Chấn';

  /** What `eventManager.on` handed back. The single teardown site. */
  private stopListening: (() => void) | null = null;

  onActivate(): void {
    this.stopListening = this.game.eventManager.on(
      EventType.ON_POST_CAST_SPELL,
      (spell: { owner?: AttackableUnit } | undefined) => this.onCast(spell)
    );
  }

  onDeactivate(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  private onCast(spell: { owner?: AttackableUnit } | undefined): void {
    if (this.toRemove) return;
    // Somebody else's cast is not his aftershock.
    if (!spell || spell.owner !== this.targetUnit) return;
    // Not the press that armed it — see the header.
    if (spell === this.sourceSpell) return;
    this.shake();
  }

  private shake(): void {
    const shaker = this.targetUnit;
    if (shaker.isDead) return;

    // **No vision filter** — an area effect touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: shaker.position.x, y: shaker.position.y, r: E_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(shaker.teamId)],
    }) as AttackableUnit[];

    const rattled: AttackableUnit[] = [];
    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the tremor actually claims.
      if (victim.position.dist(shaker.position) > E_RADIUS) continue;

      victim.takeDamage(E_DAMAGE, shaker, 'MAGIC', 'Dư Chấn');
      if (victim.isDead) continue;
      const rocked = new Stun(E_STUN_MS, shaker, victim);
      rocked.image = this.image;
      rocked.stackId = 'dota_earthshaker_e_stun';
      victim.addBuff(rocked);
      rattled.push(victim);
    }

    const tremor = new Earthshaker_E_Object(shaker);
    tremor.position = shaker.position.copy();
    tremor.rattled = rattled;
    this.game.objectManager.addObject(tremor);
  }
}

export default class Earthshaker_E extends Spell {
  image = api.asset('spell_earthshaker_e');
  name = 'Dư Chấn (Earthshaker_E)';
  description =
    `Trong <span class="time">${E_DURATION_MS / 1000} giây</span>, mỗi lần Earthshaker ` +
    `dùng chiêu, mặt đất rung lên gây <span class="damage">${E_DAMAGE} sát thương phép</span> ` +
    `và <span class="buff">choáng ${E_STUN_MS / 1000} giây</span> lên kẻ địch trong bán kính ` +
    `${E_RADIUS}.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = E_RADIUS;

  onSpellCast(): void {
    const armed = new Earthshaker_E_Armed(E_DURATION_MS, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = 'dota_earthshaker_e_armed';
    // The identity the listener compares against so the arming press does not
    // set off its own tremor.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);
  }

  drawPreview(): void {
    super.drawPreview(E_RADIUS);
  }
}

/**
 * One tremor: a low ring on the ground, gone in a third of a second.
 *
 * Deliberately the quietest effect in the kit. This fires on *every* cast, so
 * the item-proc noise budget applies rather than the ability one — one layer,
 * short, and it must not cover the ability that triggered it.
 */
export class Earthshaker_E_Object extends SpellObject {
  /** Who the tremor caught. Drawn as impacts. */
  rattled: AttackableUnit[] = [];

  private ageMs = 0;
  private readonly lifeTime = 300;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= this.lifeTime) this.toRemove = true;
  }

  /** The impacts sit on victims that move independently of this object's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - E_RADIUS;
    let top = this.position.y - E_RADIUS;
    let right = this.position.x + E_RADIUS;
    let bottom = this.position.y + E_RADIUS;
    for (const victim of this.rattled) {
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
    const t = Math.min(1, this.ageMs / this.lifeTime);
    const swept = 1 - (1 - t) * (1 - t);
    const fading = 1 - t;

    push();
    // One layer. The ring, at the radius it really has, and nothing else
    // competing with whatever ability set it off.
    noFill();
    stroke(196, 150, 92, 190 * fading);
    strokeWeight(3);
    circle(this.position.x, this.position.y, E_RADIUS * 2 * swept);

    // A short flash on each body caught, so "who got rattled" is readable
    // without the ring having to be bigger or louder.
    noStroke();
    for (const victim of this.rattled) {
      if (!victim || victim.toRemove) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      fill(230, 196, 140, 170 * fading);
      circle(victim.position.x, victim.position.y, body * 0.5);
    }
    pop();
  }
}
