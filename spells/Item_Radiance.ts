import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const dmg = api.text.dmg;

/**
 * Hào Quang's passive: he is on fire, permanently, and standing near him is a
 * decision with a price.
 *
 *   held              -> a golden burn hangs around him, always on
 *   an enemy stands in -> they take magic damage, tick after tick
 *   they walk out      -> it stops; there is nothing to shake off
 *
 * ## Khiên Shiva with the other verb
 *
 * Same aura skeleton — a hidden armed buff that owns the lifetime, an object
 * that ticks membership on a clock instead of every frame — with damage where
 * the cold had a slow. The one structural difference: the burn leaves *no
 * buff* on the victim. A slow has to persist to mean anything; a burn is a
 * hit, and a hit that already happened needs no linger, no stack id and no
 * add-type rule. Step out and it simply stops.
 *
 * ## Tuned as pressure, not as a nuke
 *
 * Four a second is a fifth of a basic nuke — against the smallest body on the
 * roster it is death in about thirty seconds of standing still, which nobody
 * does. What it actually buys is the source item's real effect: melee heroes
 * pay rent to stand in his circle, and the drawn ring is the landlord's sign.
 */
export const AURA_RADIUS = 450;
export const BURN_PER_TICK = 2;
export const TICK_MS = 500;
export const STACK_ID = 'dota_item_radiance';

/**
 * The arming state. It holds nothing but the aura's lifetime, which is what
 * makes selling the item put the fire out.
 */
export class Item_Radiance_Armed extends Buff {
  name = 'Hào Quang';
  hudVisible = false;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
}

export default class Item_Radiance extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_radiance');
  name = 'Hào Quang (Item_Radiance)';
  description =
    `Nội tại: thiêu đốt mọi kẻ địch trong bán kính ${AURA_RADIUS} — ` +
    `${dmg(BURN_PER_TICK, 'MAGIC')} mỗi ${TICK_MS / 1000} giây, chừng nào họ còn đứng trong đó.`;
  coolDown = 0;
  manaCost = 0;

  /** The fire that is up, for as long as the item is held. Read by the test. */
  live: Item_Radiance_Object | null = null;

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
    this.dropAura();

    const armed = new Item_Radiance_Armed(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID;
    // Core reads this to drop an item's buffs when the item is sold; the aura
    // object is attached to this buff, so the fire goes out with it.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);

    const fire = new Item_Radiance_Object(this.owner);
    fire.position = this.owner.position.copy();
    this.live = fire;
    fire.attachTo(this.owner, armed);
    this.game.objectManager.addObject(fire);
  }

  onRemoved(): void {
    this.dropAura();
    super.onRemoved();
  }

  /** Idempotent, and safe to call when nothing is up. */
  private dropAura(): void {
    if (!this.live) return;
    this.live.toRemove = true;
    this.live = null;
  }
}

/**
 * The golden circle, and the clock that owns the burning.
 *
 * The tick pattern is `Item_ShivasGuard_Object`'s, kept for the same two
 * reasons: a per-frame area query is sixty queries a second to express
 * something that changes when somebody crosses a line, and the subtracted
 * accumulator holds the damage rate steady through a long frame.
 */
export class Item_Radiance_Object extends SpellObject {
  image = api.asset('item_radiance');
  zIndex = GROUND_Z_INDEX;

  /** Who the last tick burned. Drawn as embers; read for nothing else. */
  burning: AttackableUnit[] = [];

  private ageMs = 0;
  private sinceTick = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;

    // No first-frame tick, deliberately — a burn that bills on arrival makes
    // walking *past* him cost a tick. The first half-second of exposure is
    // free, the way the source item's own aura reads.
    this.sinceTick += step;
    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= TICK_MS) {
      this.sinceTick -= TICK_MS;
      this.burn();
    }
  }

  private burn(): void {
    // **No vision filter** — an aura touches whoever is standing in it.
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: AURA_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const caught: AttackableUnit[] = [];
    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the ring actually draws.
      if (victim.position.dist(this.position) > AURA_RADIUS) continue;

      victim.takeDamage(BURN_PER_TICK, this.owner, 'MAGIC', 'Hào Quang');
      caught.push(victim);
    }

    this.burning = caught;
  }

  /** The ember marks sit on enemies that move independently of the ring's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - AURA_RADIUS;
    let top = this.position.y - AURA_RADIUS;
    let right = this.position.x + AURA_RADIUS;
    let bottom = this.position.y + AURA_RADIUS;
    for (const victim of this.burning) {
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
    const at = this.position;
    // Opens once and then holds — permanent, so it must not pulse itself into
    // being ignored.
    const opening = Math.min(1, this.ageMs / 400);
    const swept = 1 - (1 - opening) * (1 - opening);
    const breath = 1 + 0.008 * Math.sin(this.ageMs / 470);

    push();
    // The true radius, on the ground, in the hot gold family — this is the
    // other temperature from Shiva's cold blue on purpose: the two permanent
    // auras on this shelf must be tellable apart at the edge of a screen.
    noFill();
    stroke(240, 196, 92, 120);
    strokeWeight(2);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath);
    stroke(210, 150, 60, 45);
    strokeWeight(1);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath - 12);

    // An ember on each enemy the last tick actually billed. The ring says
    // where the fire is; these say who it currently has.
    noStroke();
    for (const victim of this.burning) {
      if (!victim || victim.isDead) continue;
      const body = victim.animatedValues?.displaySize ?? 40;
      fill(250, 180, 90, 100);
      circle(victim.position.x, victim.position.y - body * 0.32, body * 0.4);
      fill(255, 226, 140, 80);
      circle(victim.position.x, victim.position.y - body * 0.42, body * 0.22);
    }
    pop();
  }
}
