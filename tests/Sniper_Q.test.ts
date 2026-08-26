import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Sniper_Q, {
  Q_DAMAGE_PER_TICK,
  Q_LIFETIME_MS,
  Q_LINGER_MS,
  Q_MANA,
  Q_TICK_MS,
  Q_TOTAL_DAMAGE,
} from '../spells/Sniper_Q';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** One slice of match time on the zone, which owns the tick. */
const advance = (spell: Sniper_Q, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (spell.live && !spell.live.toRemove) spell.live.update();
  vi.stubGlobal('deltaTime', 16);
};

/** Runs a body's own buffs forward so an expiring slow actually falls off. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Sniper_Q — Mảnh Đạn', () => {
  let game: TestGame;
  let sniper: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    sniper = unit(game, 0, 'radiant');
    game.setPlayer(sniper);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a field that bites whoever is standing in it', () => {
    const victim = unit(game, 500, 'dire');
    indexObjects(game, [sniper, victim]);

    const spell = new Sniper_Q(sniper);
    expect(pressSpell(spell, { at: { x: 500, y: 0 } })).toBe(true);

    // It bites on the very first frame it exists — a field that waits half a
    // second before doing anything can be walked through for free.
    advance(spell, 16);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE_PER_TICK);
  });

  it('keeps biting on its own clock, up to its stated total', () => {
    const victim = unit(game, 500, 'dire');
    indexObjects(game, [sniper, victim]);

    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });

    for (let i = 0; i < Q_LIFETIME_MS / Q_TICK_MS; i++) advance(spell, Q_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - Q_TOTAL_DAMAGE);

    advance(spell, Q_LIFETIME_MS);
    expect(victim.stats.health.value, 'the field outlived its own duration').toBe(
      100 - Q_TOTAL_DAMAGE
    );
  });

  it('slows whoever is inside it', () => {
    const victim = unit(game, 500, 'dire');
    indexObjects(game, [sniper, victim]);

    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });
    advance(spell, 16);

    expect(has(victim, 'Slow'), 'they walked through it at full speed').toBe(true);
  });

  /**
   * The half of a zone that is easy to get wrong twice over. The slow must not
   * stack ten deep from being re-applied every tick, and it must fall off
   * shortly after stepping out rather than lasting the whole field's lifetime.
   */
  it('lets the slow go a beat after they leave, without ever stacking it', () => {
    const victim = unit(game, 500, 'dire');
    indexObjects(game, [sniper, victim]);

    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });
    for (let i = 0; i < 4; i++) advance(spell, Q_TICK_MS);

    const slows = victim.buffs.filter(
      buff => buff.constructor.name === 'Slow' && !buff.toRemove
    );
    expect(slows.length, 'standing in it stacked the slow').toBe(1);

    victim.position.set(3000, 3000);
    advance(spell, Q_TICK_MS);
    age(victim, Q_TICK_MS + Q_LINGER_MS + 50);

    expect(has(victim, 'Slow'), 'the slow followed them out of the field').toBe(false);
  });

  it('leaves his own team alone', () => {
    const friend = unit(game, 500, 'radiant');
    indexObjects(game, [sniper, friend]);

    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });
    advance(spell, Q_TICK_MS);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Slow')).toBe(false);
  });

  /** 660 is inside a 200 field centred on 500; 760 is not. Hand-written. */
  it('reaches exactly as far as it says it does', () => {
    const inside = unit(game, 660, 'dire');
    const outside = unit(game, 760, 'dire');
    indexObjects(game, [sniper, inside, outside]);

    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });
    // One frame, not one whole interval: this case is about the edge, and a
    // full-interval step legitimately lands both the landing bite and the first
    // scheduled one, which would make the arithmetic here about the clock.
    advance(spell, 16);

    expect(inside.stats.health.value).toBe(100 - Q_DAMAGE_PER_TICK);
    expect(outside.stats.health.value, 'the field was bigger than it draws').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [sniper]);
    const spell = new Sniper_Q(sniper);
    pressSpell(spell, { at: { x: 500, y: 0 } });

    expect(sniper.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_TOTAL_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_TOTAL_DAMAGE).toBeLessThanOrEqual(35);
  });
});
