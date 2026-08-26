import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Earthshaker_Q, {
  Q_DAMAGE,
  Q_LIFETIME_MS,
  Q_MANA,
  Q_STUN_MS,
} from '../spells/Earthshaker_Q';
import { indexObjects, unit } from './_units';

const has = (target: AttackableUnit, name: string): boolean =>
  target.buffs.some(buff => buff.constructor.name === name && !buff.toRemove);

/** One slice of match time on the slab, which owns its own clock. */
const advance = (spell: Earthshaker_Q, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  if (spell.live && !spell.live.toRemove) spell.live.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Earthshaker_Q — Khe Nứt', () => {
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

  it('splits the ground and stuns whoever was standing on the line', () => {
    const victim = unit(game, 250, 'dire');
    indexObjects(game, [shaker, victim]);

    expect(pressSpell(new Earthshaker_Q(shaker), { at: { x: 420, y: 0 } })).toBe(true);

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(has(victim, 'Stun'), 'the ground opened under them and they walked on').toBe(true);
  });

  it('catches everyone along it, once each', () => {
    const near = unit(game, 120, 'dire');
    const far = unit(game, 340, 'dire');
    indexObjects(game, [shaker, near, far]);

    const spell = new Earthshaker_Q(shaker);
    pressSpell(spell, { at: { x: 420, y: 0 } });
    advance(spell, 300);
    advance(spell, 300);

    expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(far.stats.health.value, 'the crack stopped at the first body').toBe(100 - Q_DAMAGE);
  });

  it('leaves his own team unhurt', () => {
    const friend = unit(game, 250, 'radiant');
    indexObjects(game, [shaker, friend]);

    pressSpell(new Earthshaker_Q(shaker), { at: { x: 420, y: 0 } });

    expect(friend.stats.health.value).toBe(100);
    expect(has(friend, 'Stun')).toBe(false);
  });

  it('misses anyone standing well off the line', () => {
    const aside = unit(game, 250, 'dire', 300);
    indexObjects(game, [shaker, aside]);

    pressSpell(new Earthshaker_Q(shaker), { at: { x: 420, y: 0 } });

    expect(aside.stats.health.value, 'the crack was wider than it looks').toBe(100);
  });

  /**
   * The half that makes it Fissure rather than a line nuke: the stone is real
   * terrain for as long as it stands, and stops both teams.
   */
  it('is a wall while it stands, and stops being one when it crumbles', () => {
    indexObjects(game, [shaker]);
    const spell = new Earthshaker_Q(shaker);
    pressSpell(spell, { at: { x: 420, y: 0 } });

    expect(spell.live?.blocksMovement, 'a barrier you can walk through is not one').toBe(true);
    expect(spell.live?.wallVertices().length, 'the slab has no outline').toBe(4);

    advance(spell, Q_LIFETIME_MS + 100);
    expect(spell.live?.toRemove).toBe(true);
    expect(spell.live?.blocksMovement).toBe(false);
  });

  it('shoves a body standing inside the stone back out of it', () => {
    // Placed on the slab itself, which is the one case that has to be handled:
    // everyone else walks into it from outside and rests against a face.
    const caught = unit(game, 200, 'dire');
    indexObjects(game, [shaker, caught]);

    const spell = new Earthshaker_Q(shaker);
    pressSpell(spell, { at: { x: 420, y: 0 } });
    const before = caught.position.y;

    advance(spell, 16);
    expect(
      Math.abs(caught.position.y - before),
      'the stone erupted straight through a body and left it there'
    ).toBeGreaterThan(0);
  });

  it('charges its mana and starts its cooldown', () => {
    indexObjects(game, [shaker]);
    const spell = new Earthshaker_Q(shaker);
    pressSpell(spell, { at: { x: 420, y: 0 } });

    expect(shaker.stats.mana.value).toBe(100 - Q_MANA);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
    expect(Q_STUN_MS).toBeGreaterThan(0);
  });
});
