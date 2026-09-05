import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Item_Mekansm, { HEAL_AMOUNT } from '../spells/Item_Mekansm';
import { indexObjects, unit } from './_units';

describe('Item_Mekansm — Mekansm', () => {
  let game: TestGame;
  let carrier: AttackableUnit;
  let friend: AttackableUnit;
  let enemy: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    carrier = unit(game, 0, 'radiant');
    friend = unit(game, 250, 'radiant');
    enemy = unit(game, 250, 'dire', 100);
    game.setPlayer(carrier);
    indexObjects(game, [carrier, friend, enemy]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mends himself and the ally standing with him, immediately', () => {
    carrier.stats.health.baseValue = 40;
    friend.stats.health.baseValue = 40;

    expect(pressSpell(new Item_Mekansm(carrier), {})).toBe(true);

    expect(carrier.stats.health.value, 'the buyer got nothing').toBe(40 + HEAL_AMOUNT);
    expect(friend.stats.health.value, 'the ally beside him got nothing').toBe(40 + HEAL_AMOUNT);
  });

  it('never mends the other side', () => {
    enemy.stats.health.baseValue = 40;
    pressSpell(new Item_Mekansm(carrier), {});
    expect(enemy.stats.health.value, 'it healed an enemy').toBe(40);
  });

  /** 250 is inside a 400 ring; 640 is not. Hand-written, not `RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const distant = unit(game, 640, 'radiant');
    distant.stats.health.baseValue = 40;
    friend.stats.health.baseValue = 40;
    indexObjects(game, [carrier, friend, enemy, distant]);

    pressSpell(new Item_Mekansm(carrier), {});
    expect(friend.stats.health.value).toBe(40 + HEAL_AMOUNT);
    expect(distant.stats.health.value, 'the light reached past its own radius').toBe(40);
  });

  /**
   * The whole reason the mending goes through `takeHeal`: Bình Hồn is sold in
   * this same shop, and an item that healed around the wound would un-sell it.
   */
  it('is cut by a heal cut, like every honest heal', () => {
    const HealCut = buildTestApi().buffs.HealCut;
    friend.stats.health.baseValue = 40;
    const wound = new HealCut(3_000, enemy, friend);
    wound.healCut = 0.45;
    friend.addBuff(wound);

    pressSpell(new Item_Mekansm(carrier), {});

    // `takeHeal` rounds the cut number.
    expect(friend.stats.health.value).toBe(40 + Math.round(HEAL_AMOUNT * (1 - 0.45)));
  });

  it('never mends anyone past full', () => {
    pressSpell(new Item_Mekansm(carrier), {});
    expect(carrier.stats.health.value).toBe(100);
    expect(friend.stats.health.value).toBe(100);
  });

  it('costs no mana and goes on cooldown', () => {
    const item = new Item_Mekansm(carrier);
    pressSpell(item, {});

    expect(carrier.stats.mana.value, 'an item active billed the player mana').toBe(100);
    expect(item.currentCooldown).toBeGreaterThan(0);
  });
});
