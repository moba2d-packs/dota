import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Earthshaker_R, {
  R_BASE_DAMAGE,
  R_ECHO_DAMAGE,
  R_MANA,
  R_MAX_ECHOES,
} from '../spells/Earthshaker_R';
import { indexObjects, unit } from './_units';

describe('Earthshaker_R — Chấn Động Dư Âm', () => {
  let game: TestGame;
  let shaker: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    shaker = unit(game, 0, 'radiant');
    game.setPlayer(shaker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is an ordinary heavy slam against one enemy standing alone', () => {
    const alone = unit(game, 200, 'dire');
    indexObjects(game, [shaker, alone]);

    expect(pressSpell(new Earthshaker_R(shaker), {})).toBe(true);
    expect(alone.stats.health.value).toBe(100 - R_BASE_DAMAGE);
  });

  /**
   * The whole ability. Every body caught is another echo, and every echo lands
   * on everybody — so the slam is worth what the enemy team's own grouping made
   * it worth, not a number this ability chose.
   */
  it('hits harder for every extra body caught in it', () => {
    const first = unit(game, 150, 'dire');
    const second = unit(game, 0, 'dire', 150);
    const third = unit(game, -150, 'dire');
    indexObjects(game, [shaker, first, second, third]);

    pressSpell(new Earthshaker_R(shaker), {});

    // Three caught: the slam itself, plus an echo from each of the other two.
    const expected = R_BASE_DAMAGE + R_ECHO_DAMAGE * 2;
    expect(first.stats.health.value).toBe(100 - expected);
    expect(second.stats.health.value).toBe(100 - expected);
    expect(third.stats.health.value).toBe(100 - expected);
  });

  it('caps how far the echoes can run away with it', () => {
    const crowd: AttackableUnit[] = [];
    for (let i = 0; i < R_MAX_ECHOES + 6; i++) {
      crowd.push(unit(game, 120 + i * 4, 'dire', i * 3));
    }
    indexObjects(game, [shaker, ...crowd]);

    pressSpell(new Earthshaker_R(shaker), {});

    const ceiling = R_BASE_DAMAGE + R_ECHO_DAMAGE * R_MAX_ECHOES;
    for (const body of crowd) {
      expect(
        100 - body.stats.health.value,
        'a big enough crowd made one press lethal to everybody'
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it('leaves his own team alone, and does not echo off them', () => {
    const enemy = unit(game, 150, 'dire');
    const friend = unit(game, 0, 'radiant', 150);
    const secondFriend = unit(game, -150, 'radiant');
    indexObjects(game, [shaker, enemy, friend, secondFriend]);

    pressSpell(new Earthshaker_R(shaker), {});

    expect(friend.stats.health.value).toBe(100);
    expect(secondFriend.stats.health.value).toBe(100);
    // Allies standing in it must not inflate the echo count.
    expect(enemy.stats.health.value, 'his own team echoed the slam').toBe(100 - R_BASE_DAMAGE);
  });

  /** 340 is inside a 420 slam; 520 is not. Hand-written, not `R_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 340, 'dire');
    const distant = unit(game, 520, 'dire');
    indexObjects(game, [shaker, near, distant]);

    pressSpell(new Earthshaker_R(shaker), {});

    expect(near.stats.health.value).toBe(100 - R_BASE_DAMAGE);
    expect(distant.stats.health.value, 'the slam reached past its own radius').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const enemy = unit(game, 200, 'dire');
    indexObjects(game, [shaker, enemy]);

    const spell = new Earthshaker_R(shaker);
    pressSpell(spell, {});

    expect(shaker.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_BASE_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_BASE_DAMAGE).toBeLessThanOrEqual(60);
  });
});
