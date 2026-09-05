import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Speedup = api.buffs.Speedup;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const pct = api.text.pct;

/**
 * Trống Trận's active: one beat of the drum and the whole line surges.
 *
 *   press        -> a drumbeat rolls out to the radius it really has
 *   caught in it -> every ally (him included) runs faster for five seconds
 *   16 seconds   -> the next beat
 *
 * ## The fourth team button, and the first that is legs
 *
 * The shelf's other three team presses are walls and a mend — all of them
 * about *taking* a fight. This one is about choosing it: five seconds of team
 * speed is an engage, a chase, or everyone leaving together, and which one it
 * was is decided by the player, not the item. That range of readings is why
 * the source item sat in half the drafts of its era.
 *
 * ## `Speedup`, snapshotted, one per body
 *
 * Core's own buff, so the surge is a `percentBaseBonus` on the wearer's speed
 * stat and comes off cleanly when the beat fades. Same snapshot rule as the
 * barriers — in the ring at the press or not at all — and `RENEW_EXISTING`
 * under a shared stack id, so two drums pressed together are one surge with
 * its clock rewound rather than a stacking 30%.
 */
export const SURGE_PERCENT = 0.15;
export const SURGE_MS = 5_000;
export const RADIUS = 450;
export const COOLDOWN_MS = 16_000;
export const STACK_ID = 'dota_item_drum';

export default class Item_Drum extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_drum_of_endurance');
  name = 'Trống Trận (Item_Drum)';
  description =
    `Kích hoạt: bản thân và đồng minh trong bán kính ${RADIUS} chạy nhanh thêm ` +
    `${pct(SURGE_PERCENT * 100)} trong <span class="time">${SURGE_MS / 1000} giây</span>.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
      ],
    }) as AttackableUnit[];

    for (const ally of found) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the beat actually carries.
      if (ally.position.dist(this.owner.position) > RADIUS) continue;

      const surge = new Speedup(SURGE_MS, this.owner, ally);
      surge.percent = SURGE_PERCENT;
      surge.name = 'Trống Trận';
      surge.image = this.image;
      // One surge per body, clock rewound — see the header.
      surge.buffAddType = BuffAddType.RENEW_EXISTING;
      surge.stackId = STACK_ID;
      // Tied to the item rather than to the life: selling it mid-surge drops
      // every copy it handed out.
      surge.sourceSpell = this;
      ally.addBuff(surge);
    }

    const beat = new Item_Drum_Object(this.owner);
    beat.position = this.owner.position.copy();
    this.game.objectManager.addObject(beat);
  }
}

/** How long the drumbeat rings take to roll out and fade. */
export const BEAT_MS = 650;

/**
 * The beat: two concentric rings rolling out to the true radius, then gone.
 *
 * The moment-shape all four team buttons share, in its own temperature —
 * a dry drum tan, against the mend's green and the two barriers' amber and
 * blue. `Speedup` draws its own streaks on every surging body, so the lasting
 * half of the effect needs no object here.
 */
export class Item_Drum_Object extends SpellObject {
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= BEAT_MS) this.toRemove = true;
  }

  /** A square around its own centre, at the radius the beat rolls to. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(RADIUS * 2 + 40);
  }

  draw(): void {
    const at = this.position;
    const t = Math.min(1, this.ageMs / BEAT_MS);
    const fade = 1 - t;

    push();
    noFill();
    // Two beats a hair apart — a drum, not a bell.
    const first = 1 - (1 - t) * (1 - t);
    stroke(214, 178, 120, 180 * fade);
    strokeWeight(2.5);
    circle(at.x, at.y, RADIUS * 2 * first);
    const second = Math.max(0, t - 0.18) / 0.82;
    const rolled = 1 - (1 - second) * (1 - second);
    stroke(190, 150, 96, 140 * fade);
    strokeWeight(1.5);
    circle(at.x, at.y, RADIUS * 2 * rolled);
    pop();
  }
}
