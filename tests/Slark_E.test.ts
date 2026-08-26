import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Slark_E, { E_DURATION_MS, E_MANA, E_STEAL, E_STEAL_MS } from '../spells/Slark_E';
import { indexObjects, unit } from './_units';

const api = buildTestApi();

/**
 * A basic attack landing, driven through the engine's own on-hit pipeline
 * rather than by calling the buff's hook by hand. `Buff.onHit` only ever fires
 * from here, so a test that skipped it would pass against a passive that is
 * never actually reached in a match.
 */
const swing = (attacker: AttackableUnit, victim: AttackableUnit): void => {
  api.combat.applyOnHitEffects({
    attacker,
    victim,
    damage: 10,
    ranged: false,
    crit: false,
    echo: false,
  });
};

/** Runs a body's buffs forward so an expiring steal actually falls off. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Slark_E — Rút Tinh Túy', () => {
  let game: TestGame;
  let slark: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    slark = unit(game, 0, 'radiant');
    game.setPlayer(slark);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing until he actually lands a swing', () => {
    const prey = unit(game, 100, 'dire');
    const before = slark.stats.attackDamage.value;
    indexObjects(game, [slark, prey]);

    expect(pressSpell(new Slark_E(slark), {})).toBe(true);
    expect(slark.stats.attackDamage.value, 'arming it alone paid him').toBe(before);
  });

  it('takes a point of attack damage off the victim and keeps it', () => {
    const prey = unit(game, 100, 'dire');
    const his = slark.stats.attackDamage.value;
    const theirs = prey.stats.attackDamage.value;
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_E(slark), {});
    swing(slark, prey);

    expect(slark.stats.attackDamage.value).toBe(his + E_STEAL);
    expect(prey.stats.attackDamage.value, 'it was created rather than stolen').toBe(
      theirs - E_STEAL
    );
  });

  it('stacks, so the longer he stays on somebody the worse it gets', () => {
    const prey = unit(game, 100, 'dire');
    const his = slark.stats.attackDamage.value;
    const theirs = prey.stats.attackDamage.value;
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_E(slark), {});
    swing(slark, prey);
    swing(slark, prey);
    swing(slark, prey);

    expect(slark.stats.attackDamage.value).toBe(his + E_STEAL * 3);
    expect(prey.stats.attackDamage.value).toBe(theirs - E_STEAL * 3);
  });

  it('gives it all back when the steal wears off', () => {
    const prey = unit(game, 100, 'dire');
    const his = slark.stats.attackDamage.value;
    const theirs = prey.stats.attackDamage.value;
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_E(slark), {});
    swing(slark, prey);

    age(slark, E_STEAL_MS + 100);
    age(prey, E_STEAL_MS + 100);

    expect(slark.stats.attackDamage.value, 'he kept it for ever').toBe(his);
    expect(prey.stats.attackDamage.value, 'they never got it back').toBe(theirs);
  });

  it('steals nothing from his own team', () => {
    const friend = unit(game, 100, 'radiant');
    const theirs = friend.stats.attackDamage.value;
    const his = slark.stats.attackDamage.value;
    indexObjects(game, [slark, friend]);

    pressSpell(new Slark_E(slark), {});
    swing(slark, friend);

    expect(friend.stats.attackDamage.value, 'he robbed his own side').toBe(theirs);
    expect(slark.stats.attackDamage.value).toBe(his);
  });

  it('stops stealing once the arming has worn off', () => {
    const prey = unit(game, 100, 'dire');
    const his = slark.stats.attackDamage.value;
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_E(slark), {});
    age(slark, E_DURATION_MS + 100);
    swing(slark, prey);

    expect(slark.stats.attackDamage.value, 'it kept stealing after it expired').toBe(his);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_E(slark);
    pressSpell(spell, {});

    expect(slark.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a grind rather than as a burst', () => {
    // One swing is worth very little; the ability is what twenty of them add up
    // to while Shadow Dance keeps him alive next to somebody.
    expect(E_STEAL).toBeLessThanOrEqual(4);
    expect(E_STEAL_MS).toBeGreaterThan(0);
  });
});
