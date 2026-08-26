import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Slark_Q, {
  Q_DAMAGE,
  Q_DELAY_MS,
  Q_MANA,
  Q_SELF_DAMAGE,
} from '../spells/Slark_Q';
import { indexObjects, unit } from './_units';

const { Root, Speedup } = buildTestApi().buffs;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** One slice of match time on the pact itself, which owns the delay. */
const advance = (spell: Slark_Q, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (spell.live && !spell.live.toRemove) spell.live.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Slark_Q — Khế Ước Hắc Ám', () => {
  let game: TestGame;
  let slark: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    slark = unit(game, 0, 'radiant');
    game.setPlayer(slark);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing at all until the delay has run', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [slark, victim]);

    const spell = new Slark_Q(slark);
    expect(pressSpell(spell, {})).toBe(true);

    advance(spell, Q_DELAY_MS - 60);
    expect(victim.stats.health.value, 'the pact paid out early').toBe(100);
    expect(slark.stats.health.value).toBe(100);
  });

  it('bursts once the delay is up, and costs him a little blood', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [slark, victim]);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(slark.stats.health.value, 'the pact cost him nothing').toBe(100 - Q_SELF_DAMAGE);
  });

  /**
   * The reason the ability exists. `cleanse()` is core's own definition of
   * "this buff is crowd control", so what counts is not a list this pack keeps.
   */
  it('shakes off crowd control somebody else put on him', () => {
    indexObjects(game, [slark]);
    const enemy = unit(game, 400, 'dire');
    slark.addBuff(new Root(5_000, enemy, slark));
    expect(has(slark, 'Root')).toBe(true);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);

    expect(has(slark, 'Root'), 'the pact left him rooted').toBe(false);
  });

  /**
   * `cleanse()` drops only what somebody *else* did to you. His own haste is
   * not crowd control and is not his enemy's to remove — an ability that
   * cancelled its own team's buffs would be a button that punishes pressing it.
   */
  it('keeps his own buffs', () => {
    indexObjects(game, [slark]);
    const haste = new Speedup(5_000, slark, slark);
    haste.percent = 0.2;
    slark.addBuff(haste);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);

    expect(has(slark, 'Speedup'), 'the pact ate his own haste').toBe(true);
  });

  it('hits each enemy once however long the burst is drawn', () => {
    const victim = unit(game, 150, 'dire');
    indexObjects(game, [slark, victim]);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);
    advance(spell, 200);
    advance(spell, 200);

    expect(victim.stats.health.value, 'the burst paid out twice').toBe(100 - Q_DAMAGE);
  });

  it('leaves his own team alone', () => {
    const friend = unit(game, 150, 'radiant');
    indexObjects(game, [slark, friend]);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);

    expect(friend.stats.health.value).toBe(100);
  });

  /** 200 is inside a 260 burst; 330 is not. Hand-written, not `Q_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 200, 'dire');
    const distant = unit(game, 330, 'dire');
    indexObjects(game, [slark, near, distant]);

    const spell = new Slark_Q(slark);
    pressSpell(spell, {});
    advance(spell, Q_DELAY_MS);

    expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(distant.stats.health.value, 'the burst reached past its own radius').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_Q(slark);
    pressSpell(spell, {});

    expect(slark.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
    // The blood price has to be worth paying.
    expect(Q_SELF_DAMAGE).toBeLessThan(Q_DAMAGE);
  });
});
