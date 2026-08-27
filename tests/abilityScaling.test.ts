import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_Q, { Q_DAMAGE } from '../spells/Lina_Q';
import { indexObjects, unit } from './_units';

/**
 * An item bought in this shop makes this pack's abilities hit harder, and
 * **not one spell file knows it**.
 *
 * `items.test.ts` checks the table sells enough ability power; a table can be
 * right while the number never reaches a champion. This is the other end — a
 * real ability, cast the way a player casts it, against a Lina whose only
 * difference is the stat an item grants.
 *
 * `Lina_Q` because the amplification has the furthest to travel there: the wave
 * lands during `objectManager.update()`, frames after the cast returned, on a
 * spell object with no name and no back-link to the spell. If the scaling
 * survives that gap it survives every simpler shape in the pack.
 */
describe('an item in this shop makes this pack’s abilities hit harder', () => {
  let game: TestGame;
  let lina: AttackableUnit;
  let victim: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    lina = unit(game, 0, 'radiant');
    victim = unit(game, 60, 'dire');
    victim.stats.maxHealth.baseValue = 10_000;
    victim.stats.health.baseValue = 10_000;
    game.setPlayer(lina);
    indexObjects(game, [lina, victim]);
  });

  /** Fires Q once and returns what the wave actually took off. */
  const wave = (abilityPower: number): number => {
    lina.stats.abilityPower.baseValue = abilityPower;
    const spell = new Lina_Q(lina);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);

    for (let tick = 0; tick < 90 && victim.recentDamageLog.length === 0; tick++) {
      game.objectManager.update();
    }

    const hit = victim.recentDamageLog[0];
    expect(hit, 'the wave never connected, so this proves nothing').toBeDefined();
    return hit.amount;
  };

  it('deals its authored number to a Lina who has bought nothing', () => {
    // The migration guarantee: every tuning number in this pack still means
    // exactly what it says.
    expect(wave(0)).toBe(Q_DAMAGE);
  });

  it('deals more once ability power is on the caster', () => {
    // 0.6 is one item — Eul's Scepter.
    expect(wave(0.6)).toBe(Math.round(Q_DAMAGE * 1.6));
  });

  it('roughly triples on a full ability build', () => {
    // 1.91 is what this shop can actually reach across six slots, which
    // `items.test.ts` holds the table to.
    expect(wave(1.91)).toBe(Math.round(Q_DAMAGE * 2.91));
  });
});
