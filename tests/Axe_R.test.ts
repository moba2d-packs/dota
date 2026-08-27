import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Axe_R, { Axe_R_Object, R_DAMAGE, R_MANA, R_THRESHOLD } from '../spells/Axe_R';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('Axe_R — Lưỡi Hái Tử Thần', () => {
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

  it('takes the head off anyone already under the line', () => {
    const doomed = unit(game, 120, 'dire');
    doomed.stats.health.baseValue = R_THRESHOLD - 5;
    indexObjects(game, [axe, doomed]);

    expect(pressSpell(new Axe_R(axe), {})).toBe(true);
    expect(doomed.isDead, 'it left someone standing who was under the line').toBe(true);
  });

  it('is an ordinary heavy blow against anyone above it', () => {
    const healthy = unit(game, 120, 'dire');
    indexObjects(game, [axe, healthy]);

    expect(pressSpell(new Axe_R(axe), {})).toBe(true);
    expect(healthy.stats.health.value).toBe(100 - R_DAMAGE);
    expect(healthy.isDead).toBe(false);
  });

  /**
   * The whole reason this ability goes through core's `ExecuteTargeting` seam
   * rather than picking the nearest body: with no unit-targeted click, "nearest"
   * is exactly the enemy you did not mean when a different one is one blow from
   * dead.
   */
  it('picks the one that dies over the one that is closer', () => {
    const nearAndHealthy = unit(game, 80, 'dire');
    const fartherButDoomed = unit(game, 180, 'dire');
    fartherButDoomed.stats.health.baseValue = R_THRESHOLD - 5;
    indexObjects(game, [axe, nearAndHealthy, fartherButDoomed]);

    pressSpell(new Axe_R(axe), {});

    expect(fartherButDoomed.isDead, 'it swung at the near one instead').toBe(true);
    expect(nearAndHealthy.stats.health.value, 'it hit both').toBe(100);
  });

  it('agrees with the mark it paints — the estimate is the blow', () => {
    const doomed = unit(game, 120, 'dire');
    doomed.stats.health.baseValue = R_THRESHOLD - 5;
    const healthy = unit(game, 150, 'dire');
    indexObjects(game, [axe, doomed, healthy]);

    const spell = new Axe_R(axe);
    // What the on-screen "this one dies" ring reads.
    expect(spell.executeDamageAgainst(doomed)).toBeGreaterThanOrEqual(
      doomed.stats.health.value
    );
    expect(spell.executeDamageAgainst(healthy)).toBe(R_DAMAGE);
    expect(spell.executeCandidates()).toContain(doomed);
  });

  it('pays him in speed for the kill, and only for the kill', () => {
    const healthy = unit(game, 120, 'dire');
    indexObjects(game, [axe, healthy]);
    pressSpell(new Axe_R(axe), {});
    expect(has(axe, 'Speedup'), 'he was paid for a blow that killed nobody').toBe(false);

    const doomed = unit(game, 130, 'dire');
    doomed.stats.health.baseValue = R_THRESHOLD - 5;
    indexObjects(game, [axe, healthy, doomed]);
    pressSpell(new Axe_R(axe), {});
    expect(doomed.isDead).toBe(true);
    expect(has(axe, 'Speedup'), 'the kill paid him nothing').toBe(true);
  });

  it('leaves his own team alone', () => {
    const friend = unit(game, 120, 'radiant');
    friend.stats.health.baseValue = R_THRESHOLD - 5;
    indexObjects(game, [axe, friend]);

    expect(pressSpell(new Axe_R(axe), {}), 'it swung with only an ally in reach').toBe(false);
    expect(friend.isDead).toBe(false);
    expect(friend.stats.health.value).toBe(R_THRESHOLD - 5);
  });

  /**
   * Hand-written distances rather than `R_RANGE ± n`. 180 is inside a 220
   * reach; 300 is not.
   */
  it('reaches exactly as far as it says it does', () => {
    const distant = unit(game, 300, 'dire');
    distant.stats.health.baseValue = R_THRESHOLD - 5;
    indexObjects(game, [axe, distant]);

    expect(pressSpell(new Axe_R(axe), {}), 'it reached past its own range').toBe(false);
    expect(distant.isDead).toBe(false);

    const near = unit(game, 180, 'dire');
    indexObjects(game, [axe, distant, near]);
    expect(pressSpell(new Axe_R(axe), {})).toBe(true);
    expect(near.stats.health.value).toBe(100 - R_DAMAGE);
  });

  it('refuses to swing at nobody', () => {
    indexObjects(game, [axe]);
    const spell = new Axe_R(axe);
    expect(pressSpell(spell, {})).toBe(false);
    expect(axe.stats.mana.value, 'it charged him for a swing at empty air').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const healthy = unit(game, 120, 'dire');
    indexObjects(game, [axe, healthy]);

    const spell = new Axe_R(axe);
    pressSpell(spell, {});

    expect(axe.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band an ultimate belongs in', () => {
    expect(R_DAMAGE).toBeGreaterThanOrEqual(40);
    expect(R_DAMAGE).toBeLessThanOrEqual(60);
    // The line has to sit under what an ordinary blow already does, or the
    // execute is just the same ability with extra words.
    expect(R_THRESHOLD).toBeLessThan(R_DAMAGE);
  });

  /**
   * The same defect `VengefulSpirit_E` froze a match with: `payTheTeam` filtered
   * on team alone, and every `SpellObject` carries its owner's `teamId` — so a
   * swing still on the field from an earlier kill came back as an "ally" and was
   * handed a `Speedup` through an `addBuff` it does not have. The throw escapes
   * `onSpellCast`, and from a real match that means out of `game.update()`,
   * which is where `GameScene.updateLoop` stops re-arming its own tick.
   */
  it('does not pay a spell object left on the field by an earlier kill', () => {
    const doomed = unit(game, 130, 'dire');
    doomed.stats.health.baseValue = R_THRESHOLD - 5;
    const leftover = new Axe_R_Object(axe);
    indexObjects(game, [axe, doomed, leftover]);

    expect(
      () => pressSpell(new Axe_R(axe), {}),
      'a friendly spell object in range threw'
    ).not.toThrow();
    expect(doomed.isDead).toBe(true);
    expect(has(axe, 'Speedup'), 'the kill still has to pay him').toBe(true);
  });
});
