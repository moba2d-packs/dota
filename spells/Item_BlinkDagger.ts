import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';
import { Item_BlinkGate_Sense } from './Item_BlinkGate';

const Spell = api.Spell;
const Dash = api.buffs.Dash;
const VectorUtils = api.utils.VectorUtils;

/**
 * Dao Găm Nhảy's active: he is somewhere else now.
 *
 *   press toward a point -> he crosses up to 700 in a blink
 *   hit within 3 seconds -> the dagger refuses; escape was for before the hit
 *   grounded             -> refused too, before it costs the cooldown
 *
 * ## The refusal is the item
 *
 * Every other movement in this shop works mid-fight — that is what Trượng Lực
 * is *for*. Blink is the opposite bet: the longest jump in the pack, purchased
 * on the promise that it is a positioning tool and not a panic button, and the
 * damage lock (`Item_BlinkGate.ts`, the passive half) is what holds it to
 * that. The two items land on either side of one line, which is why both are
 * on the shelf.
 *
 * ## "Up to", unlike the staff
 *
 * A blink goes where it was aimed, clamped at its reach — the fixed-distance
 * rule belongs to the push, where overshooting is the skill. Here the skill is
 * picking the spot.
 *
 * ## Still a `Dash`, at a speed that reads as a blink
 *
 * Four frames of flight instead of true teleport buys three things for free:
 * `Dash.CanDash` (grounding), the trail that shows everyone where he went —
 * counterplay the source game grants via the blink's particle line — and the
 * same interrupt rules every flight here obeys.
 */
export const BLINK_RANGE = 700;
export const BLINK_SPEED = 180;
/** Upper bound on the dash buff, not the flight time — it ends on arrival. */
export const BLINK_DASH_MS = 400;
export const COOLDOWN_MS = 12_000;

export default class Item_BlinkDagger extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = api.asset('item_blink_dagger');
  name = 'Dao Găm Nhảy (Item_BlinkDagger)';
  description =
    `Kích hoạt: dịch chuyển tới điểm đã chọn, xa nhất ${BLINK_RANGE}. ` +
    `<span class="buff">Không dùng được</span> trong ` +
    `<span class="time">3 giây</span> sau khi trúng đòn của kẻ địch.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  range = BLINK_RANGE;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  /**
   * Both gates, before anything is spent. A missing sensor means the passive
   * has not run (nothing armed it), and a dagger that cannot see the fight
   * answers the way it was bought: ready.
   */
  checkCastCondition(): boolean {
    if (!Dash.CanDash(this.owner)) return false;
    const sense = this.owner.buffs.find(
      (buff: unknown): buff is Item_BlinkGate_Sense =>
        buff instanceof Item_BlinkGate_Sense && !buff.toRemove
    );
    return sense === undefined || sense.ready;
  }

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      BLINK_RANGE
    );

    const blink = new Dash(BLINK_DASH_MS, this.owner, this.owner);
    blink.image = this.image;
    blink.dashDestination = to;
    blink.dashSpeed = BLINK_SPEED;
    // The trail is the counterplay: everyone watching knows where he went.
    blink.showTrail = true;
    this.owner.addBuff(blink);
  }
}
