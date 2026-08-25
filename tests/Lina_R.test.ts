import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_R, { R_DAMAGE, R_RANGE } from '../spells/Lina_R';
import { indexObjects, unit } from './_units';

describe('Lina_R — Lôi Quang Kiếm', () => {
  let game: TestGame;
  let lina: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    lina = unit(game, 0, 'radiant');
    game.setPlayer(lina);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strikes an enemy within reach for the whole payload at once', () => {
    const victim = unit(game, R_RANGE - 60, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_R(lina);
    expect(pressSpell(spell, { target: victim })).toBe(true);

    // No travel, no tick: the number is on them the moment the key goes down.
    expect(victim.stats.health.value).toBe(100 - R_DAMAGE);
  });

  it('lands the bolt on the victim rather than near them', () => {
    const victim = unit(game, R_RANGE - 60, 'dire', 40);
    indexObjects(game, [lina, victim]);

    const spell = new Lina_R(lina);
    pressSpell(spell, { target: victim });

    expect(spell.live!.position.x).toBeCloseTo(victim.position.x, 5);
    expect(spell.live!.position.y).toBeCloseTo(victim.position.y, 5);
  });

  /**
   * The other half of importing `R_DAMAGE` into the assertion above: both
   * sides of that comparison move together, so it cannot notice a retune to
   * zero. `docs/VFX_STANDARD.md` puts an ultimate at 40-60 against a ~100
   * health pool.
   */
  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_DAMAGE).toBeLessThanOrEqual(60);
  });

  it('refuses an ally', () => {
    const friend = unit(game, R_RANGE - 60, 'radiant');
    indexObjects(game, [lina, friend]);

    const spell = new Lina_R(lina);
    expect(pressSpell(spell, { target: friend })).toBe(false);
    expect(friend.stats.health.value).toBe(100);
  });

  /**
   * The failure four shipped abilities in this engine have had. Without
   * `targetTeam: 'ENEMY'` the resolver defaults to `'ANY'`, which includes
   * `request.caster`, and a press over empty ground resolves *her* — so the
   * ultimate calls 55 damage down on the person who cast it.
   */
  it('refuses to call the bolt down on herself', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_R(lina);

    expect(pressSpell(spell, { target: lina })).toBe(false);
    expect(pressSpell(spell, { at: { x: 10, y: 10 } })).toBe(false);
    expect(lina.stats.health.value).toBe(100);
    expect(lina.stats.mana.value, 'it charged her for a cast it refused').toBe(100);
    expect(spell.live).toBeNull();
  });

  it('refuses an enemy standing out of reach', () => {
    const distant = unit(game, R_RANGE + 400, 'dire');
    indexObjects(game, [lina, distant]);

    const spell = new Lina_R(lina);
    expect(pressSpell(spell, { target: distant })).toBe(false);
    expect(distant.stats.health.value).toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, R_RANGE - 60, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_R(lina);
    expect(pressSpell(spell, { target: victim })).toBe(true);
    expect(lina.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast it cannot pay for', () => {
    const victim = unit(game, R_RANGE - 60, 'dire');
    indexObjects(game, [lina, victim]);
    lina.stats.mana.baseValue = 0;

    const spell = new Lina_R(lina);
    expect(pressSpell(spell, { target: victim })).toBe(false);
    expect(victim.stats.health.value).toBe(100);
  });
});
