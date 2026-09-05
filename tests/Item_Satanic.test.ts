import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Satanic, { DURATION_MS, RAGE_LIFESTEAL } from '../spells/Item_Satanic';
import { indexObjects, unit } from './_units';

const rage = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.name === 'Satanic' && !buff.toRemove);

/** Runs a body's buffs forward so the window can actually close. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Satanic — Satanic', () => {
  let game: TestGame;
  let wearer: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    game.setPlayer(wearer);
    indexObjects(game, [wearer]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing until it is pressed', () => {
    expect(wearer.stats.lifesteal.value).toBe(0);
  });

  it('turns the thirst on, on core’s own lifesteal stat', () => {
    // The stat rather than a hand-rolled heal: `combat/BasicAttack` is the
    // one reader of `lifesteal`, so the rage heals exactly when a swing lands
    // and never off a spell — which is the honest Unholy Rage.
    pressSpell(new Item_Satanic(wearer), {});
    expect(wearer.stats.lifesteal.value).toBe(RAGE_LIFESTEAL);
  });

  it('lets go when the window closes', () => {
    pressSpell(new Item_Satanic(wearer), {});
    age(wearer, DURATION_MS + 100);

    expect(rage(wearer), 'the rage outlived its own window').toBeUndefined();
    expect(wearer.stats.lifesteal.value).toBe(0);
  });

  it('does not stack with a second copy — the clock rewinds instead', () => {
    pressSpell(new Item_Satanic(wearer), {});
    age(wearer, DURATION_MS - 500);
    pressSpell(new Item_Satanic(wearer), {});

    expect(wearer.stats.lifesteal.value, 'two copies doubled the thirst').toBe(RAGE_LIFESTEAL);

    // The second press bought a fresh window, not nothing.
    age(wearer, 1_000);
    expect(rage(wearer), 'the renewed window still closed on the old clock').toBeDefined();
  });

  it('shows on the buff bar, because it is a window and not bookkeeping', () => {
    pressSpell(new Item_Satanic(wearer), {});

    expect(rage(wearer)?.hudVisible).toBe(true);
    expect(rage(wearer)?.duration).toBe(DURATION_MS);
  });

  it('is tied to the item, costs no mana, and goes on cooldown', () => {
    const item = new Item_Satanic(wearer);
    pressSpell(item, {});

    expect(rage(wearer)?.sourceSpell).toBe(item);
    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
