import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_ForceStaff, { FORCE_DISTANCE } from '../spells/Item_ForceStaff';
import { indexObjects, unit } from './_units';

const dash = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Dash' && !buff.toRemove) as
    | { dashDestination: { x: number; y: number } | null }
    | undefined;

describe('Item_ForceStaff — Trượng Lực', () => {
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

  it('shoves the wearer the way the cursor points', () => {
    expect(pressSpell(new Item_ForceStaff(wearer), { at: { x: 1000, y: 0 } })).toBe(true);

    const shove = dash(wearer);
    expect(shove, 'no push happened at all').toBeDefined();
    expect(shove?.dashDestination?.x).toBeCloseTo(FORCE_DISTANCE);
    expect(shove?.dashDestination?.y).toBeCloseTo(0);
  });

  /**
   * The item, as distinct from a walk: the push is always the full distance,
   * even when the cursor is closer. Overshooting past the fight is the
   * failure mode a player learns to stop hitting.
   */
  it('always pushes the full distance, never to the cursor', () => {
    pressSpell(new Item_ForceStaff(wearer), { at: { x: 100, y: 0 } });

    expect(dash(wearer)?.dashDestination?.x).toBeCloseTo(FORCE_DISTANCE);
  });

  it('pushes at an angle exactly as far as along an axis', () => {
    pressSpell(new Item_ForceStaff(wearer), { at: { x: 300, y: 300 } });

    const to = dash(wearer)?.dashDestination;
    expect(to).toBeDefined();
    const reach = Math.sqrt((to?.x ?? 0) ** 2 + (to?.y ?? 0) ** 2);
    expect(reach).toBeCloseTo(FORCE_DISTANCE);
  });

  it('costs no mana and goes on cooldown', () => {
    const item = new Item_ForceStaff(wearer);
    pressSpell(item, { at: { x: 1000, y: 0 } });

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
