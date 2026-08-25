import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Juggernaut_W, {
  W_HEALTH,
  W_HEAL_PER_TICK,
  W_HEAL_RADIUS,
  W_MANA,
  W_MAX_TOTAL_HEAL,
  W_RANGE,
  W_TICKS,
  W_TICK_MS,
  type Juggernaut_W_Ward,
} from '../spells/Juggernaut_W';
import { indexObjects, unit } from './_units';

/** Where every press in this file plants the totem, comfortably inside `W_RANGE`. */
const SPOT = 200;

/** One frame of match time through the totem's own clock, which is where the pulsing lives. */
const stand = (ward: Juggernaut_W_Ward, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  ward.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Juggernaut_W — Cột Hồi Máu', () => {
  let game: TestGame;
  let jugg: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    jugg = unit(game, 0, 'radiant');
    game.setPlayer(jugg);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mends an ally standing in it, once per pulse', () => {
    const friend = unit(game, SPOT + 100, 'radiant');
    friend.stats.health.baseValue = 50;
    indexObjects(game, [jugg, friend]);

    const spell = new Juggernaut_W(jugg);
    expect(pressSpell(spell, { at: { x: SPOT, y: 0 } })).toBe(true);
    const ward = spell.ward;
    expect(ward, 'nothing was planted').not.toBeNull();

    // The first pulse lands the moment the totem does — see the file header's
    // arithmetic, which is what makes fifteen of them fit in nine seconds.
    stand(ward!, W_TICK_MS);
    expect(friend.stats.health.value).toBe(50 + W_HEAL_PER_TICK);
    stand(ward!, W_TICK_MS);
    expect(friend.stats.health.value).toBe(50 + W_HEAL_PER_TICK * 2);
  });

  it('does not mend an enemy standing in it', () => {
    const enemy = unit(game, SPOT + 50, 'dire');
    enemy.stats.health.baseValue = 50;
    indexObjects(game, [jugg, enemy]);

    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });
    for (let i = 0; i < 4; i++) stand(spell.ward!, W_TICK_MS);

    expect(enemy.stats.health.value).toBe(50);
  });

  it('does not reach an ally standing outside the ring', () => {
    // Just past the ring the effect draws on the ground. An ally who can see
    // themselves outside it must not be getting mended by it.
    const distant = unit(game, SPOT + W_HEAL_RADIUS + 60, 'radiant');
    distant.stats.health.baseValue = 50;
    indexObjects(game, [jugg, distant]);

    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });
    for (let i = 0; i < 4; i++) stand(spell.ward!, W_TICK_MS);

    expect(distant.stats.health.value).toBe(50);
  });

  it('is a body the enemy can kill, and a dead totem mends nobody', () => {
    const friend = unit(game, SPOT + 100, 'radiant');
    friend.stats.health.baseValue = 50;
    const enemy = unit(game, SPOT + 40, 'dire');
    indexObjects(game, [jugg, friend, enemy]);

    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });
    const ward = spell.ward!;
    expect(ward.stats.maxHealth.value, 'the totem is not the pool it advertises').toBe(W_HEALTH);

    stand(ward, W_TICK_MS);
    const afterOnePulse = friend.stats.health.value;
    expect(afterOnePulse).toBe(50 + W_HEAL_PER_TICK);

    ward.takeDamage(999, enemy);
    expect(ward.isDead).toBe(true);
    for (let i = 0; i < 4; i++) stand(ward, W_TICK_MS);

    expect(friend.stats.health.value, 'a corpse is still mending').toBe(afterOnePulse);
  });

  /**
   * `Pet extends Champion`, so `instanceof` says "champion" at every crediting
   * site in the engine. Without this, every totem the enemy team deletes lands
   * on somebody's kill count.
   */
  it('is not worth a kill to whoever breaks it', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });

    expect(spell.ward!.killCredit).toBe('none');
  });

  it('never picks a fight of its own', () => {
    const enemy = unit(game, SPOT + 40, 'dire');
    indexObjects(game, [jugg, enemy]);

    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });

    expect(spell.ward!.findTarget(), 'the totem went looking for somebody to hit').toBeNull();
  });

  it('plants itself at the edge of its range when aimed past it', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: 5_000, y: 0 } });

    expect(spell.ward!.position.x).toBeCloseTo(W_RANGE, 5);
  });

  it('runs out on time, having delivered exactly its stated number of pulses', () => {
    const friend = unit(game, SPOT + 100, 'radiant');
    friend.stats.health.baseValue = 20;
    indexObjects(game, [jugg, friend]);

    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });
    const ward = spell.ward!;

    // Well past the nine seconds: whatever is driving it has to have stopped.
    for (let i = 0; i < W_TICKS + 6; i++) stand(ward, W_TICK_MS);

    expect(friend.stats.health.value).toBe(20 + W_MAX_TOTAL_HEAL);
    expect(ward.toRemove, 'the totem is still standing').toBe(true);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_W(jugg);
    pressSpell(spell, { at: { x: SPOT, y: 0 } });

    expect(jugg.stats.mana.value).toBe(100 - W_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    indexObjects(game, [jugg]);
    jugg.stats.mana.baseValue = W_MANA - 1;

    const spell = new Juggernaut_W(jugg);
    expect(pressSpell(spell, { at: { x: SPOT, y: 0 } })).toBe(false);
    expect(spell.ward, 'a refused cast still planted a totem').toBeNull();
    expect(jugg.stats.mana.value, 'it charged him for a cast it refused').toBe(W_MANA - 1);
  });

  /**
   * A heal rather than damage, so the band it is measured against is its own:
   * the ceiling is one champion's whole pool, which is what nine seconds of
   * standing perfectly still inside a 260 circle beside a totem worth two
   * basic attacks is priced at. The floor is what stops a retune to zero going
   * unnoticed by every other assertion in this file, which imports the
   * constants and would agree with itself however wrong they were.
   */
  it('is tuned for standing still for nine seconds, and no more', () => {
    expect(W_MAX_TOTAL_HEAL).toBeGreaterThanOrEqual(15);
    expect(W_MAX_TOTAL_HEAL).toBeLessThanOrEqual(60);
    expect(W_HEAL_PER_TICK, 'one pulse is a heal, not a pulse').toBeLessThanOrEqual(10);
    expect(W_HEALTH, 'the totem has to be worth walking over to break').toBeLessThanOrEqual(40);
  });
});
