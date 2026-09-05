import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_BlinkDagger, { BLINK_RANGE } from '../spells/Item_BlinkDagger';
import Item_BlinkGate, { DAMAGE_LOCK_MS } from '../spells/Item_BlinkGate';
import { indexObjects, unit } from './_units';

const dash = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Dash' && !buff.toRemove) as
    | { dashDestination: { x: number; y: number } | null }
    | undefined;

const sense = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Item_BlinkGate_Sense' && !buff.toRemove);

/** Runs the wearer's own buffs forward — the sensor keeps its clock there. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_BlinkDagger — Dao Găm Nhảy', () => {
  let game: TestGame;
  let wearer: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    enemy = unit(game, 300, 'dire');
    game.setPlayer(wearer);
    indexObjects(game, [wearer, enemy]);
    // The passive half, exactly as buying the item arms it.
    pressSpell(new Item_BlinkGate(wearer), {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blinks where it was aimed, straight off the shelf', () => {
    expect(pressSpell(new Item_BlinkDagger(wearer), { at: { x: 500, y: 0 } })).toBe(true);
    expect(dash(wearer)?.dashDestination?.x).toBeCloseTo(500);
  });

  it('clamps the jump at its reach, unlike the staff it never overshoots', () => {
    pressSpell(new Item_BlinkDagger(wearer), { at: { x: 3000, y: 0 } });
    expect(dash(wearer)?.dashDestination?.x).toBeCloseTo(BLINK_RANGE);
  });

  /**
   * The refusal is the item. Without the damage lock this is a strictly
   * better escape pressed at ten percent health — which is precisely the
   * thing the source item refuses to be.
   */
  it('refuses for three seconds after an enemy lands anything', () => {
    wearer.takeDamage(5, enemy, 'PHYSICAL', 'test');

    expect(pressSpell(new Item_BlinkDagger(wearer), { at: { x: 500, y: 0 } })).toBe(false);
    expect(dash(wearer), 'it blinked while the blade was still hot').toBeUndefined();
  });

  it('answers again once the three seconds have passed', () => {
    wearer.takeDamage(5, enemy, 'PHYSICAL', 'test');
    age(wearer, DAMAGE_LOCK_MS - 200);
    expect(pressSpell(new Item_BlinkDagger(wearer), { at: { x: 500, y: 0 } })).toBe(false);

    age(wearer, 300);
    expect(pressSpell(new Item_BlinkDagger(wearer), { at: { x: 500, y: 0 } })).toBe(true);
  });

  /** The wearer's own costs and his allies must not lock his own escape. */
  it('is not locked by his own health costs, only by the enemy', () => {
    wearer.takeDamage(5, wearer, 'TRUE', 'test');
    expect(pressSpell(new Item_BlinkDagger(wearer), { at: { x: 500, y: 0 } })).toBe(true);
  });

  it('keeps the sensor off the buff bar, tied to the item', () => {
    const watcher = sense(wearer);
    expect(watcher?.hudVisible, 'the sensor put a row on the buff bar').toBe(false);
    expect(watcher?.duration, 'a permanent buff drew a countdown').toBe(0);
    expect(watcher?.sourceSpell, 'selling the dagger would leave the sensor behind').toBeDefined();
  });

  it('costs no mana and goes on cooldown', () => {
    const item = new Item_BlinkDagger(wearer);
    pressSpell(item, { at: { x: 500, y: 0 } });

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
