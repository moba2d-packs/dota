import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_E, {
  E_ATTACK_SPEED_PCT,
  E_COOLDOWN_MS,
  E_DURATION_MS,
  E_MOVE_SPEED_PCT,
  type Lina_E_Object,
} from '../spells/Lina_E';
import { indexObjects, unit } from './_units';

/** A believable base swing rate to measure the bonus against — `Stats` starts a bare unit at 0. */
const BASE_ATTACK_SPEED = 0.7;

const advance = (flame: Lina_E_Object, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  flame.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Lina_E — Hồn Lửa', () => {
  let game: TestGame;
  let lina: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    lina = unit(game, 0, 'radiant');
    lina.stats.attackSpeed.baseValue = BASE_ATTACK_SPEED;
    game.setPlayer(lina);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes her faster on her feet', () => {
    indexObjects(game, [lina]);
    const before = lina.stats.speed.value;

    const spell = new Lina_E(lina);
    expect(pressSpell(spell, {})).toBe(true);

    expect(lina.stats.speed.value).toBeGreaterThan(before);
    expect(lina.stats.speed.value).toBeCloseTo(before * (1 + E_MOVE_SPEED_PCT), 5);
  });

  it('makes her swing faster', () => {
    indexObjects(game, [lina]);

    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    // The other half of the buff, and the half that is easiest to leave
    // unwired: `StatAmp` builds its modifier from `bonuses` in `onCreate`, so
    // assigning `bonuses` after `addBuff` compiles, runs, and does nothing.
    expect(lina.stats.attackSpeed.value).toBeGreaterThan(BASE_ATTACK_SPEED);
    expect(lina.stats.attackSpeed.value).toBeCloseTo(
      BASE_ATTACK_SPEED * (1 + E_ATTACK_SPEED_PCT),
      5
    );
  });

  it('gives both halves the same six seconds', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    // Two buffs, one duration constant. Two numbers that drift apart would
    // read to a player as the ability half wearing off.
    expect(lina.buffs.length).toBe(2);
    for (const lit of lina.buffs) expect(lit.duration).toBe(E_DURATION_MS);
  });

  /**
   * The other half of importing the tuning constants into the assertions
   * above: both sides of those comparisons move together, so none of them
   * could notice a retune to zero. E deals no damage, so the band is on what
   * it does give — a self-buff worth pressing, and one that ends.
   */
  it('is tuned as a window rather than a permanent stat line', () => {
    expect(E_MOVE_SPEED_PCT).toBeGreaterThanOrEqual(0.1);
    expect(E_MOVE_SPEED_PCT).toBeLessThanOrEqual(0.6);
    expect(E_ATTACK_SPEED_PCT).toBeGreaterThanOrEqual(0.1);
    expect(E_ATTACK_SPEED_PCT).toBeLessThanOrEqual(0.6);
    expect(E_DURATION_MS).toBeLessThan(E_COOLDOWN_MS);
  });

  it('leaves an ally standing next to her alone', () => {
    const friend = unit(game, 40, 'radiant');
    indexObjects(game, [lina, friend]);
    const before = friend.stats.speed.value;

    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    expect(friend.buffs.length).toBe(0);
    expect(friend.stats.speed.value).toBe(before);
  });

  it('leaves an enemy standing next to her alone', () => {
    const enemy = unit(game, 40, 'dire');
    indexObjects(game, [lina, enemy]);

    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    // It is a self-buff, not an aura and not a nova. Nobody else is touched
    // in either direction.
    expect(enemy.stats.health.value).toBe(100);
    expect(enemy.buffs.length).toBe(0);
  });

  it('lets the flame go out when it runs out', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    const flame = spell.live!;
    advance(flame, E_DURATION_MS - 100);
    expect(flame.toRemove).toBe(false);
    advance(flame, 200);
    expect(flame.toRemove).toBe(true);
  });

  it('lets the flame go out when she dies', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_E(lina);
    pressSpell(spell, {});

    const flame = spell.live!;
    lina.takeDamage(1_000, lina);
    advance(flame, 16);

    expect(lina.isDead, 'the setup did not actually kill her').toBe(true);
    expect(flame.toRemove, 'the flame is still burning on a corpse').toBe(true);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_E(lina);
    expect(pressSpell(spell, {})).toBe(true);

    expect(lina.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast it cannot pay for', () => {
    indexObjects(game, [lina]);
    lina.stats.mana.baseValue = 0;
    const spell = new Lina_E(lina);
    expect(pressSpell(spell, {})).toBe(false);
    expect(lina.buffs.length).toBe(0);
  });
});
