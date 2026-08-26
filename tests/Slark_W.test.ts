import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Slark_W, { W_DAMAGE, W_MANA } from '../spells/Slark_W';
import { indexObjects, unit } from './_units';

const { Ground } = buildTestApi().buffs;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/**
 * Runs the pounce. `Dash` moves the body inside its own `onUpdate`, so the way
 * to advance one is to run the unit's buff pass — the same thing a real frame
 * does.
 */
const bound = (body: AttackableUnit, frames = 60): void => {
  for (let i = 0; i < frames; i++) body.updateBuffs();
};

describe('Slark_W — Vồ Mồi', () => {
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

  it('carries him toward where he pointed', () => {
    indexObjects(game, [slark]);
    expect(pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } })).toBe(true);

    bound(slark);
    expect(slark.position.x, 'he pounced nowhere').toBeGreaterThan(200);
  });

  it('catches the first enemy in the way, and leashes them', () => {
    const prey = unit(game, 200, 'dire');
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } });
    bound(slark);

    expect(prey.stats.health.value).toBe(100 - W_DAMAGE);
    expect(has(prey, 'Root'), 'the prey was caught but not held').toBe(true);
  });

  /**
   * A pass that hits everything it crosses is a different ability. Pounce
   * catches one body and stops caring.
   */
  it('catches only the first, not everyone along the line', () => {
    const first = unit(game, 180, 'dire');
    const second = unit(game, 330, 'dire');
    indexObjects(game, [slark, first, second]);

    pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } });
    bound(slark);

    expect(first.stats.health.value).toBe(100 - W_DAMAGE);
    expect(second.stats.health.value, 'the pounce caught a second body').toBe(100);
  });

  it('hits the one it caught exactly once', () => {
    const prey = unit(game, 200, 'dire');
    indexObjects(game, [slark, prey]);

    pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } });
    bound(slark, 200);

    expect(prey.stats.health.value, 'it chewed on the same body every frame').toBe(
      100 - W_DAMAGE
    );
  });

  it('passes straight through his own team', () => {
    const friend = unit(game, 200, 'radiant');
    indexObjects(game, [slark, friend]);

    pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } });
    bound(slark);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Root')).toBe(false);
  });

  /**
   * Grounding is what `Dash.CanDash` exists to enforce, and the cast has to
   * fail *before* it charges him — a pounce that costs mana and goes nowhere is
   * the worst of both.
   */
  it('refuses to pounce while he is grounded, and costs nothing', () => {
    indexObjects(game, [slark]);
    slark.addBuff(new Ground(3_000, slark, slark));
    slark.updateBuffs();
    expect(slark.grounded, 'the fixture failed to ground him').toBe(true);

    expect(pressSpell(new Slark_W(slark), { at: { x: 400, y: 0 } })).toBe(false);
    expect(slark.stats.mana.value).toBe(100);
    expect(slark.position.x).toBe(0);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_W(slark);
    pressSpell(spell, { at: { x: 400, y: 0 } });

    expect(slark.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(W_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(W_DAMAGE).toBeLessThanOrEqual(35);
  });
});
