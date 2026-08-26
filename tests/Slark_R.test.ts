import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Slark_R, {
  R_DURATION_MS,
  R_MANA,
  R_REGEN_PER_TICK,
  R_TICK_MS,
  R_TOTAL_REGEN,
} from '../spells/Slark_R';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** One slice of match time on the dance, which owns the regeneration clock. */
const advance = (spell: Slark_R, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (spell.live && !spell.live.toRemove) spell.live.update();
  vi.stubGlobal('deltaTime', 16);
};

/** Runs the caster's own buffs forward so the dance's grants expire. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Slark_R — Vũ Điệu Bóng Tối', () => {
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

  it('hides him, lets him slip through bodies, and speeds him up', () => {
    indexObjects(game, [slark]);
    expect(pressSpell(new Slark_R(slark), {})).toBe(true);

    expect(has(slark, 'Invisible'), 'he danced in plain sight').toBe(true);
    expect(has(slark, 'Phasing'), 'stealth he can be body-blocked out of').toBe(true);
    expect(has(slark, 'Speedup')).toBe(true);
  });

  it('mends him while it lasts', () => {
    indexObjects(game, [slark]);
    slark.stats.health.baseValue = 40;

    const spell = new Slark_R(slark);
    pressSpell(spell, {});

    advance(spell, R_TICK_MS);
    expect(slark.stats.health.value).toBe(40 + R_REGEN_PER_TICK);

    for (let i = 1; i < R_DURATION_MS / R_TICK_MS; i++) advance(spell, R_TICK_MS);
    expect(slark.stats.health.value).toBe(40 + R_TOTAL_REGEN);
  });

  it('never mends him past full', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_R(slark);
    pressSpell(spell, {});

    for (let i = 0; i < R_DURATION_MS / R_TICK_MS; i++) advance(spell, R_TICK_MS);
    expect(slark.stats.health.value).toBe(100);
  });

  it('all three come off together when the dance ends', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_R(slark);
    pressSpell(spell, {});

    age(slark, R_DURATION_MS + 100);

    expect(has(slark, 'Invisible'), 'he stayed hidden').toBe(false);
    expect(has(slark, 'Phasing')).toBe(false);
    expect(has(slark, 'Speedup')).toBe(false);
  });

  it('takes the dance down with him if he dies', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_R(slark);
    pressSpell(spell, {});

    slark.takeDamage(500, unit(game, 300, 'dire'), 'TRUE', 'test');
    expect(slark.isDead).toBe(true);

    advance(spell, R_TICK_MS);
    expect(spell.live?.toRemove, 'the dance kept going on a corpse').toBe(true);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [slark]);
    const spell = new Slark_R(slark);
    pressSpell(spell, {});

    expect(slark.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    indexObjects(game, [slark]);
    slark.stats.mana.baseValue = R_MANA - 1;

    expect(pressSpell(new Slark_R(slark), {})).toBe(false);
    expect(has(slark, 'Invisible')).toBe(false);
  });
});
