import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Pudge_R, {
  R_DAMAGE_PER_TICK,
  R_HEAL_PER_TICK,
  R_TICK_MS,
  R_TICKS,
  R_TOTAL_DAMAGE,
} from '../spells/Pudge_R';
import { indexObjects, unit } from './_units';

const advance = (spell: Pudge_R, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('Pudge_R — Xẻ Thịt', () => {
  let game: TestGame;
  let pudge: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    pudge = unit(game, 0, 'radiant');
    game.setPlayer(pudge);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes hold of an enemy within reach', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [pudge, victim]);

    const spell = new Pudge_R(pudge);
    expect(pressSpell(spell, { target: victim })).toBe(true);
    expect(has(victim, 'Root'), 'the victim can still walk away').toBe(true);
    expect(has(victim, 'Silence'), 'the victim can still cast').toBe(true);
  });

  it('drains the victim and feeds him, tick by tick', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [pudge, victim]);
    pudge.stats.health.baseValue = 50;

    const spell = new Pudge_R(pudge);
    pressSpell(spell, { target: victim });
    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);

    expect(victim.stats.health.value).toBe(100 - R_TOTAL_DAMAGE);
    expect(pudge.stats.health.value).toBe(50 + R_HEAL_PER_TICK * R_TICKS);
  });

  it('heals him for less than it deals', () => {
    // The ability is a trade, not a reset — an ultimate that returns its own
    // damage as health has no cost to being wrong about when to press it.
    expect(R_HEAL_PER_TICK).toBeLessThan(R_DAMAGE_PER_TICK);
  });

  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_TOTAL_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_TOTAL_DAMAGE).toBeLessThanOrEqual(60);
  });

  it('refuses an ally', () => {
    const friend = unit(game, 150, 'radiant');
    indexObjects(game, [pudge, friend]);

    const spell = new Pudge_R(pudge);
    expect(pressSpell(spell, { target: friend })).toBe(false);
    expect(has(friend, 'Root')).toBe(false);
  });

  /**
   * The failure four shipped abilities in this engine have had. Without
   * `targetTeam: 'ENEMY'` the resolver defaults to `'ANY'`, which includes
   * `request.caster`, and a press over empty ground resolves *him* — so the
   * ultimate roots, silences and drains the person who cast it.
   *
   * Measured, because the obvious reading of the two guards is wrong. They
   * cover **two different paths**, not one path twice:
   *
   *   - `isValidTarget` inside `press()` stops the direct-context case
   *     (`{ target: caster }`), where `TargetResolver` never runs at all;
   *   - `targetTeam: 'ENEMY'` stops the resolver case (a press over empty
   *     ground), where `press()` hands the context on and the
   *     nearest-to-cursor fallback is free to answer with the caster.
   *
   * And inside `isValidTarget` the load-bearing clause is the *team* one: a
   * caster always shares her own team id, so `target !== this.owner` is real
   * defence in depth and deleting it alone changes nothing here. Deleting the
   * team clause does. A reader tidying away the "redundant" line should know
   * which line is actually redundant — this pack's Lina R found the same
   * thing independently.
   */
  it('refuses to grab itself', () => {
    indexObjects(game, [pudge]);
    const spell = new Pudge_R(pudge);

    expect(pressSpell(spell, { target: pudge })).toBe(false);
    expect(pressSpell(spell, { at: { x: 10, y: 10 } })).toBe(false);
    expect(has(pudge, 'Root')).toBe(false);
    expect(pudge.stats.mana.value, 'it charged him for a cast it refused').toBe(100);
  });

  it('refuses an enemy standing out of reach', () => {
    // 400, written out. The reach is 190; a probe at `R_RANGE + 400` moves
    // with it and stays out of range however far the ability is widened.
    const distant = unit(game, 400, 'dire');
    indexObjects(game, [pudge, distant]);

    const spell = new Pudge_R(pudge);
    expect(pressSpell(spell, { target: distant })).toBe(false);
  });

  it('opens the grip when the victim dies', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [pudge, victim]);
    victim.stats.health.baseValue = R_DAMAGE_PER_TICK;

    const spell = new Pudge_R(pudge);
    pressSpell(spell, { target: victim });
    advance(spell, R_TICK_MS);
    advance(spell, R_TICK_MS);

    expect(victim.isDead).toBe(true);
    expect(spell.grip, 'the grip is still drawn on a corpse').toBeNull();
  });

  it('charges its mana and starts its cooldown once', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [pudge, victim]);
    const spell = new Pudge_R(pudge);
    pressSpell(spell, { target: victim });

    expect(pudge.stats.mana.value).toBe(100 - spell.manaCost);
  });
});
