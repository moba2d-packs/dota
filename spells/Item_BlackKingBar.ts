import type { CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const StatAmp = api.buffs.StatAmp;
const Rectangle = api.utils.Quadtree.Rectangle;
const BuffAddType = api.enums.BuffAddType;

/**
 * Gậy Hắc Vương's active: six seconds where magic mostly stops working on him,
 * and everything already holding him lets go.
 *
 *   press          -> every hold somebody else had on him is gone
 *   and            -> a wall of magic resistance goes up for six seconds
 *   pressed stunned-> it still works; that is the only time it is ever pressed
 *   six seconds    -> the wall comes down
 *
 * ## `castableWhileControlled` is the item
 *
 * Without it this does nothing on the one occasion anybody buys one. Every gate
 * in `Spell` reads `owner.canCast`, and `Stats.updateActionState` clears
 * `CAN_CAST` for Silenced, Charmed, Feared, Taunted, Stunned and Suppressed —
 * six of the ten bits in `CROWD_CONTROL_FLAGS`. So without the flag the button
 * works against a root, a disarm or a blind, and refuses against a stun.
 *
 * The flag is core's, and narrow: it buys past crowd control and nothing else.
 * Death, cooldown, mana and `checkCastCondition` all still apply. Overriding
 * `press()` to dodge the gate was the alternative, and would have dodged the
 * cooldown and resource machinery with it.
 *
 * ## What it does not clear, and why the description says so
 *
 * `cleanse()` drops what **somebody else** did to you, using core's own
 * `CROWD_CONTROL_FLAGS`. Two consequences a player has to know before the
 * fight rather than during it: a self-cast lockdown survives, because one item
 * cancelling another is a bug with two buttons; and a **slow is not crowd
 * control** — it is a stat modifier, not a status flag — so it stays. Both are
 * stated in the tooltip and pinned by tests.
 */
export const DURATION_MS = 6_000;
/** Flat magic resistance while the wall is up. */
export const MAGIC_RESIST = 65;
/** Was 60s, the longest cooldown in the pack; the practice room's 20s ceiling compresses it, but it stays the pack's longest. */
export const COOLDOWN_MS = 19_000;
export const STACK_ID = 'dota_item_black_king_bar';

export default class Item_BlackKingBar extends Spell {
  /**
   * The whole point of the item: it is a way *out* of crowd control, so it must
   * not be gated on being able to act. See the header.
   */
  castableWhileControlled = true;

  targetingMode = 'SELF' as const;
  image = api.asset('item_black_king_bar');
  name = 'Gậy Hắc Vương (Item_BlackKingBar)';
  description =
    `Kích hoạt: <span class="buff">gỡ bỏ mọi hiệu ứng khống chế</span> mà kẻ khác đã gây ra ` +
    `và nhận <span class="buff">+${MAGIC_RESIST} kháng phép</span> trong ` +
    `<span class="time">${DURATION_MS / 1000} giây</span>. ` +
    `<span>Làm chậm không bị gỡ.</span>`;
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
    // Core's own definition of crowd control, so this pack keeps no list that
    // could drift out of step with what the health bar's CC line shows.
    this.owner.cleanse();

    const warded = new StatAmp(DURATION_MS, this.owner, this.owner);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
    // modifier and `addBuff` is what runs it.
    warded.bonuses = { magicResist: { flatBonus: MAGIC_RESIST } };
    warded.name = 'Gậy Hắc Vương';
    warded.image = this.image;
    // A second press inside the window rewinds one wall rather than stacking a
    // second — `StatAmp` defaults to `STACKS_AND_CONTINUE`, which would hand
    // out 130 resistance for two presses.
    warded.buffAddType = BuffAddType.RENEW_EXISTING;
    warded.stackId = STACK_ID;
    // Tied to the item rather than to the life: core 1.5 reads this to drop an
    // item's buffs when the item is sold.
    warded.sourceSpell = this;
    this.owner.addBuff(warded);

    const wall = new Item_BlackKingBar_Object(this.owner);
    wall.attachTo(this.owner, warded);
    this.game.objectManager.addObject(wall);
  }
}

/**
 * The worn state: a hexagonal ward standing off his body.
 *
 * A stroke rather than a fill, so the champion stays visible through his own
 * item art, and a hexagon rather than a circle because this pack already has
 * several round auras and an enemy has to be able to tell *which* window is up
 * at a glance — that is the whole decision the art has to support.
 */
export class Item_BlackKingBar_Object extends SpellObject {
  private ageMs = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);
  }

  /** Rides his body, so a square around this object's own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(130);
  }

  draw(): void {
    const at = this.position;
    const body = this.owner.animatedValues?.displaySize ?? 40;
    // Snaps up, holds, and fades over the last beat rather than blinking out.
    const raising = Math.min(1, this.ageMs / 200);
    const up = 1 - (1 - raising) * (1 - raising);
    const closing = Math.max(0, Math.min(1, (DURATION_MS - this.ageMs) / 500));
    const turn = this.ageMs / 1400;

    push();
    noFill();
    // The ward itself.
    const reach = body * 0.78 * up;
    stroke(190, 150, 240, 200 * closing);
    strokeWeight(2.5);
    beginShape();
    for (let corner = 0; corner < 6; corner++) {
      const angle = turn + (corner / 6) * Math.PI * 2;
      vertex(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach);
    }
    endShape(CLOSE);

    // A second, tighter hex turning the other way — two layers, and the inner
    // one is dimmer because it carries less: it is texture, the outer is the
    // shape a player reads.
    stroke(120, 90, 180, 110 * closing);
    strokeWeight(1.5);
    beginShape();
    for (let corner = 0; corner < 6; corner++) {
      const angle = -turn * 1.4 + (corner / 6) * Math.PI * 2;
      vertex(at.x + Math.cos(angle) * reach * 0.72, at.y + Math.sin(angle) * reach * 0.72);
    }
    endShape(CLOSE);
    pop();
  }
}
