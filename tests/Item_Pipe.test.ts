import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Pipe, { BARRIER_AMOUNT, BARRIER_MS, RADIUS } from '../spells/Item_Pipe';
import { indexObjects, unit } from './_units';

const wards = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.name === 'Tẩu Thông Tuệ' && !buff.toRemove);

/** Runs a body's buffs forward so an expiring ward actually dissolves. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Pipe — Tẩu Thông Tuệ', () => {
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

  it('wards himself and the ally standing with him', () => {
    expect(pressSpell(new Item_Pipe(carrier), {})).toBe(true);

    expect(wards(carrier).length, 'the buyer got nothing').toBe(1);
    expect(wards(friend).length, 'the ally beside him got nothing').toBe(1);
  });

  it('never wards the other side', () => {
    pressSpell(new Item_Pipe(carrier), {});
    expect(wards(enemy).length, 'it shielded an enemy').toBe(0);
  });

  /** 250 is inside a 400 ring; 640 is not. Hand-written, not `RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const distant = unit(game, 640, 'radiant');
    // `indexObjects` replaces the index, so the whole world goes back in.
    indexObjects(game, [carrier, friend, enemy, distant]);

    pressSpell(new Item_Pipe(carrier), {});
    expect(wards(friend).length).toBe(1);
    expect(wards(distant).length, 'the smoke reached past its own radius').toBe(0);
  });

  it('eats the nuke and ignores the blade', () => {
    pressSpell(new Item_Pipe(carrier), {});

    friend.takeDamage(BARRIER_AMOUNT, enemy, 'MAGIC', 'test');
    expect(friend.stats.health.value, 'the ward let the spell through').toBe(100);

    // The pool is spent; the same hit again lands in full.
    friend.takeDamage(10, enemy, 'MAGIC', 'test');
    expect(friend.stats.health.value).toBe(90);

    carrier.takeDamage(10, enemy, 'PHYSICAL', 'test');
    expect(carrier.stats.health.value, 'the ward answered a swing').toBe(90);
  });

  it('dissolves when the window closes', () => {
    pressSpell(new Item_Pipe(carrier), {});

    age(friend, BARRIER_MS + 100);
    expect(wards(friend).length, 'the ward outlived its own window').toBe(0);

    friend.takeDamage(10, enemy, 'MAGIC', 'test');
    expect(friend.stats.health.value).toBe(90);
  });

  /**
   * Two Tẩu on one side pressed together must not stack thirty points of ward
   * on everybody — one barrier per body, its clock rewound. The RADIUS export
   * keeps the second caster honestly inside the first one's ring.
   */
  it('does not stack with a second copy pressed beside it', () => {
    expect(RADIUS).toBeGreaterThan(250);
    pressSpell(new Item_Pipe(carrier), {});
    pressSpell(new Item_Pipe(friend), {});

    expect(wards(carrier).length, 'two pipes stacked their barriers').toBe(1);
    expect(wards(friend).length).toBe(1);
  });

  it('is a snapshot: an ally arriving late gets nothing', () => {
    const late = unit(game, 3_000, 'radiant');
    // `indexObjects` replaces the index, so the whole world goes back in.
    indexObjects(game, [carrier, friend, enemy, late]);

    pressSpell(new Item_Pipe(carrier), {});
    expect(wards(friend).length, 'the press itself granted nothing').toBe(1);

    late.position.set(50, 0);
    age(late, 500);
    expect(wards(late).length, 'the smoke waited for a latecomer').toBe(0);
  });

  it('is tied to the item, costs no mana, and goes on cooldown', () => {
    const item = new Item_Pipe(carrier);
    pressSpell(item, {});

    // Selling it mid-window drops every ward it handed out — core reads
    // `sourceSpell` on each ally's barrier, not only the buyer's.
    expect(wards(friend)[0]?.sourceSpell).toBe(item);
    expect(carrier.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
