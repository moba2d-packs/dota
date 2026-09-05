import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Vanguard, { BLOCK_AMOUNT, REARM_MS } from '../spells/Item_Vanguard';
import { indexObjects, unit } from './_units';

const wall = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Shield' && !buff.toRemove);

const clock = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Item_Vanguard_Block' && !buff.toRemove);

/** Runs a body's buffs forward — the rearm keeps its clock there. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Vanguard — Tiên Phong', () => {
  let game: TestGame;
  let wearer: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    enemy = unit(game, 200, 'dire');
    game.setPlayer(wearer);
    indexObjects(game, [wearer, enemy]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('arrives armed: the wall is standing the moment it is bought', () => {
    pressSpell(new Item_Vanguard(wearer), {});
    expect(wall(wearer), 'the shop sold a promissory note').toBeDefined();
  });

  it('blocks that much of a blade, and no more', () => {
    pressSpell(new Item_Vanguard(wearer), {});
    wearer.takeDamage(20, enemy, 'PHYSICAL', 'test');

    expect(wearer.stats.health.value).toBe(100 - (20 - BLOCK_AMOUNT));
  });

  /** `absorbs: ['PHYSICAL']` is the item — a nuke must sail straight through. */
  it('lets magic straight through, pool untouched', () => {
    pressSpell(new Item_Vanguard(wearer), {});
    wearer.takeDamage(20, enemy, 'MAGIC', 'test');

    expect(wearer.stats.health.value, 'the wall answered a spell').toBe(80);
    expect(wall(wearer), 'the spell spent the wall anyway').toBeDefined();
  });

  it('stays down for the whole rearm window once broken', () => {
    pressSpell(new Item_Vanguard(wearer), {});
    wearer.takeDamage(BLOCK_AMOUNT + 5, enemy, 'PHYSICAL', 'test');
    expect(wall(wearer), 'breaking it left it standing').toBeUndefined();

    age(wearer, REARM_MS - 200);
    const before = wearer.stats.health.value;
    wearer.takeDamage(10, enemy, 'PHYSICAL', 'test');
    expect(wearer.stats.health.value, 'it rebuilt early').toBe(before - 10);
  });

  it('is braced back up once the window has passed', () => {
    pressSpell(new Item_Vanguard(wearer), {});
    wearer.takeDamage(BLOCK_AMOUNT + 5, enemy, 'PHYSICAL', 'test');

    age(wearer, REARM_MS + 100);
    expect(wall(wearer), 'the wall never came back').toBeDefined();

    const before = wearer.stats.health.value;
    wearer.takeDamage(10, enemy, 'PHYSICAL', 'test');
    expect(wearer.stats.health.value, 'the rebuilt wall blocked nothing').toBe(before);
  });

  it('keeps its bookkeeping off the buff bar, and the wall on it', () => {
    pressSpell(new Item_Vanguard(wearer), {});

    // The rearm clock is not news; the standing wall is what an attacker
    // deciding whether to swing has to be able to read.
    expect(clock(wearer)?.hudVisible).toBe(false);
    expect(clock(wearer)?.duration).toBe(0);
    expect(wall(wearer)?.hudVisible).toBe(true);
  });

  it('is tied to the item rather than to the life, wall included', () => {
    const item = new Item_Vanguard(wearer);
    pressSpell(item, {});

    // Core reads `sourceSpell` to drop an item's buffs when it is sold — and
    // the standing wall has to go with the clock, or a sold Tiên Phong leaves
    // a free barrier behind.
    expect(clock(wearer)?.sourceSpell).toBe(item);
    expect(wall(wearer)?.sourceSpell).toBe(item);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Vanguard(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
