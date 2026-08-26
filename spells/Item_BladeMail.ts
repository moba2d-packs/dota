import type { CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const DamageReflect = api.buffs.DamageReflect;
const Rectangle = api.utils.Quadtree.Rectangle;

/**
 * Giáp Kiếm's active: for four and a half seconds, hurting him hurts you.
 *
 *   press           -> the mail turns over and the edges come out
 *   anyone hits him -> most of that hit goes straight back at them
 *   4.5s            -> it folds away
 *
 * ## Why the reflect is core's buff and not arithmetic here
 *
 * `DamageReflect` lives on `Buff.onDamageTaken`, which runs *after* the whole
 * mitigation chain and is handed both the number that was swung and the number
 * that landed. Writing this as a `modifyIncomingDamage` would put it in a chain
 * that runs in insertion order, so what it reflected would depend on what else
 * happened to be on the wearer first — behind a shield, only the overflow. Two
 * shields on one unit put a reflect behind them and it silently stopped firing.
 *
 * It also measures on **what was swung**, not what got through, because "he hit
 * me for 50, he takes 35" is the sentence a player expects; a shield eating the
 * 50 does not make the swing smaller. And core's own re-entrancy latch is what
 * stops two of these bouncing one hit back and forth until the stack runs out.
 *
 * ## This buff is visible, and that is the deliberate half
 *
 * A bookkeeping buff hides itself or every purchase adds a row to the buff bar.
 * This is not bookkeeping — it is a timed window with a real countdown, and an
 * enemy deciding whether to keep swinging needs to see it. `hudVisible` is left
 * at its default `true` on purpose; the passives in this pack are the ones that
 * turn it off.
 */
export const DURATION_MS = 4_500;
/** Share of each incoming hit sent home. */
export const REFLECT_PERCENT = 0.7;
export const COOLDOWN_MS = 25_000;
export const STACK_ID = 'dota_item_blade_mail';

export default class Item_BladeMail extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_blade_mail');
  name = 'Giáp Kiếm (Item_BladeMail)';
  description =
    `Kích hoạt: trong <span class="time">${DURATION_MS / 1000} giây</span>, phản lại ` +
    `<span class="buff">${Math.round(REFLECT_PERCENT * 100)}% sát thương</span> nhận vào ` +
    `về kẻ đã gây ra nó (tính trên đòn gốc, trước khi khiên đỡ).`;
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
    const edges = new DamageReflect(DURATION_MS, this.owner, this.owner);
    edges.percent = REFLECT_PERCENT;
    edges.name = 'Giáp Kiếm';
    edges.image = this.image;
    // Its own pool, so a second Giáp Kiếm in the match cannot evict this one.
    edges.stackId = STACK_ID;
    // Tied to the item rather than to the life: core 1.5 reads this to drop an
    // item's buffs when the item is sold. Without it, a sold Giáp Kiếm keeps
    // reflecting for the rest of the match.
    edges.sourceSpell = this;
    this.owner.addBuff(edges);

    const mail = new Item_BladeMail_Object(this.owner);
    mail.attachTo(this.owner, edges);
    this.game.objectManager.addObject(mail);
  }
}

/**
 * The worn state: a ring of blade edges standing off his body, turning.
 *
 * A **stroke, never a fill** — the item VFX budget is hard about this, because
 * the wearer has to stay visible through their own item art. It is drawn for
 * the whole window rather than as a flash, which is the one case a worn state
 * earns: it is anticipation for an enemy, and it changes their decision about
 * whether to keep hitting him.
 */
export class Item_BladeMail_Object extends SpellObject {
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
    // Fades out over the last beat rather than vanishing between two frames.
    const closing = Math.max(0, Math.min(1, (DURATION_MS - this.ageMs) / 400));
    const turn = this.ageMs / 420;

    push();
    // Eight edges, points outward, turning slowly. Outward because that is the
    // direction the damage travels — art sweeping inward over a reflect would
    // read as absorption, which is the opposite item.
    noFill();
    strokeCap(SQUARE);
    for (let edge = 0; edge < 8; edge++) {
      const angle = turn + (edge / 8) * Math.PI * 2;
      const inner = body * 0.55;
      const outer = inner + 11;
      stroke(232, 96, 84, 210 * closing);
      strokeWeight(2.5);
      line(
        at.x + Math.cos(angle) * inner,
        at.y + Math.sin(angle) * inner,
        at.x + Math.cos(angle) * outer,
        at.y + Math.sin(angle) * outer
      );
    }
    // A thin rim tying them together, so eight separate ticks read as one item.
    stroke(180, 60, 55, 120 * closing);
    strokeWeight(1.5);
    circle(at.x, at.y, body * 1.1);
    pop();
  }
}
