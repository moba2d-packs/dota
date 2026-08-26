import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_ShivasGuard, { LINGER_MS, SLOW_PCT, TICK_MS } from '../spells/Item_ShivasGuard';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** One slice of match time on the aura, which owns the tick. */
const advance = (item: Item_ShivasGuard, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (item.live && !item.live.toRemove) item.live.update();
  vi.stubGlobal('deltaTime', 16);
};

/** Runs a body's own buffs forward so an expiring chill actually falls off. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_ShivasGuard — Khiên Shiva', () => {
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

  it('raises a cold that follows the wearer', () => {
    indexObjects(game, [wearer]);
    const item = new Item_ShivasGuard(wearer);
    expect(pressSpell(item, {})).toBe(true);
    expect(item.live, 'nothing was raised').not.toBeNull();

    wearer.position.set(400, 400);
    advance(item, TICK_MS);
    expect(item.live?.position.x).toBe(400);
    expect(item.live?.position.y).toBe(400);
  });

  it('slows every enemy standing in it', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(has(enemy, 'Slow'), 'they walked around him at full speed').toBe(true);
  });

  it('leaves his own team, and himself, alone', () => {
    const friend = unit(game, 250, 'radiant');
    indexObjects(game, [wearer, friend]);

    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(has(friend, 'Slow'), 'the cold froze his own side').toBe(false);
    expect(has(wearer, 'Slow'), 'it froze the man wearing it').toBe(false);
  });

  it('deals no damage — it is a field, not a nuke', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});
    for (let i = 0; i < 8; i++) advance(item, TICK_MS);

    expect(enemy.stats.health.value).toBe(100);
  });

  /**
   * The trap this whole shape exists to avoid. `Slow`'s default add type stacks
   * ten deep, so an aura re-applying it four times a second turns a 25% slow
   * into a standstill inside a second — and a grant tied to the aura's life
   * never lets go of somebody who walked away.
   */
  it('never stacks on somebody who stays, and lets go of somebody who leaves', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});
    for (let i = 0; i < 6; i++) advance(item, TICK_MS);

    const slows = enemy.buffs.filter(
      buff => buff.constructor.name === 'Slow' && !buff.toRemove
    );
    expect(slows.length, 'standing next to him stacked the slow').toBe(1);

    enemy.position.set(4000, 4000);
    advance(item, TICK_MS);
    age(enemy, TICK_MS + LINGER_MS + 50);

    expect(has(enemy, 'Slow'), 'the cold followed them across the map').toBe(false);
  });

  /** 420 is inside a 500 aura; 640 is not. Hand-written, not `AURA_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 420, 'dire');
    const distant = unit(game, 640, 'dire');
    indexObjects(game, [wearer, near, distant]);

    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(has(near, 'Slow')).toBe(true);
    expect(has(distant, 'Slow'), 'the cold reached past its own radius').toBe(false);
  });

  it('is a passive: no mana, no cooldown, and it arms itself', () => {
    indexObjects(game, [wearer]);
    const item = new Item_ShivasGuard(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });

  it('is tuned as a debuff rather than as a lockdown', () => {
    expect(SLOW_PCT).toBeGreaterThan(0);
    expect(SLOW_PCT).toBeLessThanOrEqual(0.35);
  });
});
