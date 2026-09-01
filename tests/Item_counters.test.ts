import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_SpiritVessel, { WOUND_PERCENT } from '../spells/Item_SpiritVessel';
import Item_Desolator, { CORRUPTION } from '../spells/Item_Desolator';
import { indexObjects, unit } from './_units';

/**
 * The two items this shop grew to answer things it previously could not, and
 * the conversion rule they are the worked example of.
 *
 * Both are written the Dota way round — the effect lands on the **victim**, not
 * on the buyer — and the second test of each pair is what that costs and buys:
 * an ally who bought nothing benefits, which is the whole reason either item
 * gets drafted. `docs/STATS_VS_DOTA.md` states the rule;
 * `tests/statConversion.test.ts` refuses the attacker-side shortcut in `data`.
 */
describe('the counters this shop was missing', () => {
  let game: TestGame;
  let carrier: AttackableUnit;
  let victim: AttackableUnit;
  let ally: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    vi.stubGlobal('deltaTime', 16);
    carrier = unit(game, 0, 'blue');
    ally = unit(game, 60, 'blue');
    victim = unit(game, 200, 'red');
    game.setPlayer(carrier);
    indexObjects(game, [carrier, ally, victim]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The hit, without a real swing: `Buff.onHit` is what `landBasicAttack` calls. */
  const swing = (attacker: AttackableUnit): void => {
    for (const buff of [...attacker.buffs]) {
      (buff as unknown as { onHit: (hit: unknown) => void }).onHit({
        attacker,
        victim,
        damage: 12,
        ranged: false,
        crit: false,
        echo: false,
      });
    }
  };

  describe('Bình Hồn', () => {
    it('takes almost half of every heal on whoever it hit', () => {
      expect(pressSpell(new Item_SpiritVessel(carrier))).toBe(true);
      swing(carrier);

      victim.stats.health.baseValue = 40;
      victim.takeHeal(20, victim);

      // `takeHeal` rounds the cut number, so 20 x 0.55 arrives as 11.
      expect(victim.stats.health.value).toBe(40 + Math.round(20 * (1 - WOUND_PERCENT)));
    });

    it('does nothing to a body it has not hit', () => {
      expect(pressSpell(new Item_SpiritVessel(carrier))).toBe(true);

      ally.stats.health.baseValue = 40;
      ally.takeHeal(20, ally);

      expect(ally.stats.health.value).toBe(60);
    });
  });

  describe('Kẻ Hủy Diệt', () => {
    it('corrodes the victim’s own armour rather than letting the carrier ignore it', () => {
      victim.stats.armor.baseValue = 20;

      expect(pressSpell(new Item_Desolator(carrier))).toBe(true);
      swing(carrier);

      // On the victim. Attacker-side penetration would leave this at 20 and
      // show up only in the carrier's own damage — which is the League model
      // and the wrong game (`docs/STATS_VS_DOTA.md`).
      expect(victim.stats.armor.value).toBe(20 - CORRUPTION);
      expect(carrier.stats.armorPenetration.value).toBe(0);
    });

    it('does not stack with a second copy, the way the source item does not', () => {
      victim.stats.armor.baseValue = 20;
      const second = unit(game, 40, 'blue');
      indexObjects(game, [second]);

      expect(pressSpell(new Item_Desolator(carrier))).toBe(true);
      expect(pressSpell(new Item_Desolator(second))).toBe(true);
      swing(carrier);
      swing(second);

      expect(victim.stats.armor.value).toBe(20 - CORRUPTION);
    });
  });
});
