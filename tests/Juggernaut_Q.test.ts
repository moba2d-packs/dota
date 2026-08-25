import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Juggernaut_Q, {
  Q_DAMAGE_PER_TICK,
  Q_DURATION_MS,
  Q_MANA,
  Q_MAX_TOTAL_DAMAGE,
  Q_RADIUS,
  Q_TICKS,
  Q_TICK_MS,
  type Juggernaut_Q_Object,
} from '../spells/Juggernaut_Q';
import { indexObjects, unit } from './_units';

/** One frame of match time through the blades' own clock, which is where the ticking lives. */
const spinFor = (spin: Juggernaut_Q_Object, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spin.update();
  vi.stubGlobal('deltaTime', 16);
};

/** One frame through the spell's runtime, which is what ends the activation. */
const advance = (spell: Juggernaut_Q, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

/** One frame through a body, which is what applies and expires its buffs. */
const settle = (body: AttackableUnit, ms = 16): void => {
  vi.stubGlobal('deltaTime', ms);
  body.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Juggernaut_Q — Cuồng Đao', () => {
  let game: TestGame;
  let jugg: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    jugg = unit(game, 0, 'radiant');
    game.setPlayer(jugg);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cuts an enemy standing in the blades, once per tick', () => {
    const victim = unit(game, Q_RADIUS - 20, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_Q(jugg);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(true);
    const spin = spell.spin;
    expect(spin, 'the spin never opened').not.toBeNull();

    // The first tick lands the moment the blades open — see the file header's
    // arithmetic, which is what makes eight of them fit in three seconds.
    spinFor(spin!, Q_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE_PER_TICK);
    spinFor(spin!, Q_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE_PER_TICK * 2);
  });

  it('leaves an ally standing in the blades alone', () => {
    const friend = unit(game, 40, 'radiant');
    indexObjects(game, [jugg, friend]);

    const spell = new Juggernaut_Q(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    for (let i = 0; i < 4; i++) spinFor(spell.spin!, Q_TICK_MS);

    expect(friend.stats.health.value).toBe(100);
  });

  it('leaves an enemy standing outside the rim alone', () => {
    // Just past the ring the effect draws. A body the player can see outside
    // that ring must not be taking damage from it.
    const distant = unit(game, Q_RADIUS + 60, 'dire');
    indexObjects(game, [jugg, distant]);

    const spell = new Juggernaut_Q(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    for (let i = 0; i < 4; i++) spinFor(spell.spin!, Q_TICK_MS);

    expect(distant.stats.health.value).toBe(100);
  });

  it('takes his sword off him while he spins, and gives it back after', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_Q(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    // `canAttack` is recomputed from the status flags on the unit's own update,
    // so the disarm is not visible in that flag until a frame has passed.
    settle(jugg);
    expect(jugg.canAttack, 'he can still swing while spinning').toBe(false);

    // The runtime's own `active.maxDurationMs` is what ends the activation.
    advance(spell, Q_DURATION_MS);
    settle(jugg);
    expect(jugg.canAttack, 'the disarm outlived the spin').toBe(true);
  });

  it('stops on time, having landed exactly its stated number of ticks', () => {
    const victim = unit(game, Q_RADIUS - 20, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_Q(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    const spin = spell.spin!;

    // Well past the three seconds: whatever is still driving it has to have
    // stopped on its own.
    for (let i = 0; i < Q_TICKS + 6; i++) spinFor(spin, Q_TICK_MS);

    expect(victim.stats.health.value).toBe(100 - Q_MAX_TOTAL_DAMAGE);
    expect(spin.toRemove, 'the blades are still in the world').toBe(true);

    // And the spell's own teardown ran when the runtime closed the window.
    advance(spell, Q_DURATION_MS);
    expect(spell.spin, 'the spin object outlived the activation').toBeNull();
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_Q(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(jugg.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    indexObjects(game, [jugg]);
    jugg.stats.mana.baseValue = Q_MANA - 1;

    const spell = new Juggernaut_Q(jugg);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(false);
    expect(spell.spin, 'a refused cast still opened the blades').toBeNull();
    expect(jugg.stats.mana.value, 'it charged him for a cast it refused').toBe(Q_MANA - 1);
  });

  /**
   * Deliberately not `<= 35`. `docs/VFX_STANDARD.md`'s 15-35 is the *burst*
   * band — damage that lands whether the victim reacts or not — and this
   * ability's total is eight separate 400ms windows in each of which the
   * victim could have walked 150px and taken nothing. The number the band is
   * really about here is the instantaneous one, which is asserted beside it.
   * The floor is what stops a retune to zero going unnoticed.
   */
  it('is tuned for a spin you can walk out of, not for a burst', () => {
    expect(Q_MAX_TOTAL_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_MAX_TOTAL_DAMAGE).toBeLessThanOrEqual(60);
    expect(Q_DAMAGE_PER_TICK).toBeGreaterThan(0);
    expect(Q_DAMAGE_PER_TICK, 'one tick is a burst, not a tick').toBeLessThanOrEqual(15);
  });
});
