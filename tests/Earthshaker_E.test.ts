import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Earthshaker_E, {
  E_DAMAGE,
  E_DURATION_MS,
  E_MANA,
  E_STUN_MS,
} from '../spells/Earthshaker_E';
import { indexObjects, unit } from './_units';

const { EventType } = buildTestApi().enums;

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/**
 * A cast completing, driven through the engine's own event rather than by
 * calling the listener by hand — and with a stub spell rather than one of his
 * real abilities, so the tremor's damage is not tangled up with the damage of
 * whatever ability was used to trigger it.
 *
 * `countsAsAbilityCast: true` is stated rather than left off. Core defaults it
 * to `true` on `Spell`, so omitting it here still read as an ability — which is
 * exactly why every test in this file passed while a basic attack set off the
 * tremor in a real match. A stub that leaves out the field the code under test
 * is supposed to read cannot fail the way the game does.
 */
const castSomething = (game: TestGame, owner: AttackableUnit): void => {
  game.eventManager.emit(EventType.ON_POST_CAST_SPELL, { owner, countsAsAbilityCast: true });
};

/**
 * The other half of `ON_POST_CAST_SPELL`: everything core marks as *not* an
 * ability cast. `Spell.countsAsAbilityCast` is `true` by default and set to
 * `false` in exactly four places — `BasicAttack` (`coreSpells/BasicAttack.ts`),
 * Hồi Thành (`preset.ts`), a champion's passive (`Champion.ts`) and any spell
 * an item granted (`ItemShop.ts`). All four travel this same event.
 */
const attackOrSomethingLikeIt = (game: TestGame, owner: AttackableUnit): void => {
  game.eventManager.emit(EventType.ON_POST_CAST_SPELL, { owner, countsAsAbilityCast: false });
};

/** Runs a body's buffs forward so the arming expires. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('Earthshaker_E — Dư Chấn', () => {
  let game: TestGame;
  let shaker: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    shaker = unit(game, 0, 'radiant');
    game.setPlayer(shaker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing by itself — it is what every other cast now also does', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    expect(pressSpell(new Earthshaker_E(shaker), {})).toBe(true);
    expect(enemy.stats.health.value, 'arming it alone shook the ground').toBe(100);
  });

  it('sends a tremor out of him every time he casts', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(enemy.stats.health.value).toBe(100 - E_DAMAGE);
    expect(has(enemy, 'Stun'), 'the tremor shook nobody').toBe(true);
  });

  it('shakes again on the next cast, and the next', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);
    castSomething(game, shaker);

    expect(enemy.stats.health.value).toBe(100 - E_DAMAGE * 2);
  });

  it('ignores casts by anybody else', () => {
    const enemy = unit(game, 120, 'dire');
    const stranger = unit(game, 200, 'dire');
    indexObjects(game, [shaker, enemy, stranger]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, stranger);

    expect(enemy.stats.health.value, 'somebody else casting shook his ground').toBe(100);
  });

  it('leaves his own team standing', () => {
    const friend = unit(game, 120, 'radiant');
    indexObjects(game, [shaker, friend]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Stun')).toBe(false);
  });

  /** 160 is inside a 200 tremor; 260 is not. Hand-written, not `E_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 160, 'dire');
    const distant = unit(game, 260, 'dire');
    indexObjects(game, [shaker, near, distant]);

    pressSpell(new Earthshaker_E(shaker), {});
    castSomething(game, shaker);

    expect(near.stats.health.value).toBe(100 - E_DAMAGE);
    expect(distant.stats.health.value, 'the tremor reached too far').toBe(100);
  });

  /**
   * The half an event listener gets wrong. Subscribing is easy; the buff has to
   * take its own listener off when it expires, or Aftershock keeps firing for
   * the rest of the match — and, worse, for the rest of the *process*.
   */
  it('stops listening the moment the arming runs out', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);

    pressSpell(new Earthshaker_E(shaker), {});
    age(shaker, E_DURATION_MS + 100);
    castSomething(game, shaker);

    expect(enemy.stats.health.value, 'the listener outlived the buff').toBe(100);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [shaker]);
    const spell = new Earthshaker_E(shaker);
    pressSpell(spell, {});

    expect(shaker.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned as a rider on other abilities rather than as one of its own', () => {
    expect(E_DAMAGE).toBeLessThan(15);
    expect(E_STUN_MS).toBeGreaterThan(0);
    expect(E_STUN_MS).toBeLessThan(1_000);
  });

  /**
   * Reported from a real match: an ordinary attack order set the tremor off,
   * and it did so even with nobody in range to swing at — because
   * `BasicAttack.onSpellCast` orders an attack-move when it acquires nothing,
   * and `ON_POST_CAST_SPELL` fires either way.
   *
   * The description promises "mỗi lần dùng chiêu", and core already draws that
   * line for everyone: `Spell.countsAsAbilityCast`, `false` on the basic attack
   * with a comment naming this exact class of bug ("a spellblade-style 'after
   * casting a spell, your next attack…' must never be armed by the attack
   * itself"). `Item_Sheen.ts` in the lol pack reads the same flag for the same
   * reason.
   */
  it('is not set off by a basic attack, hit or miss', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);
    pressSpell(new Earthshaker_E(shaker), {});

    attackOrSomethingLikeIt(game, shaker);

    expect(enemy.stats.health.value, 'an attack order shook the ground').toBe(100);
    expect(has(enemy, 'Stun'), 'an attack order stunned somebody').toBe(false);
  });

  /**
   * Same flag, three more carriers. Hồi Thành is the one a player meets by
   * accident — pressing B under a turret would otherwise stun the diver.
   */
  it('is not set off by Hồi Thành, a passive or an item active', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);
    pressSpell(new Earthshaker_E(shaker), {});

    for (let i = 0; i < 3; i++) attackOrSomethingLikeIt(game, shaker);

    expect(enemy.stats.health.value).toBe(100);
  });

  it('still answers a real ability cast in between them', () => {
    const enemy = unit(game, 120, 'dire');
    indexObjects(game, [shaker, enemy]);
    pressSpell(new Earthshaker_E(shaker), {});

    attackOrSomethingLikeIt(game, shaker);
    castSomething(game, shaker);
    attackOrSomethingLikeIt(game, shaker);

    expect(
      enemy.stats.health.value,
      'the guard swallowed the ability cast too, or let an attack through'
    ).toBe(100 - E_DAMAGE);
  });
});
