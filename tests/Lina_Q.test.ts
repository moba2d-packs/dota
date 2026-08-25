import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_Q, { Q_DAMAGE, Q_HIT_WIDTH, Q_RANGE } from '../spells/Lina_Q';
import { indexObjects, unit } from './_units';

/**
 * The script, as test names. Everything goes through `pressSpell`, never a
 * lifecycle hook: a hook-calling test cannot see activation, cooldown, cost or
 * targeting rejection and stays green against an ability that does not work.
 */
describe('Lina_Q — Thiêu Rồng', () => {
  let game: TestGame;
  let lina: AttackableUnit;

  /** Runs the wave to the end of its flight, the way the object manager would. */
  const sweep = (wave: { update(): void; toRemove: boolean }, frames = 200): void => {
    for (let i = 0; i < frames && !wave.toRemove; i++) wave.update();
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    lina = unit(game, 0, 'radiant');
    game.setPlayer(lina);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('burns every enemy standing in the line', () => {
    const front = unit(game, 180, 'dire');
    const behind = unit(game, 340, 'dire');
    indexObjects(game, [lina, front, behind]);

    const spell = new Lina_Q(lina);
    expect(pressSpell(spell, { at: { x: Q_RANGE, y: 0 } })).toBe(true);
    sweep(spell.live!);

    // The second one is the whole ability: a wave that stopped at the first
    // body is a bolt, and one line — `maxHitCount = 1` — is all it takes.
    expect(front.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(behind.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('burns the same enemy only once, however long it stands in the crest', () => {
    // At 13px a frame against a ~32px catch radius the wave overlaps this body
    // for four or five consecutive frames. A missile that did not remember who
    // it had already hit would charge for every one of them.
    const victim = unit(game, 220, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_Q(lina);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });
    sweep(spell.live!);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  /**
   * The assertions above import `Q_DAMAGE`, which is the house rule — a retune
   * must not mean editing a test — and which therefore cannot notice a retune
   * to zero: both sides of the comparison move together. This is the other
   * half of that bargain. `docs/VFX_STANDARD.md` scales this whole game to a
   * ~100 health pool and puts a normal ability at 15-35.
   */
  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
  });

  it('leaves an ally standing in the line alone', () => {
    const friend = unit(game, 220, 'radiant');
    indexObjects(game, [lina, friend]);

    const spell = new Lina_Q(lina);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });
    sweep(spell.live!);

    expect(friend.stats.health.value).toBe(100);
  });

  it('misses an enemy standing beside the line rather than in it', () => {
    // Well outside the crest's half-width plus a body: the wave is 55 wide and
    // this one is 95 off the axis.
    const aside = unit(game, 220, 'dire', Q_HIT_WIDTH + 40);
    indexObjects(game, [lina, aside]);

    const spell = new Lina_Q(lina);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });
    sweep(spell.live!);

    expect(aside.stats.health.value).toBe(100);
  });

  it('never reaches past its own range', () => {
    const distant = unit(game, Q_RANGE + 150, 'dire');
    indexObjects(game, [lina, distant]);

    // Aimed at four times the range: a DIRECTION cast picks the direction and
    // the spell owns the distance, so aiming further must not throw further.
    const spell = new Lina_Q(lina);
    pressSpell(spell, { at: { x: Q_RANGE * 4, y: 0 } });
    sweep(spell.live!);

    // Compared against the range constant, not against anything the spell
    // computed: a check that asks the code under test what it meant agrees
    // with it however wrong it is.
    expect(spell.live!.destination.x).toBeCloseTo(Q_RANGE, 1);
    expect(distant.stats.health.value).toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_Q(lina);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);

    expect(lina.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast it cannot pay for', () => {
    indexObjects(game, [lina]);
    lina.stats.mana.baseValue = 0;
    const spell = new Lina_Q(lina);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(false);
    expect(spell.live).toBeNull();
  });
});
