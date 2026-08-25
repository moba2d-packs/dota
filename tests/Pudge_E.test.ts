import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Pudge_E, {
  E_BASE_SHIELD,
  E_MAX_STACKS,
  E_PER_ENEMY,
  shieldFor,
} from '../spells/Pudge_E';
import { indexObjects, unit } from './_units';

const { Shield } = buildTestApi().buffs;

const shieldOn = (target: AttackableUnit): number => {
  const shield = target.buffs.find(
    (buff): buff is InstanceType<typeof Shield> => buff instanceof Shield
  );
  return shield ? shield.amount : 0;
};

describe('Pudge_E — Chồng Thịt', () => {
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

  it('gives the bare shield when nobody is near', () => {
    indexObjects(game, [pudge]);
    const spell = new Pudge_E(pudge);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(true);

    expect(spell.lastCount).toBe(0);
    expect(shieldOn(pudge)).toBe(E_BASE_SHIELD);
  });

  it('is worth more with two enemies around him', () => {
    const near = [unit(game, 90, 'dire'), unit(game, -90, 'dire')];
    indexObjects(game, [pudge, ...near]);
    const spell = new Pudge_E(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(spell.lastCount).toBe(2);
    // Written out rather than delegated to `shieldFor`: a check that asks the
    // code under test what it meant agrees with it however wrong it is.
    expect(shieldOn(pudge)).toBe(E_BASE_SHIELD + 2 * E_PER_ENEMY);
  });

  it('stops counting at its ceiling', () => {
    const crowd = [0, 1, 2, 3, 4].map(i => unit(game, 80 + i * 10, 'dire', i * 30));
    indexObjects(game, [pudge, ...crowd]);
    const spell = new Pudge_E(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(spell.lastCount).toBe(5);
    expect(shieldOn(pudge)).toBe(E_BASE_SHIELD + E_MAX_STACKS * E_PER_ENEMY);
    expect(shieldOn(pudge)).toBeLessThan(E_BASE_SHIELD + 5 * E_PER_ENEMY);
  });

  it('counts nobody standing outside the ring it draws', () => {
    // 340, written out: a probe at `E_COUNT_RADIUS + 200` follows the
    // constant and cannot notice the ring being widened. 230 is the inside
    // half of the same bracket, used by the counting cases above.
    const distant = unit(game, 340, 'dire');
    indexObjects(game, [pudge, distant]);
    const spell = new Pudge_E(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(spell.lastCount).toBe(0);
  });

  it('counts enemies, not allies', () => {
    const friend = unit(game, 90, 'radiant');
    indexObjects(game, [pudge, friend]);
    const spell = new Pudge_E(pudge);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(spell.lastCount).toBe(0);
    expect(shieldOn(pudge)).toBe(E_BASE_SHIELD);
  });

  it('scales inside a band a normal ability belongs in', () => {
    // Bare, it is a weak ability; fully stacked it is a strong one. Both ends
    // stay inside the 15-35 band `docs/VFX_STANDARD.md` sets for a non-ultimate.
    expect(shieldFor(0)).toBeGreaterThanOrEqual(15);
    expect(shieldFor(E_MAX_STACKS)).toBeLessThanOrEqual(60);
  });
});
