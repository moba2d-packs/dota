import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_W, {
  W_DAMAGE,
  W_DELAY_MS,
  W_RADIUS,
  W_RANGE,
  W_STUN_MS,
  type Lina_W_Object,
} from '../spells/Lina_W';
import { indexObjects, unit } from './_units';

/** Where every test in this file plants the array. */
const PLANT_X = 200;

const advance = (array: Lina_W_Object, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  array.update();
  vi.stubGlobal('deltaTime', 16);
};

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('Lina_W — Trận Địa Sáng', () => {
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

  it('does nothing at all until the delay has run out', () => {
    const victim = unit(game, PLANT_X, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_W(lina);
    expect(pressSpell(spell, { at: { x: PLANT_X, y: 0 } })).toBe(true);
    advance(spell.live!, W_DELAY_MS - 50);

    // The window a player has to step out is the whole ability. If this goes
    // green with a smaller number there is no ability, only a delayed number.
    expect(victim.stats.health.value).toBe(100);
    expect(has(victim, 'Stun')).toBe(false);
  });

  it('burns and stuns everything still inside when the fire arrives', () => {
    const victim = unit(game, PLANT_X, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: PLANT_X, y: 0 } });
    advance(spell.live!, W_DELAY_MS);

    expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
    expect(has(victim, 'Stun'), 'it burned them and let them keep walking').toBe(true);
    const dazed = victim.buffs.find(buff => buff.constructor.name === 'Stun');
    expect(dazed!.duration).toBe(W_STUN_MS);
  });

  it('goes off exactly once, however long the scorch lingers', () => {
    const victim = unit(game, PLANT_X, 'dire');
    indexObjects(game, [lina, victim]);

    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: PLANT_X, y: 0 } });
    const array = spell.live!;
    for (let i = 0; i < 30 && !array.toRemove; i++) advance(array, 100);

    expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
    expect(array.lastHitCount).toBe(1);
  });

  /**
   * The other half of importing `W_DAMAGE` into the assertions above: both
   * sides of those comparisons move together, so none of them can notice a
   * retune to zero. `docs/VFX_STANDARD.md` puts a normal ability at 15-35
   * against a ~100 health pool.
   */
  it('is tuned inside the band a normal ability belongs in', () => {
    expect(W_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(W_DAMAGE).toBeLessThanOrEqual(35);
  });

  it('leaves an ally standing in it alone', () => {
    const friend = unit(game, PLANT_X, 'radiant');
    indexObjects(game, [lina, friend]);

    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: PLANT_X, y: 0 } });
    advance(spell.live!, W_DELAY_MS);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Stun')).toBe(false);
  });

  it('leaves an enemy standing outside the ring alone', () => {
    // 80px clear of the rim the telegraph is drawn at, so a body's own radius
    // cannot argue it back inside.
    const outside = unit(game, PLANT_X + W_RADIUS + 80, 'dire');
    indexObjects(game, [lina, outside]);

    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: PLANT_X, y: 0 } });
    advance(spell.live!, W_DELAY_MS);

    expect(outside.stats.health.value).toBe(100);
    expect(has(outside, 'Stun')).toBe(false);
  });

  it('plants no further away than its range', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: W_RANGE * 3, y: 0 } });

    // Against the range constant, not against anything the spell computed.
    expect(spell.live!.position.x).toBeCloseTo(W_RANGE, 1);
  });

  it('keeps a short aim short rather than flinging it to maximum range', () => {
    // POINT targeting, not DIRECTION: the distance the thumb dragged is the
    // distance the array is planted at. `getVectorWithRange` here instead of
    // `getVectorWithMaxRange` would put every tap at 500.
    indexObjects(game, [lina]);
    const spell = new Lina_W(lina);
    pressSpell(spell, { at: { x: 120, y: 0 } });

    expect(spell.live!.position.x).toBeCloseTo(120, 1);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [lina]);
    const spell = new Lina_W(lina);
    expect(pressSpell(spell, { at: { x: PLANT_X, y: 0 } })).toBe(true);

    expect(lina.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast it cannot pay for', () => {
    indexObjects(game, [lina]);
    lina.stats.mana.baseValue = 0;
    const spell = new Lina_W(lina);
    expect(pressSpell(spell, { at: { x: PLANT_X, y: 0 } })).toBe(false);
    expect(spell.live).toBeNull();
  });
});
