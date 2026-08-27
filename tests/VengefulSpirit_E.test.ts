import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import VengefulSpirit_E, {
  E_BONUS_DAMAGE,
  E_DURATION_MS,
  E_LINGER_MS,
  E_MANA,
  E_TICK_MS,
} from '../spells/VengefulSpirit_E';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

/** One slice of match time on the aura object itself, which owns the tick. */
const advance = (spell: VengefulSpirit_E, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (spell.live && !spell.live.toRemove) spell.live.update();
  vi.stubGlobal('deltaTime', 16);
};

/** Runs a body's own buffs forward so an expiring aura grant actually falls off. */
const age = (body: AttackableUnit, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  for (const buff of [...body.buffs]) if (!buff.toRemove) buff.update();
  body.buffs = body.buffs.filter(buff => !buff.toRemove);
  vi.stubGlobal('deltaTime', 16);
};

describe('VengefulSpirit_E — Hào Quang Báo Thù', () => {
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

  it('arms an aura that follows her', () => {
    indexObjects(game, [vengeful]);
    const spell = new VengefulSpirit_E(vengeful);
    expect(pressSpell(spell, {})).toBe(true);
    expect(spell.live, 'nothing was raised').not.toBeNull();

    vengeful.position.set(300, 300);
    advance(spell, E_TICK_MS);
    expect(spell.live?.position.x).toBe(300);
    expect(spell.live?.position.y).toBe(300);
  });

  it('hands nearby allies extra attack damage', () => {
    const friend = unit(game, 200, 'radiant');
    const before = friend.stats.attackDamage.value;
    indexObjects(game, [vengeful, friend]);

    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});
    advance(spell, E_TICK_MS);

    expect(friend.stats.attackDamage.value).toBe(before + E_BONUS_DAMAGE);
  });

  it('pays her too — she is inside her own aura', () => {
    const before = vengeful.stats.attackDamage.value;
    indexObjects(game, [vengeful]);

    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});
    advance(spell, E_TICK_MS);

    expect(vengeful.stats.attackDamage.value).toBe(before + E_BONUS_DAMAGE);
  });

  it('gives the enemy nothing', () => {
    const enemy = unit(game, 200, 'dire');
    const before = enemy.stats.attackDamage.value;
    indexObjects(game, [vengeful, enemy]);

    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});
    advance(spell, E_TICK_MS);

    expect(enemy.stats.attackDamage.value, 'it armed the other side').toBe(before);
    expect(has(enemy, 'StatAmp')).toBe(false);
  });

  /** 400 is inside a 500 aura; 640 is not. Hand-written, not `E_RADIUS ± n`. */
  it('reaches exactly as far as it says it does', () => {
    const near = unit(game, 400, 'radiant');
    const distant = unit(game, 640, 'radiant');
    const nearBefore = near.stats.attackDamage.value;
    const distantBefore = distant.stats.attackDamage.value;
    indexObjects(game, [vengeful, near, distant]);

    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});
    advance(spell, E_TICK_MS);

    expect(near.stats.attackDamage.value).toBe(nearBefore + E_BONUS_DAMAGE);
    expect(distant.stats.attackDamage.value, 'the aura reached past its own radius').toBe(
      distantBefore
    );
  });

  /**
   * The half of an aura that is easy to get wrong: a grant whose duration is
   * the aura's own lifetime never falls off when somebody walks out of it.
   * Each grant lasts one tick plus a short linger, and is renewed while they
   * stay — so walking out drops it a beat later, and walking around inside it
   * never stacks a second copy.
   */
  it('drops off an ally who walks out, and never stacks on one who stays', () => {
    const friend = unit(game, 200, 'radiant');
    const before = friend.stats.attackDamage.value;
    indexObjects(game, [vengeful, friend]);

    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});
    for (let i = 0; i < 5; i++) advance(spell, E_TICK_MS);

    expect(friend.stats.attackDamage.value, 'standing in it stacked the bonus').toBe(
      before + E_BONUS_DAMAGE
    );

    friend.position.set(2000, 2000);
    advance(spell, E_TICK_MS);
    age(friend, E_TICK_MS + E_LINGER_MS + 50);

    expect(friend.stats.attackDamage.value, 'the bonus followed them out of the aura').toBe(before);
  });

  it('comes down when its own duration runs out', () => {
    indexObjects(game, [vengeful]);
    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});

    advance(spell, E_DURATION_MS + 100);
    expect(spell.live?.toRemove, 'the aura outlived its own duration').toBe(true);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [vengeful]);
    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});

    expect(vengeful.stats.mana.value).toBe(100 - E_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  /**
   * The ring is a `SpellObject`, and `SpellObject`'s constructor copies its
   * owner's `teamId` — so a query filtered on team *alone* hands back the ring
   * itself alongside the allies standing in it. `pay()` then called `addBuff`
   * on it, which a `SpellObject` does not have, and the `TypeError` came out of
   * `ObjectManager.update()`. That is what froze a match: `GameScene.updateLoop`
   * arms its next tick with a `setTimeout` *after* `game.update()` returns, so a
   * throw there means the chain is never re-armed. The canvas kept painting the
   * last good frame, which is why it read as a hang rather than a crash.
   *
   * Driven through the real `objectManager.update()` on purpose. Every test
   * above calls `spell.live.update()` by hand, which is why they all passed
   * while the game did not: called that way the aura is never inserted into the
   * quadtree, so the query it makes can never return it.
   */
  it('does not pay itself — the ring is in the tree it queries', () => {
    const ally = unit(game, 100, 'radiant');
    indexObjects(game, [vengeful, ally]);
    const spell = new VengefulSpirit_E(vengeful);
    pressSpell(spell, {});

    vi.stubGlobal('deltaTime', E_TICK_MS);
    expect(() => {
      for (let tick = 0; tick < 4; tick++) game.objectManager.update();
    }, 'a tick through the real ObjectManager threw').not.toThrow();
  });
});
