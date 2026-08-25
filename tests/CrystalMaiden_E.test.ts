import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import CrystalMaiden_E, {
  E_DURATION_MS,
  E_MANA,
  E_MANA_PER_TICK,
  E_TICK_MS,
  E_TICKS,
  E_TOTAL_PER_ALLY,
} from '../spells/CrystalMaiden_E';
import { indexObjects, unit } from './_units';

/**
 * One slice of match time.
 *
 * Both clocks are driven: the spell's own (the runtime's cooldown) and the
 * field's, which is where the pulses live. The field is skipped once it has
 * flagged itself for removal, exactly as `ObjectManager.update` skips it.
 */
const advance = (spell: CrystalMaiden_E, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  if (spell.aura && !spell.aura.toRemove) spell.aura.update();
  vi.stubGlobal('deltaTime', 16);
};

/** A body that has somewhere to put the mana this ability hands out. */
const thirsty = (target: AttackableUnit): AttackableUnit => {
  target.stats.mana.baseValue = 50;
  return target;
};

describe('CrystalMaiden_E — Hào Quang Pháp Thuật', () => {
  let game: TestGame;
  let maiden: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    maiden = unit(game, 0, 'radiant');
    game.setPlayer(maiden);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('feeds an ally standing in it', () => {
    const friend = thirsty(unit(game, 200, 'radiant'));
    indexObjects(game, [maiden, friend]);

    const spell = new CrystalMaiden_E(maiden);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(true);

    // Nothing until the first pulse is due.
    advance(spell, E_TICK_MS - 50);
    expect(friend.stats.mana.value).toBe(50);

    advance(spell, 50);
    expect(friend.stats.mana.value).toBe(50 + E_MANA_PER_TICK);
    advance(spell, E_TICK_MS);
    expect(friend.stats.mana.value).toBe(50 + E_MANA_PER_TICK * 2);
  });

  it('feeds her too, and gives back more than the cast cost', () => {
    // The whole point of a support aura: it is behind at the moment of the
    // press and ahead by the end of its own duration.
    indexObjects(game, [maiden]);
    maiden.stats.mana.baseValue = 50;

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    expect(maiden.stats.mana.value).toBe(50 - E_MANA);

    for (let i = 0; i < E_TICKS; i++) advance(spell, E_TICK_MS);

    expect(maiden.stats.mana.value).toBe(50 - E_MANA + E_TOTAL_PER_ALLY);
    expect(E_TOTAL_PER_ALLY).toBeGreaterThan(E_MANA);
  });

  it('gives an enemy standing in it nothing', () => {
    const foe = thirsty(unit(game, 200, 'dire'));
    indexObjects(game, [maiden, foe]);

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    for (let i = 0; i < 4; i++) advance(spell, E_TICK_MS);

    expect(foe.stats.mana.value).toBe(50);
    expect(foe.stats.health.value, 'the aura is not supposed to touch anybody').toBe(100);
  });

  it('stops feeding where it draws its outermost ring', () => {
    // Distances written out by hand rather than as `E_RADIUS ± n`. A test that
    // derives its own geometry from the constant it is checking slides along
    // with a retune and stops testing the boundary at all: widening the field
    // to 2000 left the earlier version of this case green. 380 is inside a 400
    // radius; 480 is not.
    const onTheEdge = thirsty(unit(game, 380, 'radiant'));
    const distant = thirsty(unit(game, 480, 'radiant'));
    indexObjects(game, [maiden, onTheEdge, distant]);

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    for (let i = 0; i < 4; i++) advance(spell, E_TICK_MS);

    expect(onTheEdge.stats.mana.value, 'an ally inside the ring was skipped').toBe(
      50 + E_MANA_PER_TICK * 4
    );
    expect(distant.stats.mana.value, 'an ally outside the ring was fed').toBe(50);
  });

  it('runs out after its own duration', () => {
    const friend = thirsty(unit(game, 200, 'radiant'));
    indexObjects(game, [maiden, friend]);

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    for (let i = 0; i < E_TICKS; i++) advance(spell, E_TICK_MS);
    const fedForTheWholeCast = friend.stats.mana.value;

    expect(fedForTheWholeCast).toBe(50 + E_TOTAL_PER_ALLY);
    expect(spell.aura?.toRemove, 'the field outlived its own duration').toBe(true);

    advance(spell, E_DURATION_MS);
    expect(friend.stats.mana.value).toBe(fedForTheWholeCast);
  });

  it('goes with her when she dies', () => {
    const friend = thirsty(unit(game, 200, 'radiant'));
    const killer = unit(game, 260, 'dire');
    indexObjects(game, [maiden, friend, killer]);

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    advance(spell, E_TICK_MS);
    const fedWhileSheLived = friend.stats.mana.value;

    maiden.takeDamage(999, killer);
    expect(maiden.isDead).toBe(true);

    advance(spell, E_TICK_MS);
    expect(spell.aura?.toRemove, 'the field is still running over her corpse').toBe(true);
    expect(friend.stats.mana.value).toBe(fedWhileSheLived);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [maiden]);

    const spell = new CrystalMaiden_E(maiden);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(maiden.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } }), 'it cast again while on cooldown').toBe(
      false
    );
  });

  it('refuses a cast she cannot pay for', () => {
    const friend = thirsty(unit(game, 200, 'radiant'));
    indexObjects(game, [maiden, friend]);
    maiden.stats.mana.baseValue = E_MANA - 1;

    const spell = new CrystalMaiden_E(maiden);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(false);
    expect(spell.aura).toBeNull();

    advance(spell, E_TICK_MS * 4);
    expect(friend.stats.mana.value).toBe(50);
  });

  it('is tuned as a support aura rather than a damage ability', () => {
    // There is no damage band to sit inside — it deals none. What it has to
    // clear instead is its own price, or the slot is a button nobody presses.
    expect(E_TICKS).toBe(E_DURATION_MS / E_TICK_MS);
    expect(E_TOTAL_PER_ALLY).toBe(E_TICKS * E_MANA_PER_TICK);
    expect(E_TOTAL_PER_ALLY).toBeGreaterThan(E_MANA);
  });
});
