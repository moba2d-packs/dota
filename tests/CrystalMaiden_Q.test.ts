import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import CrystalMaiden_Q, {
  CrystalMaiden_Q_Frost,
  Q_DAMAGE,
  Q_MANA,
  Q_RANGE,
  Q_SLOW,
  Q_SLOW_MS,
} from '../spells/CrystalMaiden_Q';
import { indexObjects, unit } from './_units';

/** Where every cast in this file is aimed unless it is testing the clamp. */
const AIM = { x: 300, y: 0 };

/** The `Slow` on `target`, if it took one. Narrowed by hand: `buffs` is `Buff[]`. */
const slowOn = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Slow') as unknown as
    | { percent: number; duration: number }
    | undefined;

describe('CrystalMaiden_Q — Tân Tinh', () => {
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

  it('cuts every enemy standing in the blast', () => {
    const victim = unit(game, AIM.x, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_Q(maiden);
    expect(pressSpell(spell, { at: AIM })).toBe(true);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('hits each body once, however long the animation runs', () => {
    // The damage is resolved by one query at the moment of the cast, so time
    // passing must not deal it again — a burst that ticked would punish a
    // champion for walking through its own picture.
    const victim = unit(game, AIM.x, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });
    for (let i = 0; i < 6; i++) {
      vi.stubGlobal('deltaTime', 200);
      spell.update();
    }
    vi.stubGlobal('deltaTime', 16);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('leaves what it cut crawling', () => {
    const victim = unit(game, AIM.x, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });

    const chilled = slowOn(victim);
    expect(chilled, 'the blast dealt its damage and nothing else').toBeDefined();
    expect(chilled?.percent).toBe(Q_SLOW);
    expect(chilled?.duration).toBe(Q_SLOW_MS);
  });

  it('leaves an ally standing in it alone', () => {
    const friend = unit(game, AIM.x, 'radiant');
    indexObjects(game, [maiden, friend]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });

    expect(friend.stats.health.value).toBe(100);
    expect(slowOn(friend)).toBeUndefined();
  });

  it('stops its damage where it draws its rim', () => {
    // Distances written out by hand rather than as `Q_RADIUS ± n`. A test that
    // derives its own geometry from the constant it is checking slides along
    // with a retune and stops testing the boundary at all: widening the blast
    // to 900 left the earlier version of this case green.
    //
    // The blast is centred at x=300. 480 is 180px out, inside a 190 radius;
    // 540 is 240px out and is not.
    const clipped = unit(game, 480, 'dire');
    const missed = unit(game, 540, 'dire');
    indexObjects(game, [maiden, clipped, missed]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });

    expect(clipped.stats.health.value, 'a body inside the rim was missed').toBe(100 - Q_DAMAGE);
    expect(missed.stats.health.value, 'a body outside the rim was hit').toBe(100);
  });

  it('clamps an aim beyond its range back onto the rim', () => {
    // Aimed at three times its own reach. The blast has to land at 500, not at
    // 1500, or the ring the preview draws is a lie.
    const far = Q_RANGE * 3;
    const onTheRim = unit(game, Q_RANGE, 'dire');
    const wayOut = unit(game, far, 'dire');
    indexObjects(game, [maiden, onTheRim, wayOut]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: { x: far, y: 0 } });

    expect(spell.lastCentre?.x).toBeCloseTo(Q_RANGE, 5);
    expect(onTheRim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(wayOut.stats.health.value, 'the aim was not clamped at all').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, AIM.x, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });

    expect(maiden.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(pressSpell(spell, { at: AIM }), 'it cast again while on cooldown').toBe(false);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('refuses a cast she cannot pay for', () => {
    const victim = unit(game, AIM.x, 'dire');
    indexObjects(game, [maiden, victim]);
    maiden.stats.mana.baseValue = Q_MANA - 1;

    const spell = new CrystalMaiden_Q(maiden);
    expect(pressSpell(spell, { at: AIM })).toBe(false);
    expect(victim.stats.health.value).toBe(100);
    expect(maiden.stats.mana.value).toBe(Q_MANA - 1);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    // Against the 100 health pool `tests/_units.ts` builds every body with.
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
  });

  it('leaves its frost on the ground layer', () => {
    // `Z_INDEX_MAP` is keyed by exact constructor, so a `SpellObject` subclass
    // inherits nothing and falls through to 99 — above champions, painting a
    // decal over the feet of everyone standing in it.
    indexObjects(game, [maiden]);
    const spell = new CrystalMaiden_Q(maiden);
    pressSpell(spell, { at: AIM });

    const rime = game.objectManager._objectToBeAdd.find(
      spawned => spawned instanceof CrystalMaiden_Q_Frost
    );
    expect(rime, 'no frost was left behind at all').toBeDefined();
    expect(rime?.zIndex).toBe(api.layers.GROUND_Z_INDEX);
  });
});
