import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Shield = api.buffs.Shield;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const BuffAddType = api.enums.BuffAddType;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const heal = api.text.heal;

/**
 * Tẩu Thông Tuệ's active: one breath of smoke, and everyone standing with him
 * walks into the nuke behind a ward.
 *
 *   press          -> a ring of smoke rolls out to the radius it really has
 *   caught in it   -> every ally (him included) gains a barrier against magic
 *   5 seconds      -> whatever was not spent dissolves
 *
 * ## The team half of Mũ Kháng Cự, and why it is a burst rather than an aura
 *
 * Dota's Pipe of Insight is the item a side buys when the other side's damage
 * is one spell volley, and its whole skill is *timing*: pressed before the
 * volley it erases it, pressed after it did nothing. That decision is the
 * item, so this is a one-shot grant with a real window rather than a standing
 * aura — an aura version would be Mũ Kháng Cự sold five times, with nothing
 * left to time.
 *
 * The grant is a snapshot of who is inside at press time, deliberately: an
 * ally who arrives late walked in after the call was made. That is also why
 * there is no membership tick, no linger and none of the aura bookkeeping
 * Khiên Shiva needs — the ring VFX is a moment, not a field.
 *
 * ## `RENEW_EXISTING` on a shared pool
 *
 * Two Tẩu in one team, pressed together, must not stack 30 points of ward on
 * everybody — the source item shares a cooldown across a side for exactly
 * this reason. One barrier per body, its clock rewound and its chipped pool
 * kept, is the honest version of that rule here.
 */
export const BARRIER_AMOUNT = 15;
export const BARRIER_MS = 5_000;
export const RADIUS = 400;
export const COOLDOWN_MS = 16_000;
export const STACK_ID = 'dota_item_pipe';

export default class Item_Pipe extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_pipe_of_insight');
  name = 'Tẩu Thông Tuệ (Item_Pipe)';
  description =
    `Kích hoạt: bản thân và đồng minh trong bán kính ${RADIUS} nhận lá chắn hấp thụ ` +
    `${heal(BARRIER_AMOUNT, ' sát thương phép')} trong ` +
    `<span class="time">${BARRIER_MS / 1000} giây</span>. ` +
    `Đòn đánh thường xuyên thẳng qua.`;
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
      // radius the smoke actually rolls to.
      if (ally.position.dist(this.owner.position) > RADIUS) continue;

      const ward = new Shield(BARRIER_MS, this.owner, ally);
      ward.amount = BARRIER_AMOUNT;
      ward.absorbs = ['MAGIC'];
      ward.name = 'Tẩu Thông Tuệ';
      // The same cool hue as Mũ Kháng Cự: both rings mean "magic stops here".
      ward.color = [120, 190, 235];
      ward.image = this.image;
      // One barrier per body — see the header.
      ward.buffAddType = BuffAddType.RENEW_EXISTING;
      ward.stackId = STACK_ID;
      // Tied to the item rather than to the life: selling it mid-window drops
      // every ward it handed out.
      ward.sourceSpell = this;
      ally.addBuff(ward);
    }

    const smoke = new Item_Pipe_Object(this.owner);
    smoke.position = this.owner.position.copy();
    this.game.objectManager.addObject(smoke);
  }
}

/** How long the smoke ring takes to roll out and fade. */
export const SMOKE_MS = 700;

/**
 * The breath of smoke: one ring rolling out to the true radius, then gone.
 *
 * A moment rather than a field — the barriers it announced live on the allies'
 * own health bars (`Shield` draws its ring itself), so keeping this on screen
 * for the window would be saying the same thing twice, the second time in the
 * way. Ground art, because a 400-radius disc painted above the champions
 * covers the feet of exactly the people who need to see who was caught.
 */
export class Item_Pipe_Object extends SpellObject {
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= SMOKE_MS) this.toRemove = true;
  }

  /** A square around its own centre, at the radius the ring rolls to. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(RADIUS * 2 + 40);
  }

  draw(): void {
    const at = this.position;
    const t = Math.min(1, this.ageMs / SMOKE_MS);
    // Rolls out fast and finishes slow, the way smoke moves.
    const rolled = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    noFill();
    // The ring itself, at the reach the grant really had.
    stroke(150, 210, 235, 170 * fade);
    strokeWeight(2.5);
    circle(at.x, at.y, RADIUS * 2 * rolled);
    // A softer inner echo, trailing the front — texture, not information.
    stroke(120, 190, 235, 70 * fade);
    strokeWeight(1.5);
    circle(at.x, at.y, RADIUS * 2 * rolled * 0.82);
    pop();
  }
}
