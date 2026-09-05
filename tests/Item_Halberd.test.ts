import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Halberd, { DISARM_MS } from '../spells/Item_Halberd';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** Runs a body's buffs forward so the weapon comes back on time. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Halberd — Kích Thiên Đường', () => {
  let game: TestGame;
  let wearer: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    game.setPlayer(wearer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes the weapon out of an enemy’s hands', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    expect(pressSpell(new Item_Halberd(wearer), { target: victim })).toBe(true);
    expect(has(victim, 'Disarm'), 'their weapon still works').toBe(true);
  });

  it('gives it back on time', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    pressSpell(new Item_Halberd(wearer), { target: victim });
    age(victim, DISARM_MS + 100);

    expect(has(victim, 'Disarm'), 'the disarm never ended').toBe(false);
  });

  it('deals no damage — it is a refusal, not a hit', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    pressSpell(new Item_Halberd(wearer), { target: victim });
    expect(victim.stats.health.value).toBe(100);
  });

  it('refuses an ally, and refuses to disarm its own wearer', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [wearer, friend]);

    expect(pressSpell(new Item_Halberd(wearer), { target: friend })).toBe(false);
    expect(has(friend, 'Disarm')).toBe(false);

    // Without `targetTeam: 'ENEMY'` the resolver defaults to 'ANY', which
    // includes the caster — a press over empty ground would disarm the wearer.
    expect(pressSpell(new Item_Halberd(wearer), { target: wearer })).toBe(false);
    expect(pressSpell(new Item_Halberd(wearer), { at: { x: 40, y: 40 } })).toBe(false);
    expect(has(wearer, 'Disarm')).toBe(false);
  });

  /** 420 is inside a 500 reach; 640 is not. Hand-written, not `RANGE ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 420, 'dire');
    const distant = unit(game, 640, 'dire');
    indexObjects(game, [wearer, near, distant]);

    expect(pressSpell(new Item_Halberd(wearer), { target: distant })).toBe(false);
    expect(has(distant, 'Disarm')).toBe(false);
    expect(pressSpell(new Item_Halberd(wearer), { target: near })).toBe(true);
  });

  it('costs no mana and goes on cooldown', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [wearer, victim]);

    const item = new Item_Halberd(wearer);
    pressSpell(item, { target: victim });

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
