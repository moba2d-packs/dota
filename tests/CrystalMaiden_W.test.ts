import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import CrystalMaiden_W, {
  W_DAMAGE_PER_TICK,
  W_MANA,
  W_RANGE,
  W_ROOT_MS,
  W_TICK_MS,
  W_TICKS,
  W_TOTAL_DAMAGE,
} from '../spells/CrystalMaiden_W';
import { indexObjects, unit } from './_units';

/**
 * One slice of match time.
 *
 * Both clocks are driven, because the ability has two: the spell's own (the
 * runtime's cooldown and interrupt watch) and the shell's, which is where the
 * damage lives. The shell is skipped once it has flagged itself for removal,
 * exactly as `ObjectManager.update` skips it.
 */
const advance = (spell: CrystalMaiden_W, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  if (spell.shell && !spell.shell.toRemove) spell.shell.update();
  vi.stubGlobal('deltaTime', 16);
};

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('CrystalMaiden_W — Băng Giá', () => {
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

  it('freezes an enemy within reach to the spot', () => {
    const victim = unit(game, W_RANGE - 40, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_W(maiden);
    expect(pressSpell(spell, { target: victim })).toBe(true);
    expect(has(victim, 'Root'), 'the victim can still walk away').toBe(true);
    expect(spell.shell, 'nothing was drawn on the victim').not.toBeNull();
  });

  it('takes a bite out of them on every tick, and only four of them', () => {
    const victim = unit(game, W_RANGE - 40, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_W(maiden);
    pressSpell(spell, { target: victim });

    // Nothing at all until the first tick is due: the root lands on the press,
    // the damage does not.
    advance(spell, W_TICK_MS - 50);
    expect(victim.stats.health.value).toBe(100);

    advance(spell, 50);
    expect(victim.stats.health.value).toBe(100 - W_DAMAGE_PER_TICK);

    for (let i = 1; i < W_TICKS; i++) advance(spell, W_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - W_TOTAL_DAMAGE);

    // The root is over, so the biting is too.
    advance(spell, W_TICK_MS * 4);
    expect(victim.stats.health.value).toBe(100 - W_TOTAL_DAMAGE);
  });

  it('stops the moment the victim dies', () => {
    const victim = unit(game, W_RANGE - 40, 'dire');
    indexObjects(game, [maiden, victim]);
    victim.stats.health.baseValue = W_DAMAGE_PER_TICK;

    const spell = new CrystalMaiden_W(maiden);
    pressSpell(spell, { target: victim });
    advance(spell, W_TICK_MS);
    expect(victim.isDead).toBe(true);

    advance(spell, W_TICK_MS * 3);
    expect(spell.shell?.ticksDone, 'it kept chewing on a corpse').toBe(1);
    expect(spell.shell?.toRemove, 'the shell is still drawn on a corpse').toBe(true);
  });

  it('refuses an ally', () => {
    const friend = unit(game, W_RANGE - 40, 'radiant');
    indexObjects(game, [maiden, friend]);

    const spell = new CrystalMaiden_W(maiden);
    expect(pressSpell(spell, { target: friend })).toBe(false);
    expect(has(friend, 'Root')).toBe(false);

    advance(spell, W_TICK_MS * W_TICKS);
    expect(friend.stats.health.value).toBe(100);
  });

  /**
   * The failure four shipped abilities in this engine have had. Without
   * `targetTeam: 'ENEMY'` the resolver defaults to `'ANY'`, which includes
   * `request.caster`, so a press over empty ground resolves *her* — and the
   * ability roots and eats the person who cast it.
   */
  it('refuses to freeze itself', () => {
    indexObjects(game, [maiden]);
    const spell = new CrystalMaiden_W(maiden);

    expect(pressSpell(spell, { target: maiden })).toBe(false);
    expect(pressSpell(spell, { at: { x: 40, y: 40 } })).toBe(false);
    expect(has(maiden, 'Root')).toBe(false);
    expect(spell.shell).toBeNull();

    advance(spell, W_TICK_MS * W_TICKS);
    expect(maiden.stats.health.value).toBe(100);
    expect(maiden.stats.mana.value, 'it charged her for a cast it refused').toBe(100);
  });

  it('reaches exactly as far as it says it does', () => {
    // Distances written out by hand rather than as `W_RANGE ± n`. A test that
    // derives its own geometry from the constant it is checking slides along
    // with a retune and stops testing the boundary at all: widening the reach
    // to 4000 left the earlier version of this case green. 340 is inside a 380
    // reach; 460 is not.
    const near = unit(game, 340, 'dire');
    const distant = unit(game, 460, 'dire');
    indexObjects(game, [maiden, near, distant]);

    const refused = new CrystalMaiden_W(maiden);
    expect(pressSpell(refused, { target: distant }), 'it reached past its own range').toBe(false);
    expect(has(distant, 'Root')).toBe(false);

    const accepted = new CrystalMaiden_W(maiden);
    expect(pressSpell(accepted, { target: near }), 'it refused a target inside its range').toBe(
      true
    );

    advance(refused, W_TICK_MS * W_TICKS);
    expect(distant.stats.health.value).toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, W_RANGE - 40, 'dire');
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_W(maiden);
    pressSpell(spell, { target: victim });

    expect(maiden.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(pressSpell(spell, { target: victim }), 'it cast again while on cooldown').toBe(false);
  });

  it('refuses a cast she cannot pay for', () => {
    const victim = unit(game, W_RANGE - 40, 'dire');
    indexObjects(game, [maiden, victim]);
    maiden.stats.mana.baseValue = W_MANA - 1;

    const spell = new CrystalMaiden_W(maiden);
    expect(pressSpell(spell, { target: victim })).toBe(false);
    expect(has(victim, 'Root')).toBe(false);

    advance(spell, W_TICK_MS * W_TICKS);
    expect(victim.stats.health.value).toBe(100);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    // Against the 100 health pool `tests/_units.ts` builds every body with.
    expect(W_TOTAL_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(W_TOTAL_DAMAGE).toBeLessThanOrEqual(35);
    // The bites have to fit inside the root, or the last one lands on somebody
    // who is already free to walk.
    expect(W_TICK_MS * W_TICKS).toBeLessThanOrEqual(W_ROOT_MS);
  });
});
