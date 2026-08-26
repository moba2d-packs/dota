import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Sniper_W, { W_BONUS_RANGE, W_DURATION_MS, W_MANA } from '../spells/Sniper_W';
import { indexObjects, unit } from './_units';

/** Runs the caster's buffs forward so the steadying expires. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Sniper_W — Ngắm Bắn', () => {
  let game: TestGame;
  let sniper: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    sniper = unit(game, 0, 'radiant');
    game.setPlayer(sniper);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lengthens his reach by exactly what it claims', () => {
    indexObjects(game, [sniper]);
    const before = sniper.stats.attackRange.value;

    expect(pressSpell(new Sniper_W(sniper), {})).toBe(true);
    expect(sniper.stats.attackRange.value).toBe(before + W_BONUS_RANGE);
  });

  it('gives it back when it wears off', () => {
    indexObjects(game, [sniper]);
    const before = sniper.stats.attackRange.value;

    pressSpell(new Sniper_W(sniper), {});
    age(sniper, W_DURATION_MS + 100);

    expect(sniper.stats.attackRange.value, 'the reach outlived the ability').toBe(before);
  });

  it('is his alone', () => {
    const friend = unit(game, 200, 'radiant');
    const enemy = unit(game, 300, 'dire');
    const friendBefore = friend.stats.attackRange.value;
    const enemyBefore = enemy.stats.attackRange.value;
    indexObjects(game, [sniper, friend, enemy]);

    pressSpell(new Sniper_W(sniper), {});

    expect(friend.stats.attackRange.value).toBe(friendBefore);
    expect(enemy.stats.attackRange.value).toBe(enemyBefore);
  });

  /**
   * A recast must rewind one steadying rather than adding a second — otherwise
   * pressing it twice inside its own duration doubles his reach, which is a
   * different ability and an unintended one.
   */
  it('never stacks on itself', () => {
    indexObjects(game, [sniper]);
    const before = sniper.stats.attackRange.value;

    const first = new Sniper_W(sniper);
    pressSpell(first, {});
    // A second instance, because the first is on cooldown — the same thing a
    // second life or a cooldown reset would do.
    pressSpell(new Sniper_W(sniper), {});

    expect(sniper.stats.attackRange.value, 'two presses doubled his reach').toBe(
      before + W_BONUS_RANGE
    );
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [sniper]);
    const spell = new Sniper_W(sniper);
    pressSpell(spell, {});

    expect(sniper.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    indexObjects(game, [sniper]);
    const before = sniper.stats.attackRange.value;
    sniper.stats.mana.baseValue = W_MANA - 1;

    expect(pressSpell(new Sniper_W(sniper), {})).toBe(false);
    expect(sniper.stats.attackRange.value).toBe(before);
  });
});
