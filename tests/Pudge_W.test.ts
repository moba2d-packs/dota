import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Pudge_W, {
  W_DAMAGE_PER_TICK,
  W_SELF_FLOOR_HP,
  W_SELF_PER_TICK,
  W_TICK_MS,
} from '../spells/Pudge_W';
import { indexObjects, unit } from './_units';

/**
 * Boundary probes are **absolute distances, written out**, never
 * `RADIUS + n`.
 *
 * A probe placed at `W_RADIUS + 60` slides along with the constant it is
 * meant to be checking, so widening the radius to 900 moves the probe to 960
 * and the test stays green — it proves the code agrees with itself, which it
 * always will. This pack's Crystal Maiden suite was written the first way,
 * and a mutation run widening three radii failed nothing at all. The numbers
 * below bracket the real edge from both sides and have to be re-read by a
 * human if the tuning moves, which is the point.
 */

/** One tick of match time, through the spell's own update path. */
const advance = (spell: Pudge_W, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Pudge_W — Rữa Nát', () => {
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

  it('hurts an enemy standing in it, once per tick', () => {
    // Inside the 145 rim, and stated as 120 rather than as `W_RADIUS - 20`.
    const victim = unit(game, 120, 'dire');
    indexObjects(game, [pudge, victim]);

    const spell = new Pudge_W(pudge);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(true);

    advance(spell, W_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - W_DAMAGE_PER_TICK);
    advance(spell, W_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - W_DAMAGE_PER_TICK * 2);
  });

  it('slows what it damages', () => {
    const victim = unit(game, 120, 'dire');
    indexObjects(game, [pudge, victim]);
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, W_TICK_MS);

    expect(victim.buffs.some(buff => buff.constructor.name === 'Slow')).toBe(true);
  });

  it('leaves an enemy standing outside the ring alone', () => {
    // Just past the 145 rim the effect draws, at a distance written out so it
    // cannot follow the constant if someone retunes it.
    const distant = unit(game, 210, 'dire');
    indexObjects(game, [pudge, distant]);
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, W_TICK_MS * 3);

    expect(distant.stats.health.value).toBe(100);
  });

  it('leaves an ally alone', () => {
    const friend = unit(game, 40, 'radiant');
    indexObjects(game, [pudge, friend]);
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, W_TICK_MS * 3);

    expect(friend.stats.health.value).toBe(100);
  });

  it('costs him health, not mana', () => {
    indexObjects(game, [pudge]);
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    const manaAfterPress = pudge.stats.mana.value;

    advance(spell, W_TICK_MS * 2);

    expect(pudge.stats.health.value).toBe(100 - W_SELF_PER_TICK * 2);
    expect(pudge.stats.mana.value).toBe(manaAfterPress);
  });

  it('never drains him to death', () => {
    indexObjects(game, [pudge]);
    pudge.stats.health.baseValue = W_SELF_FLOOR_HP + 1;
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    advance(spell, W_TICK_MS * 20);

    expect(pudge.stats.health.value).toBe(W_SELF_FLOOR_HP);
    expect(pudge.isDead).toBe(false);
  });

  it('stops when he presses it again', () => {
    const victim = unit(game, 120, 'dire');
    indexObjects(game, [pudge, victim]);
    const spell = new Pudge_W(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, W_TICK_MS);
    const afterOneTick = victim.stats.health.value;

    // The toggle-off is the same press, which is the whole point of `TOGGLE`.
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, W_TICK_MS * 4);

    expect(victim.stats.health.value).toBe(afterOneTick);
    expect(spell.cloud, 'the cloud object outlived the toggle').toBeNull();
  });
});
