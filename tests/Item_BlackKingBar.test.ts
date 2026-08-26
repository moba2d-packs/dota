import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_BlackKingBar, { DURATION_MS, MAGIC_RESIST } from '../spells/Item_BlackKingBar';
import { indexObjects, unit } from './_units';

const { Stun, Slow, Stasis } = buildTestApi().buffs;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** Runs a body's buffs forward so the window expires. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_BlackKingBar — Gậy Hắc Vương', () => {
  let game: TestGame;
  let wearer: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    wearer = unit(game, 0, 'radiant');
    enemy = unit(game, 300, 'dire');
    game.setPlayer(wearer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws off the crowd control already on him', () => {
    indexObjects(game, [wearer, enemy]);
    wearer.addBuff(new Stun(5_000, enemy, wearer));
    expect(has(wearer, 'Stun')).toBe(true);

    expect(pressSpell(new Item_BlackKingBar(wearer), {})).toBe(true);
    expect(has(wearer, 'Stun'), 'the bar left him stunned').toBe(false);
  });

  /**
   * The whole reason anybody buys one. Every gate in `Spell` reads
   * `owner.canCast`, and `Stats.updateActionState` clears CAN_CAST for six of
   * the ten crowd-control flags — so without `castableWhileControlled` the
   * button works against a root and refuses against a stun, which is the only
   * occasion it is ever pressed.
   */
  it('can be pressed while he is stunned, which is the only time it matters', () => {
    indexObjects(game, [wearer, enemy]);
    wearer.addBuff(new Stun(5_000, enemy, wearer));
    wearer.updateBuffs();
    expect(wearer.canCast, 'the fixture failed to take his cast away').toBe(false);

    expect(pressSpell(new Item_BlackKingBar(wearer), {})).toBe(true);
    expect(has(wearer, 'Stun')).toBe(false);
  });

  it('puts a wall of magic resistance up for its window', () => {
    indexObjects(game, [wearer]);
    const before = wearer.stats.magicResist.value;

    pressSpell(new Item_BlackKingBar(wearer), {});
    expect(wearer.stats.magicResist.value).toBe(before + MAGIC_RESIST);

    age(wearer, DURATION_MS + 100);
    expect(wearer.stats.magicResist.value, 'the wall outlived its window').toBe(before);
  });

  /**
   * `cleanse()` drops only what somebody *else* did to you — a self-cast
   * lockdown is a way out of a fight, and one item cancelling another is a bug
   * with two buttons.
   */
  it('does not cancel his own team’s work', () => {
    indexObjects(game, [wearer, enemy]);
    wearer.addBuff(new Stasis(3_000, wearer, wearer));

    pressSpell(new Item_BlackKingBar(wearer), {});
    expect(has(wearer, 'Stasis'), 'the bar cancelled his own stasis').toBe(true);
  });

  /** A slow is a stat modifier, not a status flag, and core's cleanse leaves it. */
  it('leaves a slow exactly where it was', () => {
    indexObjects(game, [wearer, enemy]);
    const dragging = new Slow(5_000, enemy, wearer);
    dragging.percent = 0.4;
    wearer.addBuff(dragging);

    pressSpell(new Item_BlackKingBar(wearer), {});
    expect(has(wearer, 'Slow'), 'it promised to clear slows and did').toBe(true);
  });

  it('costs no mana and goes on cooldown', () => {
    indexObjects(game, [wearer]);
    const item = new Item_BlackKingBar(wearer);
    pressSpell(item, {});

    expect(wearer.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a window rather than as a permanent stat', () => {
    expect(MAGIC_RESIST).toBeGreaterThan(0);
    expect(DURATION_MS).toBeGreaterThan(0);
    expect(DURATION_MS).toBeLessThan(15_000);
  });
});
