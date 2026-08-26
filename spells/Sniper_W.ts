import { api } from '../packApi';

const Spell = api.Spell;
const StatAmp = api.buffs.StatAmp;
const BuffAddType = api.enums.BuffAddType;

/**
 * Ngắm Bắn — he sets his feet, and for eight seconds he can hit things from
 * further away than anybody else on the map.
 *
 *   press        -> his reach grows by exactly what the tooltip says
 *   eight seconds-> it goes back
 *   press again  -> the same eight seconds, not sixteen and not twice the reach
 *
 * ## No damage, deliberately
 *
 * Take Aim is a *positioning* ability: the whole hero is the argument that
 * range is a stat worth a slot, and giving this one a nuke as well would make
 * the range incidental to it. What it buys is that every basic attack, and the
 * threat of one, now starts further back than the enemy's answer to it.
 *
 * ## `attackRange` on a `StatAmp`, not a number written on the unit
 *
 * `StatAmp` builds a `StatsModifier` in `onCreate` and takes it off again in
 * `onDeactivate`, so the put-it-back half is the engine's and not this file's —
 * across death, a match ending mid-buff, and every other path out. Writing
 * `stats.attackRange` by hand would mean owning all of that here, and getting
 * it wrong leaves a sniper with permanent global reach.
 */
export const W_DURATION_MS = 8_000;
/** Flat, not a percentage: a fixed extra distance is what a player can learn. */
export const W_BONUS_RANGE = 180;
export const W_COOLDOWN_MS = 18_000;
export const W_MANA = 25;

export default class Sniper_W extends Spell {
  image = api.asset('spell_sniper_w');
  name = 'Ngắm Bắn (Sniper_W)';
  description =
    `Sniper đứng vững, <span class="buff">+${W_BONUS_RANGE} tầm đánh</span> trong ` +
    `<span class="time">${W_DURATION_MS / 1000} giây</span>.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'SELF' as const;
  range = 0;

  onSpellCast(): void {
    const steadied = new StatAmp(W_DURATION_MS, this.owner, this.owner);
    // Set before `addBuff`: `StatAmp.onCreate` reads `bonuses` to build the
    // modifier, and `addBuff` is what runs it. Assigning afterwards buys
    // nothing and fails silently.
    steadied.bonuses = { attackRange: { baseBonus: W_BONUS_RANGE } };
    steadied.name = 'Ngắm Bắn';
    steadied.image = this.image;
    // A recast rewinds one steadying rather than adding a second. Without this
    // — `StatAmp` defaults to `STACKS_AND_CONTINUE` — two presses inside the
    // duration would double his reach, which is a different ability.
    steadied.buffAddType = BuffAddType.RENEW_EXISTING;
    steadied.stackId = 'dota_sniper_w_reach';
    this.owner.addBuff(steadied);
  }
}
