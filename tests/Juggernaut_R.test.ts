import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Juggernaut_R, {
  R_BLINK_OFFSET_PX,
  R_DAMAGE_PER_STRIKE,
  R_DURATION_MS,
  R_MANA,
  R_RANGE,
  R_STRIKES,
  R_STRIKE_INTERVAL_MS,
  R_STRIKE_RADIUS,
  R_TOTAL_DAMAGE,
} from '../spells/Juggernaut_R';
import { indexObjects, unit } from './_units';

/** One frame through the spell's runtime, which is where the strike clock lives. */
const advance = (spell: Juggernaut_R, ms: number): void => {
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

const wearing = (body: AttackableUnit, name: string): boolean =>
  body.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

describe('Juggernaut_R — Đao Vô Song', () => {
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

  it('lands beside the enemy he named and cuts them', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_R(jugg);
    expect(pressSpell(spell, { target: victim })).toBe(true);

    expect(victim.stats.health.value).toBe(100 - R_DAMAGE_PER_STRIKE);
    // Beside them, not on them: `R_BLINK_OFFSET_PX` is the whole difference
    // between an ultimate that reads as a duel and one that reads as a merge.
    expect(jugg.position.dist(victim.position)).toBeCloseTo(R_BLINK_OFFSET_PX, 5);
  });

  it('cuts exactly once per strike, and exactly four times in all', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });
    // The first cut is the press itself.
    expect(spell.strikesLanded).toBe(1);
    expect(victim.stats.health.value).toBe(100 - R_DAMAGE_PER_STRIKE);

    // One interval, one more cut — never two, which is what a strike that
    // hit the same body twice would look like from here.
    advance(spell, R_STRIKE_INTERVAL_MS);
    expect(spell.strikesLanded).toBe(2);
    expect(victim.stats.health.value).toBe(100 - R_DAMAGE_PER_STRIKE * 2);

    advance(spell, R_STRIKE_INTERVAL_MS);
    advance(spell, R_STRIKE_INTERVAL_MS);
    expect(spell.strikesLanded).toBe(R_STRIKES);
    expect(victim.stats.health.value).toBe(100 - R_TOTAL_DAMAGE);

    // Well past the window: nothing may still be swinging.
    for (let i = 0; i < 4; i++) advance(spell, R_STRIKE_INTERVAL_MS);
    expect(spell.strikesLanded).toBe(R_STRIKES);
    expect(victim.stats.health.value).toBe(100 - R_TOTAL_DAMAGE);
  });

  it('never picks an ally standing right beside the enemy', () => {
    const victim = unit(game, 100, 'dire');
    const friend = unit(game, 110, 'radiant');
    indexObjects(game, [jugg, victim, friend]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });
    for (let i = 0; i < R_STRIKES; i++) advance(spell, R_STRIKE_INTERVAL_MS);

    expect(friend.stats.health.value).toBe(100);
    expect(victim.stats.health.value).toBe(100 - R_TOTAL_DAMAGE);
  });

  it('leaves an enemy standing outside its strike radius alone', () => {
    const victim = unit(game, 100, 'dire');
    // Comfortably past `R_STRIKE_RADIUS` from anywhere the four blinks put
    // him, all of which are within `R_BLINK_OFFSET_PX` of the first victim.
    const distant = unit(game, 100 + R_STRIKE_RADIUS + R_BLINK_OFFSET_PX + 80, 'dire');
    indexObjects(game, [jugg, victim, distant]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });
    for (let i = 0; i < R_STRIKES; i++) advance(spell, R_STRIKE_INTERVAL_MS);

    expect(distant.stats.health.value).toBe(100);
  });

  it('refuses an ally', () => {
    const friend = unit(game, 100, 'radiant');
    indexObjects(game, [jugg, friend]);

    const spell = new Juggernaut_R(jugg);
    expect(pressSpell(spell, { target: friend })).toBe(false);
    expect(friend.stats.health.value).toBe(100);
  });

  /**
   * The failure four shipped abilities in this engine have had. Without
   * `targetTeam: 'ENEMY'` the resolver defaults to `'ANY'`, which includes
   * `request.caster` — and a press over empty ground resolves *him*, so the
   * ultimate blinks him beside himself and cuts him four times.
   */
  it('refuses to cut itself', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_R(jugg);

    expect(pressSpell(spell, { target: jugg })).toBe(false);
    expect(pressSpell(spell, { at: { x: 40, y: 40 } })).toBe(false);
    expect(jugg.stats.health.value, 'he cut himself').toBe(100);
    expect(jugg.stats.mana.value, 'it charged him for a cast it refused').toBe(100);
    expect(wearing(jugg, 'Untargetable')).toBe(false);
  });

  it('refuses an enemy standing out of reach', () => {
    const distant = unit(game, R_RANGE + 400, 'dire');
    indexObjects(game, [jugg, distant]);

    const spell = new Juggernaut_R(jugg);
    expect(pressSpell(spell, { target: distant })).toBe(false);
    expect(distant.stats.health.value).toBe(100);
  });

  it('cannot be touched for the whole window, and can be again the moment it ends', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });
    // `targetable` is recomputed from the status flags on the unit's own
    // update, so the buff is not visible in that flag until a frame passes.
    settle(jugg);
    expect(wearing(jugg, 'Untargetable')).toBe(true);
    expect(jugg.targetable).toBe(false);

    advance(spell, R_DURATION_MS);
    settle(jugg);
    expect(wearing(jugg, 'Untargetable'), 'he is permanently unclickable').toBe(false);
    expect(jugg.targetable).toBe(true);
    expect(spell.slashes, 'the cuts outlived the window').toBeNull();
  });

  it('never leaves him untargetable when the sequence ends early', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });
    // The scene going away mid-ultimate — the shortest path out there is.
    spell.deactivate();
    settle(jugg);

    expect(wearing(jugg, 'Untargetable')).toBe(false);
    expect(jugg.targetable).toBe(true);
    expect(spell.slashes).toBeNull();
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_R(jugg);
    pressSpell(spell, { target: victim });

    expect(jugg.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    const victim = unit(game, 100, 'dire');
    indexObjects(game, [jugg, victim]);
    jugg.stats.mana.baseValue = R_MANA - 1;

    const spell = new Juggernaut_R(jugg);
    expect(pressSpell(spell, { target: victim })).toBe(false);
    expect(victim.stats.health.value, 'a refused cast still cut somebody').toBe(100);
    expect(spell.slashes).toBeNull();
  });

  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_TOTAL_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_TOTAL_DAMAGE).toBeLessThanOrEqual(60);
  });
});
