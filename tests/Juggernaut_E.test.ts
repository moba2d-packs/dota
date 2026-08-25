import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';
import Juggernaut_E, {
  E_BONUS_DAMAGE,
  E_DURATION_MS,
  E_MANA,
  E_WINDOW_BONUS,
} from '../spells/Juggernaut_E';
import { indexObjects, unit } from './_units';

const ON_ATTACK_HIT = api.enums.EventType.ON_ATTACK_HIT;
/** What a swing deals before anything on-hit sees it. Any number would do; this one is the engine's own. */
const SWING = api.units.DEFAULT_CHAMPION_ATTACK.damage;

const advance = (spell: Juggernaut_E, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Juggernaut_E — Vũ Đao', () => {
  let game: TestGame;
  let jugg: AttackableUnit;

  /**
   * One landed basic attack, exactly the way `combat/BasicAttack.ts` lands one:
   * the damage first, then `ON_ATTACK_HIT` with the number that actually
   * landed. Reproduced rather than driven through a real swing because the
   * swing itself belongs to `BasicAttackController` and takes a whole attack
   * cycle to reach; what this ability subscribes to is the event, and this is
   * that event with its real payload.
   */
  const swing = (attacker: AttackableUnit, victim: AttackableUnit): void => {
    victim.takeDamage(SWING, attacker);
    game.eventManager.emit(ON_ATTACK_HIT, {
      attacker,
      victim,
      damage: SWING,
      ranged: false,
      crit: false,
    });
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    jugg = unit(game, 0, 'radiant');
    game.setPlayer(jugg);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds its bonus to a basic attack he lands', () => {
    const victim = unit(game, 60, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_E(jugg);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(true);

    swing(jugg, victim);
    expect(victim.stats.health.value).toBe(100 - SWING - E_BONUS_DAMAGE);
  });

  it('leaves the bystanders alone — it rides one swing, it is not an area', () => {
    const victim = unit(game, 60, 'dire');
    const beside = unit(game, 70, 'dire');
    const friend = unit(game, 50, 'radiant');
    indexObjects(game, [jugg, victim, beside, friend]);

    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    swing(jugg, victim);

    expect(beside.stats.health.value, 'an enemy he did not swing at was cut').toBe(100);
    expect(friend.stats.health.value, 'an ally standing next to him was cut').toBe(100);
  });

  it('does not ride somebody else attacking', () => {
    const enemy = unit(game, 60, 'dire');
    const friend = unit(game, 40, 'radiant');
    indexObjects(game, [jugg, enemy, friend]);

    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    // His ally's swing, not his. The listener has to read `attacker`.
    swing(friend, enemy);
    expect(enemy.stats.health.value).toBe(100 - SWING);
  });

  it('stops adding anything once the window closes, and leaves no listener behind', () => {
    const victim = unit(game, 60, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    swing(jugg, victim);
    const afterOneSwing = victim.stats.health.value;
    expect(afterOneSwing).toBe(100 - SWING - E_BONUS_DAMAGE);

    // The runtime's own `active.maxDurationMs` is what closes the window.
    advance(spell, E_DURATION_MS);
    expect(spell.glow, 'the blade is still lit').toBeNull();

    swing(jugg, victim);
    expect(victim.stats.health.value, 'the bonus outlived its window').toBe(afterOneSwing - SWING);

    // And the listener itself is off, not merely inert — one left on
    // `eventManager` outlives the spell, the champion and the match.
    expect(game.eventManager.subscribers.get(ON_ATTACK_HIT) ?? []).toHaveLength(0);
  });

  it('takes its listener with it when the scene goes away', () => {
    const victim = unit(game, 60, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    spell.deactivate();

    swing(jugg, victim);
    expect(victim.stats.health.value).toBe(100 - SWING);
    expect(game.eventManager.subscribers.get(ON_ATTACK_HIT) ?? []).toHaveLength(0);
  });

  it('subscribes once, however many times it is pressed', () => {
    const victim = unit(game, 60, 'dire');
    indexObjects(game, [jugg, victim]);

    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });
    // The cooldown refuses the second press, which is the point: if it ever
    // stopped refusing, two listeners would each deal the bonus.
    pressSpell(spell, { at: { x: 0, y: 0 } });

    swing(jugg, victim);
    expect(victim.stats.health.value).toBe(100 - SWING - E_BONUS_DAMAGE);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [jugg]);
    const spell = new Juggernaut_E(jugg);
    pressSpell(spell, { at: { x: 0, y: 0 } });

    expect(jugg.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast he cannot pay for', () => {
    const victim = unit(game, 60, 'dire');
    indexObjects(game, [jugg, victim]);
    jugg.stats.mana.baseValue = E_MANA - 1;

    const spell = new Juggernaut_E(jugg);
    expect(pressSpell(spell, { at: { x: 0, y: 0 } })).toBe(false);
    expect(spell.glow, 'a refused cast still lit the blade').toBeNull();

    swing(jugg, victim);
    expect(victim.stats.health.value, 'a refused cast still subscribed').toBe(100 - SWING);
  });

  /**
   * Deliberately not the 15-35 burst band. This is a steroid: none of it lands
   * unless he is stood in melee range swinging for eight seconds, a disarm or
   * a kite deletes it outright, and it is worth exactly zero with nobody in
   * front of him. What the band is really about here is the per-swing figure,
   * which has to stay under the swing it rides on or it stops being a bonus
   * and starts being a second ability. The floor is what stops a retune to
   * zero going unnoticed by every other assertion in this file.
   */
  it('is tuned as a steroid on a swing, not as a nuke', () => {
    expect(E_BONUS_DAMAGE).toBeGreaterThanOrEqual(5);
    expect(E_BONUS_DAMAGE, 'the bonus outgrew the attack it rides on').toBeLessThan(SWING);
    expect(E_WINDOW_BONUS).toBeGreaterThanOrEqual(15);
    expect(E_WINDOW_BONUS).toBeLessThanOrEqual(80);
  });
});
