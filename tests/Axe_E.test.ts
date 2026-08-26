import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Axe_E, {
  E_DURATION_MS,
  E_MANA,
  E_RADIUS,
  E_SPIN_COOLDOWN_MS,
  E_SPIN_DAMAGE,
} from '../spells/Axe_E';
import { indexObjects, unit } from './_units';

/** Drives the armed buff's own clock, which is what the spin cooldown runs on. */
const advance = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Axe_E — Xoáy Phản Đòn', () => {
  let game: TestGame;
  let axe: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    axe = unit(game, 0, 'radiant');
    game.setPlayer(axe);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing on its own — it is what happens when he is hit', () => {
    const enemy = unit(game, 100, 'dire');
    indexObjects(game, [axe, enemy]);

    expect(pressSpell(new Axe_E(axe), {})).toBe(true);
    expect(enemy.stats.health.value, 'arming it alone hurt somebody').toBe(100);
  });

  it('spins when he takes a hit, and cuts everyone standing close', () => {
    const attacker = unit(game, 100, 'dire');
    const bystander = unit(game, 0, 'dire', 140);
    indexObjects(game, [axe, attacker, bystander]);

    pressSpell(new Axe_E(axe), {});
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');

    expect(attacker.stats.health.value).toBe(100 - E_SPIN_DAMAGE);
    expect(bystander.stats.health.value, 'the helix missed someone standing in it').toBe(
      100 - E_SPIN_DAMAGE
    );
  });

  it('leaves his own team and himself out of it', () => {
    const attacker = unit(game, 100, 'dire');
    const friend = unit(game, 0, 'radiant', 120);
    indexObjects(game, [axe, attacker, friend]);

    const before = axe.stats.health.value;
    pressSpell(new Axe_E(axe), {});
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');

    expect(friend.stats.health.value, 'the helix cut his own side').toBe(100);
    // He took the incoming 10 and nothing else — the spin did not also hit him.
    expect(axe.stats.health.value).toBe(before - 10);
  });

  /**
   * Hand-written distances rather than `E_RADIUS ± n`. 150 is inside a 200
   * helix; 280 is not.
   */
  it('reaches exactly as far as it says it does', () => {
    const attacker = unit(game, 150, 'dire');
    const distant = unit(game, 280, 'dire');
    indexObjects(game, [axe, attacker, distant]);

    pressSpell(new Axe_E(axe), {});
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');

    expect(attacker.stats.health.value).toBe(100 - E_SPIN_DAMAGE);
    expect(distant.stats.health.value, 'the helix reached past its own radius').toBe(100);
  });

  it('will not spin twice inside its own recovery', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [axe, attacker]);

    pressSpell(new Axe_E(axe), {});
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value).toBe(100 - E_SPIN_DAMAGE);

    // A second hit on the very next frame buys nothing.
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value, 'it spun twice without recovering').toBe(
      100 - E_SPIN_DAMAGE
    );

    // Once the recovery has run, it spins again.
    advance(axe, E_SPIN_COOLDOWN_MS);
    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value).toBe(100 - E_SPIN_DAMAGE * 2);
  });

  it('stops spinning once the arming has worn off', () => {
    const attacker = unit(game, 100, 'dire');
    indexObjects(game, [axe, attacker]);

    pressSpell(new Axe_E(axe), {});
    advance(axe, E_DURATION_MS + 100);

    axe.takeDamage(10, attacker, 'PHYSICAL', 'test');
    expect(attacker.stats.health.value, 'it kept spinning after it expired').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [axe]);
    const spell = new Axe_E(axe);
    pressSpell(spell, {});

    expect(axe.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a proc rather than as a nuke', () => {
    // One spin is a fraction of an ability's worth; the payoff is that Q makes
    // several bodies stand next to him while it is armed.
    expect(E_SPIN_DAMAGE).toBeLessThan(15);
    expect(E_RADIUS).toBeGreaterThan(0);
  });
});
