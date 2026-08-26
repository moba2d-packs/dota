import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Sniper_R, {
  R_FULL_POWER_AT,
  R_MANA,
  R_MAX_DAMAGE,
  R_MIN_DAMAGE,
} from '../spells/Sniper_R';
import { indexObjects, unit } from './_units';

/** Flies the round the way the next few hundred frames of a real match would. */
const fly = (game: TestGame): void => {
  const round = game.objectManager._objectToBeAdd[0];
  for (let i = 0; i < 400 && round && !round.toRemove; i++) round.update();
};

describe('Sniper_R — Ám Sát', () => {
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

  it('carries far enough to hit somebody most abilities cannot reach', () => {
    const distant = unit(game, 1_100, 'dire');
    indexObjects(game, [sniper, distant]);

    expect(pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } })).toBe(true);
    fly(game);

    expect(distant.stats.health.value, 'the round never got there').toBeLessThan(100);
  });

  /**
   * The whole point of the round: it is worth almost nothing fired at somebody
   * standing next to him and everything fired across the map. That ramp is what
   * makes it a sniper's ultimate rather than a large nuke.
   */
  it('hits harder the further it has flown', () => {
    const close = unit(game, 120, 'dire');
    indexObjects(game, [sniper, close]);
    pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } });
    fly(game);
    const upClose = 100 - close.stats.health.value;

    const farGame = createGame();
    const farSniper = unit(farGame, 0, 'radiant');
    farGame.setPlayer(farSniper);
    const distant = unit(farGame, 1_000, 'dire');
    indexObjects(farGame, [farSniper, distant]);
    pressSpell(new Sniper_R(farSniper), { at: { x: 1_400, y: 0 } });
    fly(farGame);
    const acrossTheMap = 100 - distant.stats.health.value;

    expect(acrossTheMap, 'distance bought the shot nothing').toBeGreaterThan(upClose);
    expect(upClose).toBeGreaterThanOrEqual(R_MIN_DAMAGE);
    expect(acrossTheMap).toBeLessThanOrEqual(R_MAX_DAMAGE);
  });

  it('is at full power once it has run its stated distance', () => {
    const distant = unit(game, R_FULL_POWER_AT + 200, 'dire');
    indexObjects(game, [sniper, distant]);

    pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } });
    fly(game);

    expect(100 - distant.stats.health.value).toBe(R_MAX_DAMAGE);
  });

  it('stops on the first body rather than mowing down the line', () => {
    const first = unit(game, 400, 'dire');
    const behind = unit(game, 800, 'dire');
    indexObjects(game, [sniper, first, behind]);

    pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } });
    fly(game);

    expect(first.stats.health.value).toBeLessThan(100);
    expect(behind.stats.health.value, 'one round hit two people').toBe(100);
  });

  it('flies straight past his own team', () => {
    const friend = unit(game, 400, 'radiant');
    const enemy = unit(game, 800, 'dire');
    indexObjects(game, [sniper, friend, enemy]);

    pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } });
    fly(game);

    expect(friend.stats.health.value).toBe(100);
    expect(enemy.stats.health.value, 'his own man stopped the round').toBeLessThan(100);
  });

  it('misses anyone standing off the line', () => {
    const aside = unit(game, 600, 'dire', 400);
    indexObjects(game, [sniper, aside]);

    pressSpell(new Sniper_R(sniper), { at: { x: 1_400, y: 0 } });
    fly(game);

    expect(aside.stats.health.value).toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [sniper]);
    const spell = new Sniper_R(sniper);
    pressSpell(spell, { at: { x: 1_400, y: 0 } });

    expect(sniper.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_MIN_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_MAX_DAMAGE).toBeLessThanOrEqual(60);
    expect(R_MAX_DAMAGE).toBeGreaterThan(R_MIN_DAMAGE);
  });
});
