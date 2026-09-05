import type { CastSpec } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Dash = api.buffs.Dash;
const VectorUtils = api.utils.VectorUtils;

/**
 * Trượng Lực's active: the wearer is thrown a fixed distance the way the
 * cursor points, mid-fight, mid-swing, whether it helps or not.
 *
 *   press in a direction -> he covers 480, fast, and keeps whatever he was doing
 *   grounded             -> refused before it goes on cooldown
 *
 * ## Self only, and why that is the honest half
 *
 * Dota's Force Staff pushes *any* unit — self, ally, enemy — and the enemy
 * half is most of its highlight reel. A `UNIT` cast with `targetTeam: 'ANY'`
 * is the four-times-shipped self-target bug (see `Item_Euls.ts`'s header), and
 * an enemy push is a displacement whose counterplay this shop has not priced
 * yet. So this is the self-cast half, stated on the card, and the ally/enemy
 * halves are a second item for the day somebody designs them rather than a
 * quiet lie in this one.
 *
 * ## A fixed distance, not "up to"
 *
 * The push is always `FORCE_DISTANCE`, even when the cursor is closer — the
 * source item works exactly this way and it is what makes the item a skill:
 * pushing yourself past the fight is the failure mode you learn to stop
 * hitting. Clamping to the cursor would turn it into a polite walk.
 *
 * ## Why a `Dash` rather than moving the body
 *
 * Same argument as `Slark_W.ts`: `Dash.CanDash` is where grounding is
 * enforced, and the buff is what makes the flight interruptible by the same
 * things that interrupt every other flight. The push stays `cancelable` — this
 * is a utility shove, not an unstoppable charge.
 */
export const FORCE_DISTANCE = 480;
export const FORCE_SPEED = 30;
/** Upper bound on the dash buff, not the flight time — it ends on arrival. */
export const FORCE_DASH_MS = 800;
export const COOLDOWN_MS = 14_000;

export default class Item_ForceStaff extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = api.asset('item_force_staff');
  name = 'Trượng Lực (Item_ForceStaff)';
  description =
    `Kích hoạt: đẩy bản thân đi đúng ${FORCE_DISTANCE} theo hướng con trỏ — ` +
    `kể cả khi hướng đó là một sai lầm.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;
  range = FORCE_DISTANCE;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  /** Checked here so a grounded push fails before it spends the cooldown. */
  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(): void {
    // `getVectorWithRange`, not `getVectorWithMaxRange`: the push is always
    // the full distance in the aimed direction, never clamped to the cursor —
    // see the header. A press exactly on his own feet has no direction to
    // offer; the helper's own fallback shoves him a random way, which is the
    // honest reading of aiming a force staff at your own boots.
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      FORCE_DISTANCE
    );

    const shove = new Dash(FORCE_DASH_MS, this.owner, this.owner);
    shove.image = this.image;
    shove.dashDestination = to;
    shove.dashSpeed = FORCE_SPEED;
    shove.showTrail = true;
    this.owner.addBuff(shove);
  }
}
