import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Hood, { REARM_MS, WARD_AMOUNT } from '../spells/Item_Hood';
import { indexObjects, unit } from './_units';

const ward = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Shield' && !buff.toRemove);

const clock = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Item_Hood_Ward' && !buff.toRemove);

/** Runs a body's buffs forward — the reweave keeps its clock there. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

/**
 * The magic-facing half of the barrier pair. The mechanism is Tiên Phong's
 * and its tests mirror that file's; what is pinned here is everything that
 * makes it the *other* item — which type it answers, and that the two damage
 * types trade places in every assertion.
 */
describe('Item_Hood — Mũ Kháng Cự', () => {
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

  it('arrives armed, and eats the nuke it was bought against', () => {
    pressSpell(new Item_Hood(wearer), {});
    wearer.takeDamage(20, enemy, 'MAGIC', 'test');

    expect(wearer.stats.health.value).toBe(100 - (20 - WARD_AMOUNT));
  });

  /** The mirror of Tiên Phong's rule: a blade must sail straight through. */
  it('lets a blade straight through, pool untouched', () => {
    pressSpell(new Item_Hood(wearer), {});
    wearer.takeDamage(20, enemy, 'PHYSICAL', 'test');

    expect(wearer.stats.health.value, 'the ward answered a swing').toBe(80);
    expect(ward(wearer), 'the swing spent the ward anyway').toBeDefined();
  });

  it('weaves itself back after the rearm window, and not before', () => {
    pressSpell(new Item_Hood(wearer), {});
    wearer.takeDamage(WARD_AMOUNT + 5, enemy, 'MAGIC', 'test');
    expect(ward(wearer), 'breaking it left it standing').toBeUndefined();

    age(wearer, REARM_MS - 200);
    expect(ward(wearer), 'it rewove early').toBeUndefined();

    age(wearer, 300);
    expect(ward(wearer), 'the ward never came back').toBeDefined();

    const before = wearer.stats.health.value;
    wearer.takeDamage(WARD_AMOUNT, enemy, 'MAGIC', 'test');
    expect(wearer.stats.health.value, 'the rewoven ward absorbed nothing').toBe(before);
  });

  it('keeps its bookkeeping off the buff bar, and the ward on it', () => {
    pressSpell(new Item_Hood(wearer), {});

    expect(clock(wearer)?.hudVisible).toBe(false);
    expect(clock(wearer)?.duration).toBe(0);
    expect(ward(wearer)?.hudVisible).toBe(true);
  });

  it('is tied to the item rather than to the life, ward included', () => {
    const item = new Item_Hood(wearer);
    pressSpell(item, {});

    expect(clock(wearer)?.sourceSpell).toBe(item);
    expect(ward(wearer)?.sourceSpell).toBe(item);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Hood(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
