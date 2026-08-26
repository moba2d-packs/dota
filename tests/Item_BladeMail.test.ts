import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_BladeMail, { DURATION_MS, REFLECT_PERCENT } from '../spells/Item_BladeMail';
import { indexObjects, unit } from './_units';

const reflectBuff = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'DamageReflect' && !buff.toRemove);

/** Runs a body's buffs forward so the armed window expires. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_BladeMail — Giáp Kiếm', () => {
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

  it('does nothing until it is pressed', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [wearer, attacker]);

    wearer.takeDamage(20, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value, 'it reflected without being turned on').toBe(100);
  });

  it('sends a share of every hit straight back while it is on', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [wearer, attacker]);

    expect(pressSpell(new Item_BladeMail(wearer), {})).toBe(true);
    wearer.takeDamage(20, attacker, 'PHYSICAL', 'test');

    expect(attacker.stats.health.value).toBe(100 - Math.round(20 * REFLECT_PERCENT));
  });

  it('keeps paying, hit after hit', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [wearer, attacker]);

    pressSpell(new Item_BladeMail(wearer), {});
    wearer.takeDamage(20, attacker, 'PHYSICAL', 'test');
    wearer.takeDamage(20, attacker, 'PHYSICAL', 'test');

    expect(attacker.stats.health.value, 'it fired once and went quiet').toBe(
      100 - Math.round(20 * REFLECT_PERCENT) * 2
    );
  });

  it('stops when the window closes', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [wearer, attacker]);

    pressSpell(new Item_BladeMail(wearer), {});
    age(wearer, DURATION_MS + 100);

    wearer.takeDamage(20, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value, 'the reflect outlived its own window').toBe(100);
  });

  /**
   * Self-damage is not an attack, and a cost that refunds itself is not a cost.
   * Core's own `DamageReflect` applies that rule; this checks the item inherits
   * it rather than re-implementing it wrongly.
   */
  it('does not pay itself back for its own wearer’s costs', () => {
    indexObjects(game, [wearer]);
    pressSpell(new Item_BladeMail(wearer), {});

    const before = wearer.stats.health.value;
    wearer.takeDamage(10, wearer, 'TRUE', 'test');
    expect(wearer.stats.health.value).toBe(before - 10);
  });

  /**
   * A bookkeeping buff hides itself, or every purchase adds a row to the buff
   * bar. This one is a real timed window, so it *does* show — the test states
   * which of the two it is, on purpose.
   */
  it('shows on the buff bar, because it is a window and not bookkeeping', () => {
    indexObjects(game, [wearer]);
    pressSpell(new Item_BladeMail(wearer), {});

    expect(reflectBuff(wearer)?.hudVisible).toBe(true);
    expect(reflectBuff(wearer)?.duration).toBe(DURATION_MS);
  });

  it('is tied to the item rather than to the life', () => {
    indexObjects(game, [wearer]);
    const item = new Item_BladeMail(wearer);
    pressSpell(item, {});

    // `sourceSpell` is what core 1.5 reads to drop an item's buffs when the
    // item is sold; without it a sold Giáp Kiếm reflects for the rest of the
    // match.
    expect(reflectBuff(wearer)?.sourceSpell).toBe(item);
  });

  it('costs no mana and goes on cooldown', () => {
    indexObjects(game, [wearer]);
    const item = new Item_BladeMail(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
