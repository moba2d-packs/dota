import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import VengefulSpirit_R, { R_MANA } from '../spells/VengefulSpirit_R';
import { indexObjects, unit } from './_units';

const { Ground } = buildTestApi().buffs;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('VengefulSpirit_R — Hoán Đổi Hư Không', () => {
  let game: TestGame;
  let vengeful: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    vengeful = unit(game, 0, 'radiant');
    game.setPlayer(vengeful);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts each of them exactly where the other was standing', () => {
    const victim = unit(game, 400, 'dire', 120);
    indexObjects(game, [vengeful, victim]);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: victim })).toBe(true);

    expect(vengeful.position.x).toBe(400);
    expect(vengeful.position.y).toBe(120);
    expect(victim.position.x).toBe(0);
    expect(victim.position.y).toBe(0);
  });

  it('leaves the victim reeling for a moment', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);

    pressSpell(new VengefulSpirit_R(vengeful), { target: victim });
    expect(has(victim, 'Slow'), 'they were dropped into her team unhindered').toBe(true);
  });

  /**
   * The ordering rule this ability is built on. `blinkOwnerTo` is allowed to
   * refuse — it is where grounding is enforced — so the caster must be moved
   * *first* and the victim only after that succeeded. A `teleportTo` on the
   * victim before a refused blink leaves both bodies standing in one spot.
   */
  it('moves neither of them when she is grounded', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);

    // Grounded through the engine's own buff rather than by poking a flag, so
    // this exercises the same rule a real Ground would.
    // `updateBuffs()` is the pass that folds every buff's `statusFlagsToEnable`
    // into the unit's status and calls `Stats.updateActionState` — adding the
    // buff alone leaves `grounded` false until a frame runs.
    vengeful.addBuff(new Ground(3_000, vengeful, vengeful));
    vengeful.updateBuffs();
    expect(vengeful.grounded, 'the fixture failed to ground her').toBe(true);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: victim })).toBe(false);
    expect(vengeful.position.x, 'she swapped while grounded').toBe(0);
    expect(victim.position.x, 'the victim was moved by a swap that never happened').toBe(400);
  });

  it('refuses an ally, and refuses to swap with itself', () => {
    const friend = unit(game, 400, 'radiant');
    indexObjects(game, [vengeful, friend]);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: friend })).toBe(false);
    expect(friend.position.x).toBe(400);
    expect(vengeful.position.x).toBe(0);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: vengeful })).toBe(false);
    expect(pressSpell(new VengefulSpirit_R(vengeful), { at: { x: 30, y: 30 } })).toBe(false);
    expect(vengeful.position.x, 'a press over empty ground moved her').toBe(0);
  });

  /** 560 is inside a 650 reach; 760 is not. Hand-written, not `R_RANGE ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 560, 'dire');
    const distant = unit(game, 760, 'dire');
    indexObjects(game, [vengeful, near, distant]);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: distant })).toBe(false);
    expect(distant.position.x, 'it reached past its own range').toBe(760);

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: near })).toBe(true);
    expect(vengeful.position.x).toBe(560);
  });

  it('charges its mana and starts its cooldown', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);

    const spell = new VengefulSpirit_R(vengeful);
    pressSpell(spell, { target: victim });

    expect(vengeful.stats.mana.value).toBe(100 - R_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast she cannot pay for', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);
    vengeful.stats.mana.baseValue = R_MANA - 1;

    expect(pressSpell(new VengefulSpirit_R(vengeful), { target: victim })).toBe(false);
    expect(vengeful.position.x).toBe(0);
    expect(victim.position.x).toBe(400);
  });
});
