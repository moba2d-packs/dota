import type { CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const StatAmp = api.buffs.StatAmp;
const Rectangle = api.utils.Quadtree.Rectangle;
const BuffAddType = api.enums.BuffAddType;
const pct = api.text.pct;

/**
 * Satanic's active: for four seconds, every swing he lands is his own health
 * bar refilling.
 *
 *   press          -> the thirst takes over
 *   he keeps swinging -> half of every hit comes back as health
 *   4 seconds      -> it lets go
 *
 * ## The carry's Trái Tim, and why it is an active
 *
 * Dota's Satanic is the item that turns "the carry is dying" into "the carry
 * healed to full mid-fight because nobody stunned him". It is the one
 * defensive buy whose defence is *pressed at ten percent health and swung on*
 * — which makes it the right offense-shaped piece for a shop being rebuilt
 * around defensive answers: it protects, but only a hero who stays in.
 *
 * The stat is core's own `lifesteal`, worn as a timed `StatAmp` on the buyer
 * — nothing lands on the victim, so none of `docs/STATS_VS_DOTA.md`'s
 * debuff-the-victim rules apply. Lifesteal reads basic attacks only, which is
 * also the honest version of the source item (Unholy Rage never healed off
 * spells), and the counter is already on this shelf: Bình Hồn's wound cuts
 * this exactly as hard as it cuts a regeneration item.
 */
/** Extra share of basic-attack damage returned as health while the rage is up. */
export const RAGE_LIFESTEAL = 0.5;
export const DURATION_MS = 4_000;
export const COOLDOWN_MS = 18_000;
export const STACK_ID = 'dota_item_satanic';

export default class Item_Satanic extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_satanic');
  name = 'Satanic (Item_Satanic)';
  description =
    `Kích hoạt: trong <span class="time">${DURATION_MS / 1000} giây</span>, đòn đánh thường ` +
    `hút thêm ${pct(RAGE_LIFESTEAL * 100)} sát thương gây ra thành máu.`;
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
    const rage = new StatAmp(DURATION_MS, this.owner, this.owner);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
    // modifier and `addBuff` is what runs it.
    rage.bonuses = { lifesteal: { flatBonus: RAGE_LIFESTEAL } };
    rage.name = 'Satanic';
    rage.image = this.image;
    // A second press inside the window rewinds the clock rather than stacking
    // a second rage — `StatAmp` defaults to `STACKS_AND_CONTINUE`, which would
    // hand out a full extra copy of the lifesteal.
    rage.buffAddType = BuffAddType.RENEW_EXISTING;
    rage.stackId = STACK_ID;
    // Tied to the item rather than to the life: core reads this to drop an
    // item's buffs when the item is sold.
    rage.sourceSpell = this;
    this.owner.addBuff(rage);

    const thirst = new Item_Satanic_Object(this.owner);
    thirst.attachTo(this.owner, rage);
    this.game.objectManager.addObject(thirst);
  }
}

/**
 * The worn state: a jagged dark-red collar low on his body, for the window.
 *
 * A stroke and never a fill — the wearer stays visible through his own item
 * art. Drawn for the whole four seconds because an enemy's counter-play is
 * *time-shaped*: walk away, hold the stun, wait it out. Jagged rather than
 * round so it cannot be confused with Giáp Kiếm's blade ring, the other red
 * window an enemy has to read on this roster.
 */
export class Item_Satanic_Object extends SpellObject {
  private ageMs = 0;

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.ageMs += Math.max(0, deltaTime);
  }

  /** Rides his body, so a square around this object's own centre is correct. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(120);
  }

  draw(): void {
    const at = this.position;
    const body = this.owner.animatedValues?.displaySize ?? 40;
    // Fades over the last beat rather than vanishing between two frames.
    const closing = Math.max(0, Math.min(1, (DURATION_MS - this.ageMs) / 400));
    const turn = this.ageMs / 600;

    push();
    noFill();
    // Ten spikes alternating between two radii — a collar of thorns, turning.
    stroke(190, 45, 45, 200 * closing);
    strokeWeight(2);
    beginShape();
    for (let point = 0; point < 20; point++) {
      const angle = turn + (point / 20) * Math.PI * 2;
      const reach = body * (point % 2 === 0 ? 0.72 : 0.55);
      vertex(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach);
    }
    endShape(CLOSE);
    // A dim inner ring tying the spikes to the body they guard.
    stroke(120, 25, 30, 110 * closing);
    strokeWeight(1.5);
    circle(at.x, at.y, body * 1.02);
    pop();
  }
}
