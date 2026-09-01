import { describe, expect, it } from 'vitest';
import { data } from '../pack';

/**
 * The conversion rules from `docs/STATS_VS_DOTA.md`, for the ones a compiler
 * cannot see.
 *
 * The engine under this pack is modelled on League of Legends. Most of the
 * difference is a matter of scale and is caught by reading the table in that
 * document — but two of the rules are *silent* if broken: the item still
 * validates, still installs, still shows a plausible line on its card, and is
 * simply the wrong game.
 *
 * Nothing here is a fact about core. Core is perfectly happy to sell
 * penetration to a Dota hero; it is this pack that decided not to, and the
 * decision has a design argument behind it that would otherwise live only in
 * prose nobody re-reads.
 */

const items = () => Object.entries(data.items ?? {});

describe('the Dota→engine conversion rules', () => {
  /**
   * **Dota has no attacker-side penetration.**
   *
   * Core sells `armorPenetration` and `magicPenetration` — shares of the
   * victim's resistance that the *attacker* ignores, which is League's model.
   * Desolator, Veil of Discord and Mystic Snake all work the other way round:
   * they put a **debuff on the victim**, which makes that victim softer to
   * everyone on the map, the four allies who bought nothing included.
   *
   * That is the whole reason those items get picked in a five-man draft, so
   * folding them into attacker-side penetration deletes the interesting half
   * of the item while leaving something that still looks right on the card.
   * Write it as a `StatAmp` on the target instead — negative `armor.flatBonus`
   * or negative `magicResist.percentBonus`.
   */
  it('sells no attacker-side penetration, because Dota debuffs the victim', () => {
    const offenders: string[] = [];
    for (const [key, def] of items()) {
      for (const stat of ['armorPenetration', 'magicPenetration'] as const) {
        const amount = def.stats?.[stat] ?? 0;
        if (amount !== 0) offenders.push(`${key} grants ${amount} ${stat}`);
      }
    }

    expect(
      offenders,
      `${offenders.join('; ')} — see docs/STATS_VS_DOTA.md. If a Dota mechanic ` +
        'really is attacker-side, change this test and say which one.'
    ).toEqual([]);
  });

  /**
   * **`abilityPower` here is Dota's spell amplification**, not League's ability
   * power: core applies it as one multiplier at the damage funnel rather than
   * as points with a ratio per spell. So `abilityPower: 0.2` is +20% spell
   * amp, and `abilityPower: 20` would be twenty-one times every ability in the
   * pack — a number that is not a type error, not a validation error, and
   * quite hard to notice on a card that reads "+2000%".
   *
   * The rail is generous on purpose: Dota's own biggest single source is about
   * +22% and a stacked build reaches roughly +50%, so anything at or under
   * +100% from one item is a tuning question rather than a unit mistake.
   */
  it('reads abilityPower as spell amplification, a fraction under one', () => {
    for (const [key, def] of items()) {
      const amp = def.stats?.abilityPower ?? 0;
      if (amp === 0) continue;
      expect(
        amp,
        `${key} grants ${amp} abilityPower — a fraction (+20% is 0.2), not points`
      ).toBeLessThanOrEqual(1);
    }
  });

  /**
   * **Attack speed is a share of the wearer's own base rate**, so a Dota IAS
   * figure is divided by 100 on the way in: IAS 100 becomes `1.0`, not `100`.
   * Nothing in this shop sells it yet, which is exactly when a rail is worth
   * writing — the first item to do so is the one that will copy the wiki
   * number straight across.
   */
  it('reads attackSpeed as a share of base, so IAS is divided by 100', () => {
    for (const [key, def] of items()) {
      const share = def.stats?.attackSpeed ?? 0;
      if (share === 0) continue;
      expect(
        share,
        `${key} grants ${share} attackSpeed — divide the IAS figure by 100 (100 IAS is 1.0)`
      ).toBeLessThanOrEqual(2);
    }
  });
});
