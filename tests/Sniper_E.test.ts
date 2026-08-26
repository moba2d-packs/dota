import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Sniper_E, { E_DAMAGE, E_DURATION_MS, E_EVERY, E_MANA } from '../spells/Sniper_E';
import { indexObjects, unit } from './_units';

const api = buildTestApi();

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** A basic attack landing, driven through the engine's own on-hit pipeline. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit): void => {
  api.combat.applyOnHitEffects({
    attacker,
    victim,
    damage: 10,
    ranged: true,
    crit: false,
    echo: false,
  });
};

/** Runs a body's buffs forward — the knock-back is a buff and moves on its own. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Sniper_E — Bắn Tỉa', () => {
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

  it('does nothing on the shots between', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [sniper, victim]);

    pressSpell(new Sniper_E(sniper), {});
    for (let i = 0; i < E_EVERY - 1; i++) swing(sniper, victim);

    expect(victim.stats.health.value, 'an ordinary shot landed a headshot').toBe(100);
    expect(has(victim, 'Airborne')).toBe(false);
  });

  it('lands the headshot on the counted shot, and knocks them back', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [sniper, victim]);

    pressSpell(new Sniper_E(sniper), {});
    for (let i = 0; i < E_EVERY; i++) swing(sniper, victim);

    expect(victim.stats.health.value).toBe(100 - E_DAMAGE);
    expect(has(victim, 'Airborne'), 'the headshot left them standing').toBe(true);
  });

  /**
   * A knock-back is `Airborne` plus a caster-sourced `Dash` on the victim, and
   * the dash has to be uncancellable — `Airborne` is itself in the dash's own
   * interrupt list, so a cancellable knock-back is one the knock-up cancels.
   */
  it('actually moves them away from him', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [sniper, victim]);

    pressSpell(new Sniper_E(sniper), {});
    for (let i = 0; i < E_EVERY; i++) swing(sniper, victim);

    const before = victim.position.x;
    for (let i = 0; i < 30; i++) victim.updateBuffs();

    expect(victim.position.x, 'the knock-back went nowhere').toBeGreaterThan(before);
  });

  it('counts again after it fires, rather than headshotting every shot from then on', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [sniper, victim]);

    pressSpell(new Sniper_E(sniper), {});
    for (let i = 0; i < E_EVERY; i++) swing(sniper, victim);
    expect(victim.stats.health.value).toBe(100 - E_DAMAGE);

    // The very next shot is an ordinary one again.
    swing(sniper, victim);
    expect(victim.stats.health.value, 'every shot became a headshot').toBe(100 - E_DAMAGE);

    for (let i = 0; i < E_EVERY - 1; i++) swing(sniper, victim);
    expect(victim.stats.health.value).toBe(100 - E_DAMAGE * 2);
  });

  it('never fires on his own team', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [sniper, friend]);

    pressSpell(new Sniper_E(sniper), {});
    for (let i = 0; i < E_EVERY * 2; i++) swing(sniper, friend);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Airborne')).toBe(false);
  });

  it('stops once the arming has worn off', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [sniper, victim]);

    pressSpell(new Sniper_E(sniper), {});
    age(sniper, E_DURATION_MS + 100);
    for (let i = 0; i < E_EVERY * 2; i++) swing(sniper, victim);

    expect(victim.stats.health.value, 'it kept shooting after it expired').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [sniper]);
    const spell = new Sniper_E(sniper);
    pressSpell(spell, {});

    expect(sniper.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a proc rather than as an ability', () => {
    expect(E_DAMAGE).toBeLessThan(15);
    expect(E_EVERY).toBeGreaterThan(1);
  });
});
