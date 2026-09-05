import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_CrimsonGuard, { BARRIER_AMOUNT, BARRIER_MS } from '../spells/Item_CrimsonGuard';
import { indexObjects, unit } from './_units';

const guards = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.name === 'Vệ Binh Đỏ' && !buff.toRemove);

/** Runs a body's buffs forward so an expiring barrier is actually lowered. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

/**
 * The physical-facing half of the team-barrier pair. The mechanism and its
 * shape arguments are Tẩu Thông Tuệ's, and `Item_Pipe.test.ts` is where the
 * shared behaviour — reach, the snapshot rule, double-copy stacking — is
 * pinned. What is held here is everything that makes this the *other* button:
 * the damage types trade places in every assertion.
 */
describe('Item_CrimsonGuard — Vệ Binh Đỏ', () => {
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

  it('shields himself and the ally standing with him, and nobody dire', () => {
    expect(pressSpell(new Item_CrimsonGuard(carrier), {})).toBe(true);

    expect(guards(carrier).length, 'the buyer got nothing').toBe(1);
    expect(guards(friend).length, 'the ally beside him got nothing').toBe(1);
    expect(guards(enemy).length, 'it shielded an enemy').toBe(0);
  });

  /** The mirror of Tẩu's rule: blades stop, spells sail through. */
  it('eats the blade and ignores the nuke', () => {
    pressSpell(new Item_CrimsonGuard(carrier), {});

    friend.takeDamage(BARRIER_AMOUNT, enemy, 'PHYSICAL', 'test');
    expect(friend.stats.health.value, 'the barrier let the swing through').toBe(100);

    // The pool is spent; the same hit again lands in full.
    friend.takeDamage(10, enemy, 'PHYSICAL', 'test');
    expect(friend.stats.health.value).toBe(90);

    carrier.takeDamage(10, enemy, 'MAGIC', 'test');
    expect(carrier.stats.health.value, 'the barrier answered a spell').toBe(90);
  });

  it('is lowered when the window closes', () => {
    pressSpell(new Item_CrimsonGuard(carrier), {});

    age(friend, BARRIER_MS + 100);
    expect(guards(friend).length, 'the barrier outlived its own window').toBe(0);
  });

  it('is tied to the item, costs no mana, and goes on cooldown', () => {
    const item = new Item_CrimsonGuard(carrier);
    pressSpell(item, {});

    expect(guards(friend)[0]?.sourceSpell).toBe(item);
    expect(carrier.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
