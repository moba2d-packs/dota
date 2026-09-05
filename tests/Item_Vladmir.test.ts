import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Vladmir, { LIFESTEAL_SHARE, LINGER_MS, TICK_MS } from '../spells/Item_Vladmir';
import { indexObjects, unit } from './_units';

const grants = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.constructor.name === 'StatAmp' && !buff.toRemove);

/** One slice of match time on the aura, which owns the tick. */
const advance = (item: Item_Vladmir, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (item.live && !item.live.toRemove) item.live.update();
  vi.stubGlobal('deltaTime', 16);
};

/** Runs a body's buffs forward so an expiring grant actually lapses. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Vladmir — Lễ Vật Vladmir', () => {
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

  it('feeds the wearer and the ally standing with him, from the first frame', () => {
    const friend = unit(game, 250, 'radiant');
    indexObjects(game, [wearer, friend]);

    const item = new Item_Vladmir(wearer);
    expect(pressSpell(item, {})).toBe(true);
    advance(item, 16);

    expect(wearer.stats.lifesteal.value, 'the buyer drinks nothing').toBeCloseTo(
      LIFESTEAL_SHARE
    );
    expect(friend.stats.lifesteal.value, 'the ally beside him drinks nothing').toBeCloseTo(
      LIFESTEAL_SHARE
    );
  });

  it('offers the other side nothing', () => {
    const enemy = unit(game, 250, 'dire');
    indexObjects(game, [wearer, enemy]);

    const item = new Item_Vladmir(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(enemy.stats.lifesteal.value, 'it fed an enemy').toBe(0);
  });

  /** The membership arithmetic: one grant per body, and leavers lapse a beat later. */
  it('never stacks on somebody who stays, and lets go of somebody who leaves', () => {
    const friend = unit(game, 250, 'radiant');
    indexObjects(game, [wearer, friend]);

    const item = new Item_Vladmir(wearer);
    pressSpell(item, {});
    for (let i = 0; i < 6; i++) advance(item, TICK_MS);

    expect(grants(friend).length, 'standing in it stacked the grant').toBe(1);
    expect(friend.stats.lifesteal.value).toBeCloseTo(LIFESTEAL_SHARE);

    friend.position.set(4000, 4000);
    advance(item, TICK_MS);
    age(friend, TICK_MS + LINGER_MS + 50);

    expect(grants(friend).length, 'the offering followed them across the map').toBe(0);
    expect(friend.stats.lifesteal.value).toBe(0);
  });

  it('adds up to one offering even from two wearers', () => {
    const second = unit(game, 100, 'radiant');
    indexObjects(game, [wearer, second]);

    const first = new Item_Vladmir(wearer);
    const other = new Item_Vladmir(second);
    pressSpell(first, {});
    pressSpell(other, {});
    advance(first, TICK_MS);
    advance(other, TICK_MS);

    expect(grants(wearer).length, 'two Vladmirs doubled the drink').toBe(1);
    expect(wearer.stats.lifesteal.value).toBeCloseTo(LIFESTEAL_SHARE);
  });

  /** 420 is inside a 450 ring; 640 is not. Hand-written, not `AURA_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 420, 'radiant');
    const distant = unit(game, 640, 'radiant');
    indexObjects(game, [wearer, near, distant]);

    const item = new Item_Vladmir(wearer);
    pressSpell(item, {});
    advance(item, TICK_MS);

    expect(near.stats.lifesteal.value).toBeCloseTo(LIFESTEAL_SHARE);
    expect(distant.stats.lifesteal.value, 'the ring reached past its own radius').toBe(0);
  });

  it('is a passive: no mana, no cooldown, and it arms itself', () => {
    indexObjects(game, [wearer]);
    const item = new Item_Vladmir(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
    expect(item.live, 'nothing was raised').not.toBeNull();
  });
});
