import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Earthshaker_W, { W_AIRBORNE_MS, W_DAMAGE, W_MANA } from '../spells/Earthshaker_W';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

describe('Earthshaker_W — Thần Chú Đá', () => {
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

  it('slams the totem down and throws everyone close into the air', () => {
    const near = unit(game, 150, 'dire');
    indexObjects(game, [shaker, near]);

    expect(pressSpell(new Earthshaker_W(shaker), {})).toBe(true);

    expect(near.stats.health.value).toBe(100 - W_DAMAGE);
    expect(has(near, 'Airborne'), 'the slam left them standing').toBe(true);
  });

  it('catches several at once', () => {
    const first = unit(game, 120, 'dire');
    const second = unit(game, 0, 'dire', 180);
    indexObjects(game, [shaker, first, second]);

    pressSpell(new Earthshaker_W(shaker), {});

    expect(first.stats.health.value).toBe(100 - W_DAMAGE);
    expect(second.stats.health.value).toBe(100 - W_DAMAGE);
  });

  it('leaves his own team on their feet', () => {
    const friend = unit(game, 150, 'radiant');
    indexObjects(game, [shaker, friend]);

    pressSpell(new Earthshaker_W(shaker), {});

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Airborne')).toBe(false);
  });

  it('does not throw himself into the air', () => {
    indexObjects(game, [shaker]);
    pressSpell(new Earthshaker_W(shaker), {});

    expect(has(shaker, 'Airborne')).toBe(false);
    expect(shaker.stats.health.value).toBe(100);
  });

  /** 190 is inside a 240 slam; 300 is not. Hand-written, not `W_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 190, 'dire');
    const distant = unit(game, 300, 'dire');
    indexObjects(game, [shaker, near, distant]);

    pressSpell(new Earthshaker_W(shaker), {});

    expect(near.stats.health.value).toBe(100 - W_DAMAGE);
    expect(distant.stats.health.value, 'the slam reached past its own radius').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [shaker]);
    const spell = new Earthshaker_W(shaker);
    pressSpell(spell, {});

    expect(shaker.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(W_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(W_DAMAGE).toBeLessThanOrEqual(35);
    expect(W_AIRBORNE_MS).toBeGreaterThan(0);
  });
});
