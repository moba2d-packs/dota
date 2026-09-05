import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Drum, { SURGE_MS, SURGE_PERCENT } from '../spells/Item_Drum';
import { indexObjects, unit } from './_units';

const surges = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.constructor.name === 'Speedup' && !buff.toRemove);

/** Runs a body's buffs forward so an expiring surge actually fades. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Drum — Trống Trận', () => {
  let game: TestGame;
  let carrier: AttackableUnit;
  let friend: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    carrier = unit(game, 0, 'radiant');
    friend = unit(game, 250, 'radiant');
    enemy = unit(game, 250, 'dire', 100);
    game.setPlayer(carrier);
    indexObjects(game, [carrier, friend, enemy]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surges himself and the ally standing with him', () => {
    expect(pressSpell(new Item_Drum(carrier), {})).toBe(true);

    expect(surges(carrier).length, 'the buyer got no legs').toBe(1);
    expect(surges(friend).length, 'the ally beside him got none').toBe(1);
    // A real speed bonus, on the stat the buff modifies.
    expect(carrier.stats.speed.value).toBeCloseTo(
      carrier.stats.speed.baseValue * (1 + SURGE_PERCENT)
    );
  });

  it('never surges the other side', () => {
    pressSpell(new Item_Drum(carrier), {});
    expect(surges(enemy).length, 'it sped an enemy up').toBe(0);
  });

  /** 250 is inside a 450 ring; 640 is not. Hand-written, not `RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const distant = unit(game, 640, 'radiant');
    indexObjects(game, [carrier, friend, enemy, distant]);

    pressSpell(new Item_Drum(carrier), {});
    expect(surges(friend).length).toBe(1);
    expect(surges(distant).length, 'the beat carried past its own radius').toBe(0);
  });

  /** Two drums pressed together are one surge with its clock rewound. */
  it('never stacks a second drum on top of the first', () => {
    const second = unit(game, 60, 'radiant');
    indexObjects(game, [carrier, friend, enemy, second]);

    pressSpell(new Item_Drum(carrier), {});
    pressSpell(new Item_Drum(second), {});

    expect(surges(carrier).length, 'two drums doubled the surge').toBe(1);
    expect(carrier.stats.speed.value).toBeCloseTo(
      carrier.stats.speed.baseValue * (1 + SURGE_PERCENT)
    );
  });

  it('fades on time, and the legs go with it', () => {
    pressSpell(new Item_Drum(carrier), {});
    age(friend, SURGE_MS + 100);

    expect(surges(friend).length, 'the surge never faded').toBe(0);
    expect(friend.stats.speed.value).toBeCloseTo(friend.stats.speed.baseValue);
  });

  it('is tied to the item rather than to the life', () => {
    const item = new Item_Drum(carrier);
    pressSpell(item, {});

    // Core reads `sourceSpell` to drop an item's buffs when it is sold.
    expect(surges(carrier)[0]?.sourceSpell).toBe(item);
  });

  it('costs no mana and goes on cooldown', () => {
    const item = new Item_Drum(carrier);
    pressSpell(item, {});

    expect(carrier.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
