import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Axe_W, {
  W_DAMAGE_PER_TICK,
  W_DURATION_MS,
  W_MANA,
  W_TICK_MS,
  W_TOTAL_DAMAGE,
} from '../spells/Axe_W';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

/**
 * One slice of match time, driven on whichever bodies carry the buffs. Nothing
 * else in this test owns a clock: the burn lives entirely on the victim, and
 * the haste entirely on Axe.
 */
const advance = (bodies: AttackableUnit[], ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const body of bodies) {
    for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
    body.buffs = body.buffs.filter(buff => !buff.toRemove);
  }
  vi.stubGlobal('deltaTime', 16);
};

describe('Axe_W — Cơn Đói Chiến Trận', () => {
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

  it('sets the hunger on an enemy and eats at them a bite at a time', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [axe, victim]);

    const spell = new Axe_W(axe);
    expect(pressSpell(spell, { target: victim })).toBe(true);

    // The press itself does not bite — the first tick is still due.
    expect(victim.stats.health.value).toBe(100);

    advance([victim], W_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - W_DAMAGE_PER_TICK);
  });

  it('eats exactly its stated total, and then stops', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [axe, victim]);

    const spell = new Axe_W(axe);
    pressSpell(spell, { target: victim });

    for (let i = 0; i < W_DURATION_MS / W_TICK_MS; i++) advance([victim], W_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - W_TOTAL_DAMAGE);

    // Well past the duration, nothing more is taken.
    advance([victim], W_DURATION_MS);
    expect(victim.stats.health.value, 'the hunger outlived its own duration').toBe(
      100 - W_TOTAL_DAMAGE
    );
  });

  it('slows the victim and speeds Axe up while it runs', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [axe, victim]);

    const spell = new Axe_W(axe);
    pressSpell(spell, { target: victim });

    expect(has(victim, 'Slow'), 'the victim was not slowed').toBe(true);
    expect(has(axe, 'Speedup'), 'Axe did not get his own haste').toBe(true);
  });

  it('stops the moment the victim dies rather than chewing on a corpse', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [axe, victim]);
    victim.stats.health.baseValue = W_DAMAGE_PER_TICK;

    const spell = new Axe_W(axe);
    pressSpell(spell, { target: victim });

    advance([victim], W_TICK_MS);
    expect(victim.isDead).toBe(true);

    const afterDeath = victim.stats.health.value;
    advance([victim], W_TICK_MS * 4);
    expect(victim.stats.health.value).toBe(afterDeath);
  });

  it('refuses an ally, and refuses to eat itself', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [axe, friend]);

    expect(pressSpell(new Axe_W(axe), { target: friend })).toBe(false);
    expect(has(friend, 'DamageOverTime') || has(friend, 'Axe_W_Burn')).toBe(false);

    // The failure four shipped abilities in this engine have had: without
    // `targetTeam: 'ENEMY'` the resolver defaults to `'ANY'`, which includes
    // the caster, and a press over empty ground resolves *him*.
    expect(pressSpell(new Axe_W(axe), { target: axe })).toBe(false);
    expect(pressSpell(new Axe_W(axe), { at: { x: 40, y: 40 } })).toBe(false);
    advance([axe], W_DURATION_MS);
    expect(axe.stats.health.value).toBe(100);
  });

  /**
   * Hand-written distances, not `W_RANGE ± n`: a test that derives its own
   * geometry from the constant it checks slides along with a retune and stops
   * testing the boundary. 340 is inside a 400 reach; 470 is not.
   */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 340, 'dire');
    const distant = unit(game, 470, 'dire');
    indexObjects(game, [axe, near, distant]);

    expect(pressSpell(new Axe_W(axe), { target: distant }), 'it reached too far').toBe(false);
    expect(pressSpell(new Axe_W(axe), { target: near }), 'it refused a target in range').toBe(true);

    advance([distant], W_DURATION_MS);
    expect(distant.stats.health.value).toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [axe, victim]);

    const spell = new Axe_W(axe);
    pressSpell(spell, { target: victim });

    expect(axe.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(pressSpell(spell, { target: victim })).toBe(false);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(W_TOTAL_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(W_TOTAL_DAMAGE).toBeLessThanOrEqual(35);
  });
});
