import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Skadi, { SLOW_MS, SLOW_PERCENT } from '../spells/Item_Skadi';
import { indexObjects, unit } from './_units';

const slows = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.constructor.name === 'Slow' && !buff.toRemove);

/** The hit, without a real swing: `Buff.onHit` is what `landBasicAttack` calls. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit): void => {
  for (const buff of [...attacker.buffs]) {
    (buff as unknown as { onHit: (hit: unknown) => void }).onHit({
      attacker,
      victim,
      damage: 12,
      ranged: false,
      crit: false,
      echo: false,
    });
  }
};

/** Runs a body's buffs forward so an expiring frost actually thaws. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Skadi — Mắt Skadi', () => {
  let game: TestGame;
  let carrier: AttackableUnit;
  let victim: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    carrier = unit(game, 0, 'radiant');
    victim = unit(game, 150, 'dire');
    game.setPlayer(carrier);
    indexObjects(game, [carrier, victim]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the frost on whoever the swing lands on', () => {
    expect(pressSpell(new Item_Skadi(carrier), {})).toBe(true);
    swing(carrier, victim);

    const frost = slows(victim);
    expect(frost.length, 'the swing carried no cold').toBe(1);
    expect((frost[0] as unknown as { percent: number }).percent).toBe(SLOW_PERCENT);
  });

  /**
   * The trap the header names: this item's whole audience swings twice a
   * second, and `Slow`'s default add type stacks ten deep — three swings
   * would turn 25% into a pin.
   */
  it('never stacks under a full attack-speed build', () => {
    pressSpell(new Item_Skadi(carrier), {});
    for (let hits = 0; hits < 6; hits++) swing(carrier, victim);

    expect(slows(victim).length, 'swinging fast froze them solid').toBe(1);
  });

  it('adds up to one frost even from two carriers', () => {
    const second = unit(game, 60, 'radiant');
    indexObjects(game, [carrier, second, victim]);

    pressSpell(new Item_Skadi(carrier), {});
    pressSpell(new Item_Skadi(second), {});
    swing(carrier, victim);
    swing(second, victim);

    expect(slows(victim).length, 'two Skadis doubled the slow').toBe(1);
  });

  it('thaws on time', () => {
    pressSpell(new Item_Skadi(carrier), {});
    swing(carrier, victim);
    age(victim, SLOW_MS + 100);

    expect(slows(victim).length, 'the frost never let go').toBe(0);
  });

  it('keeps its bookkeeping off the buff bar, tied to the item', () => {
    const item = new Item_Skadi(carrier);
    pressSpell(item, {});

    const armed = carrier.buffs.find(
      buff => buff.constructor.name === 'Item_Skadi_Frost' && !buff.toRemove
    );
    expect(armed?.hudVisible, 'the item put a row on the buff bar').toBe(false);
    expect(armed?.sourceSpell, 'selling it would leave the frost armed').toBe(item);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Skadi(carrier);
    pressSpell(item, {});

    expect(carrier.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
