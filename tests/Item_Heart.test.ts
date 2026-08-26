import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Heart, { COMBAT_MS, REGEN_PER_TICK, TICK_MS } from '../spells/Item_Heart';
import { indexObjects, unit } from './_units';

const mending = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Item_Heart_Mending' && !buff.toRemove);

/** Runs the wearer's own buffs forward — the mending keeps its clock there. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Heart — Trái Tim Tarrasque', () => {
  let game: TestGame;
  let wearer: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    enemy = unit(game, 300, 'dire');
    game.setPlayer(wearer);
    indexObjects(game, [wearer, enemy]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mends him once he has been left alone long enough', () => {
    wearer.stats.health.baseValue = 40;
    pressSpell(new Item_Heart(wearer), {});

    age(wearer, COMBAT_MS + TICK_MS);
    expect(wearer.stats.health.value).toBe(40 + REGEN_PER_TICK);
  });

  it('keeps mending, tick after tick', () => {
    wearer.stats.health.baseValue = 40;
    pressSpell(new Item_Heart(wearer), {});

    age(wearer, COMBAT_MS + TICK_MS);
    age(wearer, TICK_MS);
    age(wearer, TICK_MS);
    expect(wearer.stats.health.value).toBe(40 + REGEN_PER_TICK * 3);
  });

  /**
   * The whole shape of the item: it is not a regeneration stat, it is a reason
   * to leave the fight. Without the out-of-combat gate a Heart just makes him
   * harder to kill while he is being killed.
   */
  it('does nothing at all while he is still being hit', () => {
    wearer.stats.health.baseValue = 40;
    pressSpell(new Item_Heart(wearer), {});

    age(wearer, COMBAT_MS - 200);
    expect(wearer.stats.health.value, 'it mended him mid-fight').toBe(40);
  });

  it('a hit puts the clock back to the start', () => {
    wearer.stats.health.baseValue = 40;
    pressSpell(new Item_Heart(wearer), {});

    // Almost out of combat, and then hit again.
    age(wearer, COMBAT_MS - 200);
    wearer.takeDamage(5, enemy, 'PHYSICAL', 'test');
    const afterHit = wearer.stats.health.value;

    age(wearer, COMBAT_MS - 200);
    expect(wearer.stats.health.value, 'the hit did not reset the clock').toBe(afterHit);

    age(wearer, TICK_MS + 300);
    expect(wearer.stats.health.value).toBeGreaterThan(afterHit);
  });

  it('never mends him past full', () => {
    pressSpell(new Item_Heart(wearer), {});

    age(wearer, COMBAT_MS + TICK_MS * 20);
    expect(wearer.stats.health.value).toBe(100);
  });

  /**
   * A bookkeeping buff hides itself, or every purchase adds a row to the buff
   * bar. `duration = 0` means permanent and draws no countdown.
   */
  it('keeps its bookkeeping off the buff bar', () => {
    pressSpell(new Item_Heart(wearer), {});

    expect(mending(wearer)?.hudVisible, 'the item put a row on the buff bar').toBe(false);
    expect(mending(wearer)?.duration, 'a permanent buff drew a countdown').toBe(0);
  });

  it('is tied to the item rather than to the life', () => {
    const item = new Item_Heart(wearer);
    pressSpell(item, {});

    // Core 1.5 reads `sourceSpell` to drop an item's buffs when it is sold.
    expect(mending(wearer)?.sourceSpell).toBe(item);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Heart(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
