import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Earthshaker_E, {
  E_DAMAGE,
  E_DURATION_MS,
  E_MANA,
  E_STUN_MS,
} from '../spells/Earthshaker_E';
import { indexObjects, unit } from './_units';

const { EventType } = buildTestApi().enums;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/**
 * A cast completing, driven through the engine's own event rather than by
 * calling the listener by hand — and with a stub spell rather than one of his
 * real abilities, so the tremor's damage is not tangled up with the damage of
 * whatever ability was used to trigger it.
 */
const castSomething = (game: TestGame, owner: AttackableUnit): void => {
  game.eventManager.emit(EventType.ON_POST_CAST_SPELL, { owner });
};

/** Runs a body's buffs forward so the arming expires. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Earthshaker_E — Dư Chấn', () => {
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

  it('does nothing by itself — it is what every other cast now also does', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    expect(pressSpell(new Earthshaker_E(shaker), {})).toBe(true);
    expect(enemy.stats.health.value, 'arming it alone shook the ground').toBe(100);
  });

  it('sends a tremor out of him every time he casts', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(enemy.stats.health.value).toBe(100 - E_DAMAGE);
    expect(has(enemy, 'Stun'), 'the tremor shook nobody').toBe(true);
  });

  it('shakes again on the next cast, and the next', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);
    castSomething(game, shaker);

    expect(enemy.stats.health.value).toBe(100 - E_DAMAGE * 2);
  });

  it('ignores casts by anybody else', () => {
    const enemy = unit(game, 120, 'dire');
    const stranger = unit(game, 200, 'dire');
    indexObjects(game, [shaker, enemy, stranger]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, stranger);

    expect(enemy.stats.health.value, 'somebody else casting shook his ground').toBe(100);
  });

  it('leaves his own team standing', () => {
    const friend = unit(game, 120, 'radiant');
    indexObjects(game, [shaker, friend]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Stun')).toBe(false);
  });

  /** 160 is inside a 200 tremor; 260 is not. Hand-written, not `E_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 160, 'dire');
    const distant = unit(game, 260, 'dire');
    indexObjects(game, [shaker, near, distant]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(near.stats.health.value).toBe(100 - E_DAMAGE);
    expect(distant.stats.health.value, 'the tremor reached too far').toBe(100);
  });

  /**
   * The half an event listener gets wrong. Subscribing is easy; the buff has to
   * take its own listener off when it expires, or Aftershock keeps firing for
   * the rest of the match — and, worse, for the rest of the *process*.
   */
  it('stops listening the moment the arming runs out', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    age(shaker, E_DURATION_MS + 100);
    castSomething(game, shaker);

    expect(enemy.stats.health.value, 'the listener outlived the buff').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [shaker]);
    const spell = new Earthshaker_E(shaker);
    pressSpell(spell, {});

    expect(shaker.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a rider on other abilities rather than as one of its own', () => {
    expect(E_DAMAGE).toBeLessThan(15);
    expect(E_STUN_MS).toBeGreaterThan(0);
    expect(E_STUN_MS).toBeLessThan(1_000);
  });
});
