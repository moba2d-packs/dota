import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Axe_Q, { Q_ARMOR, Q_MANA, Q_TAUNT_MS } from '../spells/Axe_Q';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name);

describe('Axe_Q — Tiếng Gọi Cuồng Nộ', () => {
  let game: TestGame;
  let axe: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    axe = unit(game, 0, 'radiant');
    game.setPlayer(axe);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes every enemy inside the roar come and swing at him', () => {
    const near = unit(game, 120, 'dire');
    const alsoNear = unit(game, 0, 'dire', 200);
    indexObjects(game, [axe, near, alsoNear]);

    const spell = new Axe_Q(axe);
    expect(pressSpell(spell, {})).toBe(true);

    expect(has(near, 'Taunt'), 'the closest enemy kept his own orders').toBe(true);
    expect(has(alsoNear, 'Taunt')).toBe(true);
    expect(spell.live?.called.length).toBe(2);
  });

  /**
   * Distances written out by hand rather than as `Q_RADIUS ± n`. A test that
   * derives its own geometry from the constant it is checking slides along with
   * a retune and stops testing the boundary at all. 220 is inside a 260 roar;
   * 340 is not.
   */
  it('does not reach past the ring it draws', () => {
    const inside = unit(game, 220, 'dire');
    const outside = unit(game, 340, 'dire');
    indexObjects(game, [axe, inside, outside]);

    const spell = new Axe_Q(axe);
    pressSpell(spell, {});

    expect(has(inside, 'Taunt'), 'it refused someone inside its own radius').toBe(true);
    expect(has(outside, 'Taunt'), 'the roar reached past its own radius').toBe(false);
  });

  it('leaves his own team alone', () => {
    const friend = unit(game, 120, 'radiant');
    indexObjects(game, [axe, friend]);

    const spell = new Axe_Q(axe);
    pressSpell(spell, {});

    expect(has(friend, 'Taunt')).toBe(false);
    expect(spell.live?.called.length).toBe(0);
  });

  it('does not taunt himself', () => {
    indexObjects(game, [axe]);
    const spell = new Axe_Q(axe);
    pressSpell(spell, {});

    expect(has(axe, 'Taunt')).toBe(false);
  });

  it('braces his armour for as long as the roar lasts', () => {
    const before = axe.stats.armor.value;
    indexObjects(game, [axe]);

    const spell = new Axe_Q(axe);
    pressSpell(spell, {});
    expect(axe.stats.armor.value).toBe(before + Q_ARMOR);

    // Run the buff past its own duration and the armour comes back off. The
    // buff is driven directly because nothing else in this test owns a clock.
    vi.stubGlobal('deltaTime', Q_TAUNT_MS + 100);
    for (const buff of [...axe.buffs]) buff.update();
    vi.stubGlobal('deltaTime', 16);
    axe.buffs = axe.buffs.filter(buff => !buff.toRemove);

    expect(axe.stats.armor.value, 'the armour outlived the roar').toBe(before);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [axe]);
    const spell = new Axe_Q(axe);
    pressSpell(spell, {});

    expect(axe.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(pressSpell(spell, {}), 'it roared again while on cooldown').toBe(false);
  });

  it('refuses a cast he cannot pay for', () => {
    const near = unit(game, 120, 'dire');
    indexObjects(game, [axe, near]);
    axe.stats.mana.baseValue = Q_MANA - 1;

    const spell = new Axe_Q(axe);
    expect(pressSpell(spell, {})).toBe(false);
    expect(has(near, 'Taunt')).toBe(false);
  });
});
