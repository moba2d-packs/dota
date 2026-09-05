import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Basher, { BASH_STUN_MS, HITS_PER_BASH } from '../spells/Item_Basher';
import { indexObjects, unit } from './_units';

const stuns = (target: AttackableUnit) =>
  target.buffs.filter(buff => buff.constructor.name === 'Stun' && !buff.toRemove);

/** The hit, without a real swing: `Buff.onHit` is what `landBasicAttack` calls. */
const swing = (attacker: AttackableUnit, victim: AttackableUnit, echo = false): void => {
  for (const buff of [...attacker.buffs]) {
    (buff as unknown as { onHit: (hit: unknown) => void }).onHit({
      attacker,
      victim,
      damage: 12,
      ranged: false,
      crit: false,
      echo,
    });
  }
};

/** Runs a body's buffs forward so a spent stun actually clears. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Item_Basher — Búa Khiên Sọ', () => {
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

  it('holds through three swings and lands on the fourth', () => {
    expect(pressSpell(new Item_Basher(carrier), {})).toBe(true);

    for (let hits = 0; hits < HITS_PER_BASH - 1; hits++) {
      swing(carrier, victim);
      expect(stuns(victim).length, `swing ${hits + 1} bashed early`).toBe(0);
    }
    swing(carrier, victim);
    expect(stuns(victim).length, 'the fourth swing carried no bash').toBe(1);
  });

  it('counts again from zero after each bash', () => {
    pressSpell(new Item_Basher(carrier), {});
    for (let hits = 0; hits < HITS_PER_BASH; hits++) swing(carrier, victim);
    age(victim, BASH_STUN_MS + 100);
    expect(stuns(victim).length, 'the first bash never cleared').toBe(0);

    for (let hits = 0; hits < HITS_PER_BASH - 1; hits++) swing(carrier, victim);
    expect(stuns(victim).length, 'the counter carried over a spent swing').toBe(0);
    swing(carrier, victim);
    expect(stuns(victim).length).toBe(1);
  });

  /**
   * A proc that stepped the counter would let another item's propagation turn
   * "every fourth swing" into a lie whose size depends on the rest of the bag.
   */
  it('never counts an echo', () => {
    pressSpell(new Item_Basher(carrier), {});

    for (let hits = 0; hits < HITS_PER_BASH * 2; hits++) swing(carrier, victim, true);
    expect(stuns(victim).length, 'phantom hits stepped the counter').toBe(0);
  });

  it('keeps its bookkeeping off the buff bar, tied to the item', () => {
    const item = new Item_Basher(carrier);
    pressSpell(item, {});

    const armed = carrier.buffs.find(
      buff => buff.constructor.name === 'Item_Basher_Count' && !buff.toRemove
    );
    expect(armed?.hudVisible, 'the item put a row on the buff bar').toBe(false);
    expect(armed?.sourceSpell, 'selling it would leave the counter armed').toBe(item);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Basher(carrier);
    pressSpell(item, {});

    expect(carrier.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
