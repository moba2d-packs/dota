import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Maelstrom, { CHAIN_DAMAGE, HITS_PER_CHAIN } from '../spells/Item_Maelstrom';
import { indexObjects, unit } from './_units';

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

describe('Item_Maelstrom — Búa Bão Tố', () => {
  let game: TestGame;
  let carrier: AttackableUnit;
  let victim: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    carrier = unit(game, 0, 'radiant');
    victim = unit(game, 200, 'dire');
    game.setPlayer(carrier);
    indexObjects(game, [carrier, victim]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds through two swings and fires on the third', () => {
    expect(pressSpell(new Item_Maelstrom(carrier), {})).toBe(true);

    for (let hits = 0; hits < HITS_PER_CHAIN - 1; hits++) {
      swing(carrier, victim);
      expect(victim.stats.health.value, `swing ${hits + 1} sparked early`).toBe(100);
    }
    swing(carrier, victim);
    expect(victim.stats.health.value).toBe(100 - CHAIN_DAMAGE);
  });

  /** The lightning spreads from the struck body, not from the wielder. */
  it('jumps to the two enemies nearest the victim, and no further', () => {
    const near = unit(game, 300, 'dire');
    const nearer = unit(game, 260, 'dire');
    const third = unit(game, 420, 'dire');
    const distant = unit(game, 600, 'dire');
    indexObjects(game, [carrier, victim, near, nearer, third, distant]);

    pressSpell(new Item_Maelstrom(carrier), {});
    for (let hits = 0; hits < HITS_PER_CHAIN; hits++) swing(carrier, victim);

    expect(victim.stats.health.value).toBe(100 - CHAIN_DAMAGE);
    expect(nearer.stats.health.value, 'the nearest jump missed').toBe(100 - CHAIN_DAMAGE);
    expect(near.stats.health.value, 'the second jump missed').toBe(100 - CHAIN_DAMAGE);
    // 420 is within 250 of the victim at 200? No — 220 away, inside the ring,
    // but the bolt carries only two jumps and these two were closer.
    expect(third.stats.health.value, 'the bolt jumped a third time').toBe(100);
    expect(distant.stats.health.value, 'the bolt crossed the map').toBe(100);
  });

  it('never arcs to his own side', () => {
    const friend = unit(game, 260, 'radiant');
    indexObjects(game, [carrier, victim, friend]);

    pressSpell(new Item_Maelstrom(carrier), {});
    for (let hits = 0; hits < HITS_PER_CHAIN; hits++) swing(carrier, victim);

    expect(friend.stats.health.value, 'the lightning hit an ally').toBe(100);
  });

  it('still fires with nobody to jump to — one bolt, one target', () => {
    pressSpell(new Item_Maelstrom(carrier), {});
    for (let hits = 0; hits < HITS_PER_CHAIN * 2; hits++) swing(carrier, victim);

    expect(victim.stats.health.value).toBe(100 - CHAIN_DAMAGE * 2);
  });

  /** A chain that stepped its own counter would cascade — see the header. */
  it('never counts an echo', () => {
    pressSpell(new Item_Maelstrom(carrier), {});
    for (let hits = 0; hits < HITS_PER_CHAIN * 2; hits++) swing(carrier, victim, true);

    expect(victim.stats.health.value, 'phantom hits stepped the counter').toBe(100);
  });

  it('is a passive: no mana, no cooldown', () => {
    const item = new Item_Maelstrom(carrier);
    pressSpell(item, {});

    expect(carrier.stats.mana.value).toBe(100);
    expect(item.manaCost).toBe(0);
    expect(item.coolDown).toBe(0);
  });
});
