import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Euls, { CYCLONE_MS } from '../spells/Item_Euls';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** Runs a body's buffs forward so the cyclone sets them down again. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Euls — Vương Trượng Eul', () => {
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

  it('lifts an enemy off the ground', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    expect(pressSpell(new Item_Euls(wearer), { target: victim })).toBe(true);
    expect(has(victim, 'Airborne'), 'the cyclone left them standing').toBe(true);
  });

  /**
   * The beat that makes Eul's a *save* as well as a setup: while they are up
   * there nothing can touch them, so the item buys time rather than simply
   * dealing a stun with extra words.
   */
  it('puts them out of reach while they are up there', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    pressSpell(new Item_Euls(wearer), { target: victim });
    expect(has(victim, 'Untargetable'), 'they could be shot out of the air').toBe(true);
  });

  it('sets them down again, both halves together', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    pressSpell(new Item_Euls(wearer), { target: victim });
    age(victim, CYCLONE_MS + 100);

    expect(has(victim, 'Airborne'), 'they never came down').toBe(false);
    expect(has(victim, 'Untargetable'), 'they stayed untouchable on the ground').toBe(false);
  });

  it('deals no damage — it is a hold, not a hit', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    pressSpell(new Item_Euls(wearer), { target: victim });
    expect(victim.stats.health.value).toBe(100);
  });

  it('refuses an ally, and refuses to cyclone its own wearer', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [wearer, friend]);

    expect(pressSpell(new Item_Euls(wearer), { target: friend })).toBe(false);
    expect(has(friend, 'Airborne')).toBe(false);

    // Without `targetTeam: 'ENEMY'` the resolver defaults to 'ANY', which
    // includes the caster — a press over empty ground would cyclone the wearer.
    expect(pressSpell(new Item_Euls(wearer), { target: wearer })).toBe(false);
    expect(pressSpell(new Item_Euls(wearer), { at: { x: 40, y: 40 } })).toBe(false);
    expect(has(wearer, 'Airborne')).toBe(false);
  });

  /** 480 is inside a 550 reach; 660 is not. Hand-written, not `RANGE ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 480, 'dire');
    const distant = unit(game, 660, 'dire');
    indexObjects(game, [wearer, near, distant]);

    expect(pressSpell(new Item_Euls(wearer), { target: distant })).toBe(false);
    expect(has(distant, 'Airborne')).toBe(false);
    expect(pressSpell(new Item_Euls(wearer), { target: near })).toBe(true);
  });

  it('costs no mana and goes on cooldown', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    const item = new Item_Euls(wearer);
    pressSpell(item, { target: victim });

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
