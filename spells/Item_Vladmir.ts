import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Buff = api.buffs.Buff;
const StatAmp = api.buffs.StatAmp;
const AttackableUnit = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Lễ Vật Vladmir's passive: everyone fighting beside him drinks too.
 *
 *   held             -> a dark ring follows him, always on
 *   an ally stands in -> their basic attacks heal them for a share
 *   they walk out     -> it lets go a beat later
 *
 * ## The third permanent aura, facing inward
 *
 * Khiên Shiva chills the enemies in its ring and Hào Quang burns them; this
 * one is the same skeleton pointed at the wearer's own side — the first item
 * in this shop whose stats brief says "stand together" to the *buyer's* team.
 * The grant is core's own `lifesteal` worn as a short `StatAmp`, re-issued on
 * the tick and expiring a linger after the tick that stopped — the exact
 * membership arithmetic `Item_ShivasGuard.ts` documents, not restated here.
 *
 * ## One offering per fight
 *
 * The grant carries a shared stack id and `RENEW_EXISTING`, so a second
 * Vladmir in the ring renews the first one's grant rather than doubling it —
 * the source item's own aura rule. And Bình Hồn's wound cuts everything this
 * aura pays out, because the payout is plain lifesteal through the front door.
 */
export const AURA_RADIUS = 450;
export const LIFESTEAL_SHARE = 0.12;
/** How often membership is re-checked. Not every frame — see `Item_ShivasGuard.ts`. */
export const TICK_MS = 250;
/** How long a grant outlives the tick that made it — the beat a leaver keeps it. */
export const LINGER_MS = 250;
export const STACK_ID = 'dota_item_vladmir';

/**
 * The arming state. It holds nothing but the aura's lifetime, which is what
 * makes selling the item end the offering.
 */
export class Item_Vladmir_Armed extends Buff {
  name = 'Lễ Vật Vladmir';
  hudVisible = false;
  buffAddType = api.enums.BuffAddType.REPLACE_EXISTING;
}

export default class Item_Vladmir extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_vladmirs_offering');
  name = 'Lễ Vật Vladmir (Item_Vladmir)';
  description =
    `Nội tại: bản thân và đồng minh trong bán kính ${AURA_RADIUS} được ` +
    `<span class="buff">12% hút máu</span> từ đòn đánh thường.`;
  coolDown = 0;
  manaCost = 0;

  /** The offering that is up, for as long as the item is held. Read by the test. */
  live: Item_Vladmir_Object | null = null;

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

    const armed = new Item_Vladmir_Armed(0, this.owner, this.owner);
    armed.image = this.image;
    armed.stackId = STACK_ID + '_armed';
    // Core reads this to drop an item's buffs when the item is sold; the aura
    // object is attached to this buff, so the offering ends with it.
    armed.sourceSpell = this;
    this.owner.addBuff(armed);

    const offering = new Item_Vladmir_Object(this.owner);
    offering.position = this.owner.position.copy();
    this.live = offering;
    offering.attachTo(this.owner, armed);
    this.game.objectManager.addObject(offering);
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
 * The dark ring, and the clock that owns membership — `Item_ShivasGuard.ts`'s
 * tick pattern, pointed at allies.
 */
export class Item_Vladmir_Object extends SpellObject {
  image = api.asset('item_vladmirs_offering');
  zIndex = GROUND_Z_INDEX;

  /** Who the last tick fed. Drawn as fang marks; read for nothing else. */
  fed: AttackableUnit[] = [];

  private ageMs = 0;
  private sinceTick = 0;
  /** Whether the first sweep has run — stated, not bought by seeding the clock. */
  private started = false;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    if (this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);

    const step = Math.max(0, deltaTime);
    this.ageMs += step;

    // The first sweep runs immediately: an aura that buffs your own side has
    // no arrival-billing problem, and a wearer whose own item took a quarter
    // second to reach him reads as broken.
    if (!this.started) {
      this.started = true;
      this.offer();
    }

    this.sinceTick += step;
    // Subtracted rather than zeroed, so the rate holds through a long frame.
    while (this.sinceTick >= TICK_MS) {
      this.sinceTick -= TICK_MS;
      this.offer();
    }
  }

  private offer(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: AURA_RADIUS }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
      ],
    }) as AttackableUnit[];

    const caught: AttackableUnit[] = [];
    for (const ally of found) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the ring actually draws.
      if (ally.position.dist(this.position) > AURA_RADIUS) continue;

      const drink = new StatAmp(TICK_MS + LINGER_MS, this.owner, ally);
      // Set before `addBuff` — `StatAmp.onCreate` reads `bonuses`.
      drink.bonuses = { lifesteal: { flatBonus: LIFESTEAL_SHARE } };
      drink.name = 'Lễ Vật Vladmir';
      drink.image = this.image;
      // One grant per body, clock rewound — and a second Vladmir shares it.
      drink.buffAddType = BuffAddType.RENEW_EXISTING;
      drink.stackId = STACK_ID;
      ally.addBuff(drink);
      caught.push(ally);
    }

    this.fed = caught;
  }

  /** The fang marks sit on allies that move independently of the ring's centre. */
  getDisplayBoundingBox(): Rectangle {
    const pad = 40;
    let left = this.position.x - AURA_RADIUS;
    let top = this.position.y - AURA_RADIUS;
    let right = this.position.x + AURA_RADIUS;
    let bottom = this.position.y + AURA_RADIUS;
    for (const ally of this.fed) {
      if (!ally) continue;
      left = Math.min(left, ally.position.x);
      top = Math.min(top, ally.position.y);
      right = Math.max(right, ally.position.x);
      bottom = Math.max(bottom, ally.position.y);
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
    const breath = 1 + 0.008 * Math.sin(this.ageMs / 560);

    push();
    // The true radius, on the ground, in a dark wine red — the inward-facing
    // aura must not wear the enemy-facing pair's gold or blue.
    noFill();
    stroke(150, 60, 80, 110);
    strokeWeight(2);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath);
    stroke(110, 40, 60, 40);
    strokeWeight(1);
    circle(at.x, at.y, AURA_RADIUS * 2 * swept * breath - 12);

    // Two small fang ticks under each ally the last sweep actually fed.
    noStroke();
    for (const ally of this.fed) {
      if (!ally || ally.isDead) continue;
      const body = ally.animatedValues?.displaySize ?? 40;
      fill(190, 80, 100, 110);
      triangle(
        ally.position.x - 5,
        ally.position.y + body * 0.34,
        ally.position.x - 1,
        ally.position.y + body * 0.34,
        ally.position.x - 3,
        ally.position.y + body * 0.34 + 6
      );
      triangle(
        ally.position.x + 1,
        ally.position.y + body * 0.34,
        ally.position.x + 5,
        ally.position.y + body * 0.34,
        ally.position.x + 3,
        ally.position.y + body * 0.34 + 6
      );
    }
    pop();
  }
}
