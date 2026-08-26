import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import VengefulSpirit_W, {
  W_ARMOR_SHRED,
  W_BLIND_RADIUS,
  W_DAMAGE,
  W_MANA,
} from '../spells/VengefulSpirit_W';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

/** Sweeps the wave across the map the way a real match's frames would. */
const sweep = (game: TestGame): void => {
  const wave = game.objectManager._objectToBeAdd[0];
  for (let i = 0; i < 300 && wave && !wave.toRemove; i++) wave.update();
};

describe('VengefulSpirit_W — Sóng Kinh Hoàng', () => {
  let game: TestGame;
  let vengeful: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    // `Nearsight` writes the fog's own lerp speed in `onActivate`/`onDeactivate`,
    // and `createGame` builds no fog — so applying one to a bare test game
    // throws from inside the engine's buff rather than from anything this pack
    // wrote. The stub is the smallest shape that buff actually touches.
    (game as unknown as { fogOfWar: { sightChangeLerpSpeed: number } }).fogOfWar = {
      sightChangeLerpSpeed: 0.1,
    };
    vengeful = unit(game, 0, 'radiant');
    game.setPlayer(vengeful);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blinds everyone on the line it is drawn along, and strips their armour', () => {
    const victim = unit(game, 400, 'dire');
    const armourBefore = victim.stats.armor.value;
    indexObjects(game, [vengeful, victim]);

    expect(pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } })).toBe(true);
    sweep(game);

    expect(victim.stats.health.value).toBe(100 - W_DAMAGE);
    expect(has(victim, 'Nearsight'), 'the terror left them seeing normally').toBe(true);
    expect(victim.stats.armor.value, 'their armour was untouched').toBe(
      armourBefore - W_ARMOR_SHRED
    );
  });

  it('cuts their sight down to the radius it claims, not by it', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);

    pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } });
    sweep(game);

    // `Nearsight.newVisionRadius` is the absolute new sight radius, not a
    // delta — core builds the modifier as `-currentBase + newVisionRadius`.
    const blind = victim.buffs.find(buff => buff.constructor.name === 'Nearsight') as
      | { newVisionRadius: number }
      | undefined;
    expect(blind?.newVisionRadius).toBe(W_BLIND_RADIUS);
  });

  it('washes over several enemies at once rather than stopping on the first', () => {
    const first = unit(game, 250, 'dire');
    const second = unit(game, 500, 'dire');
    indexObjects(game, [vengeful, first, second]);

    pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } });
    sweep(game);

    expect(first.stats.health.value).toBe(100 - W_DAMAGE);
    expect(second.stats.health.value, 'the wave stopped on the first body').toBe(100 - W_DAMAGE);
  });

  it('hits each enemy once however long it travels over them', () => {
    const victim = unit(game, 400, 'dire');
    indexObjects(game, [vengeful, victim]);

    pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } });
    sweep(game);

    expect(victim.stats.health.value, 'the wave hit the same body twice').toBe(100 - W_DAMAGE);
  });

  it('leaves his own team alone', () => {
    const friend = unit(game, 400, 'radiant');
    const armourBefore = friend.stats.armor.value;
    indexObjects(game, [vengeful, friend]);

    pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } });
    sweep(game);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Nearsight')).toBe(false);
    expect(friend.stats.armor.value).toBe(armourBefore);
  });

  it('misses anyone standing well off the line', () => {
    const aside = unit(game, 400, 'dire', 400);
    indexObjects(game, [vengeful, aside]);

    pressSpell(new VengefulSpirit_W(vengeful), { at: { x: 700, y: 0 } });
    sweep(game);

    expect(aside.stats.health.value, 'the wave was wider than it looks').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [vengeful]);
    const spell = new VengefulSpirit_W(vengeful);
    expect(pressSpell(spell, { at: { x: 700, y: 0 } })).toBe(true);

    expect(vengeful.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a setup tool rather than as a nuke', () => {
    // Its payload is the blindness and the stripped armour; the damage is a
    // reminder that it passed through you.
    expect(W_DAMAGE).toBeLessThan(15);
    expect(W_ARMOR_SHRED).toBeGreaterThan(0);
  });
});
