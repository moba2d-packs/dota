import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import VengefulSpirit_Q, { Q_DAMAGE, Q_MANA, Q_STUN_MS } from '../spells/VengefulSpirit_Q';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

/** Flies the missile the way the next sixty frames of a real match would. */
const fly = (game: TestGame): void => {
  const shot = game.objectManager._objectToBeAdd[0];
  for (let i = 0; i < 200 && shot && !shot.toRemove; i++) shot.update();
};

describe('VengefulSpirit_Q — Tên Lửa Phép', () => {
  let game: TestGame;
  let vengeful: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    vengeful = unit(game, 0, 'radiant');
    game.setPlayer(vengeful);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lands on the enemy it was aimed at and stuns them', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [vengeful, victim]);

    expect(pressSpell(new VengefulSpirit_Q(vengeful), { target: victim })).toBe(true);
    fly(game);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(has(victim, 'Stun'), 'it landed without stunning').toBe(true);
  });

  /**
   * The reason this is a homing missile rather than a skillshot: Magic Missile
   * does not miss. A target that walks after the press is still hit.
   */
  it('follows a target that moves after it was fired', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [vengeful, victim]);

    pressSpell(new VengefulSpirit_Q(vengeful), { target: victim });
    // One frame of flight, then they run somewhere else entirely.
    const shot = game.objectManager._objectToBeAdd[0];
    shot.update();
    victim.position.set(120, 340);

    for (let i = 0; i < 200 && !shot.toRemove; i++) shot.update();
    expect(victim.stats.health.value, 'the missile flew to where they used to be').toBe(
      100 - Q_DAMAGE
    );
  });

  it('does not hit whoever it passes on the way', () => {
    const bystander = unit(game, 150, 'dire');
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [vengeful, bystander, victim]);

    pressSpell(new VengefulSpirit_Q(vengeful), { target: victim });
    fly(game);

    expect(bystander.stats.health.value, 'it hit someone it flew past').toBe(100);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('refuses an ally, and refuses to fire at itself', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [vengeful, friend]);

    expect(pressSpell(new VengefulSpirit_Q(vengeful), { target: friend })).toBe(false);
    expect(pressSpell(new VengefulSpirit_Q(vengeful), { target: vengeful })).toBe(false);
    expect(pressSpell(new VengefulSpirit_Q(vengeful), { at: { x: 30, y: 30 } })).toBe(false);
    expect(friend.stats.health.value).toBe(100);
    expect(vengeful.stats.health.value).toBe(100);
  });

  /** 350 is inside a 420 reach; 500 is not. Written by hand, not as `Q_RANGE ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 350, 'dire');
    const distant = unit(game, 500, 'dire');
    indexObjects(game, [vengeful, near, distant]);

    expect(pressSpell(new VengefulSpirit_Q(vengeful), { target: distant })).toBe(false);
    expect(pressSpell(new VengefulSpirit_Q(vengeful), { target: near })).toBe(true);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [vengeful, victim]);

    const spell = new VengefulSpirit_Q(vengeful);
    pressSpell(spell, { target: victim });

    expect(vengeful.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
    expect(Q_STUN_MS).toBeGreaterThan(0);
  });
});
