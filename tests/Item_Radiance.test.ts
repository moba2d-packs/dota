import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Radiance, { BURN_PER_TICK, TICK_MS } from '../spells/Item_Radiance';
import { indexObjects, unit } from './_units';

/** One slice of match time on the aura, which owns the tick. */
const advance = (item: Item_Radiance, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (item.live && !item.live.toRemove) item.live.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Radiance — Hào Quang', () => {
  let game: TestGame;
  let wearer: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    game.setPlayer(wearer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('burns the enemy standing in it, tick after tick', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_Radiance(wearer);
    expect(pressSpell(item, {})).toBe(true);
    advance(item, TICK_MS);
    expect(enemy.stats.health.value).toBe(100 - BURN_PER_TICK);

    advance(item, TICK_MS);
    advance(item, TICK_MS);
    expect(enemy.stats.health.value).toBe(100 - BURN_PER_TICK * 3);
  });

  /** No arrival billing: walking past him must not cost a tick on frame one. */
  it('gives the first half-second of exposure free', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_Radiance(wearer);
    pressSpell(item, {});
    advance(item, 16);

    expect(enemy.stats.health.value, 'it billed on arrival').toBe(100);
  });

  it('leaves his own team, and himself, alone', () => {
    const friend = unit(game, 250, 'radiant');
    indexObjects(game, [wearer, friend]);

    const item = new Item_Radiance(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(friend.stats.health.value, 'the fire burned his own side').toBe(100);
    expect(wearer.stats.health.value, 'it burned the man wearing it').toBe(100);
  });

  /** 420 is inside a 450 aura; 640 is not. Hand-written, not `AURA_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 420, 'dire');
    const distant = unit(game, 640, 'dire');
    indexObjects(game, [wearer, near, distant]);

    const item = new Item_Radiance(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(near.stats.health.value).toBe(100 - BURN_PER_TICK);
    expect(distant.stats.health.value, 'the fire reached past its own radius').toBe(100);
  });

  it('stops the moment somebody steps out — there is nothing to shake off', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_Radiance(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    enemy.position.set(4000, 4000);
    advance(item, TICK_MS);
    advance(item, TICK_MS);

    expect(enemy.stats.health.value, 'the fire followed them across the map').toBe(
      100 - BURN_PER_TICK
    );
    expect(
      enemy.buffs.filter(buff => !buff.toRemove).length,
      'the burn left a buff behind'
    ).toBe(0);
  });

  it('follows the wearer', () => {
    indexObjects(game, [wearer]);
    const item = new Item_Radiance(wearer);
    pressSpell(item, {});

    wearer.position.set(400, 400);
    advance(item, TICK_MS);
    expect(item.live?.position.x).toBe(400);
    expect(item.live?.position.y).toBe(400);
  });

  it('is a passive: no mana, no cooldown, and it arms itself', () => {
    indexObjects(game, [wearer]);
    const item = new Item_Radiance(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
    expect(item.live, 'nothing was lit').not.toBeNull();
  });
});
