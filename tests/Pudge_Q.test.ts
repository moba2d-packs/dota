import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApi, createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Pudge_Q, { Q_DAMAGE, Q_RANGE, Q_PULL_SPEED } from '../spells/Pudge_Q';
import { indexObjects, unit } from './_units';

const { Dash } = buildTestApi().buffs;

/**
 * The script, as test names. Everything goes through `pressSpell`, never a
 * lifecycle hook: a hook-calling test cannot see activation, cooldown, cost or
 * targeting rejection and stays green against an ability that does not work.
 */
describe('Pudge_Q — Móc Thịt', () => {
  let game: TestGame;
  let pudge: AttackableUnit;

  const flyUntilCaught = (hook: { update(): void; toRemove: boolean }, frames = 200): void => {
    for (let i = 0; i < frames && !hook.toRemove; i++) hook.update();
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    pudge = unit(game, 0, 'radiant');
    game.setPlayer(pudge);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('damages the first enemy the chain reaches', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [pudge, victim]);

    const spell = new Pudge_Q(pudge);
    expect(pressSpell(spell, { at: { x: Q_RANGE, y: 0 } })).toBe(true);

    const hook = spell.live!;
    expect(hook).toBeTruthy();
    for (let i = 0; i < 60 && hook.caught === null; i++) hook.update();

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  /**
   * The assertion above imports `Q_DAMAGE`, which is the house rule — a retune
   * must not mean editing a test — and which therefore cannot notice a retune
   * to zero: both sides of the comparison move together. This is the other
   * half of that bargain. `docs/VFX_STANDARD.md` scales this whole game to a
   * ~100 health pool and puts a normal ability at 15-35, so the band is a real
   * claim about the number rather than a copy of it.
   */
  it('is tuned inside the band a normal ability belongs in', () => {
    expect(Q_DAMAGE).toBeGreaterThanOrEqual(15);
    expect(Q_DAMAGE).toBeLessThanOrEqual(35);
  });

  it('drags what it caught back toward the caster', () => {
    const victim = unit(game, 300, 'dire');
    indexObjects(game, [pudge, victim]);

    const spell = new Pudge_Q(pudge);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });
    const hook = spell.live!;
    for (let i = 0; i < 60 && hook.caught === null; i++) hook.update();

    expect(hook.caught).toBe(victim);
    // The pull is a real displacement on the victim, not a teleport: it is a
    // `Dash` aimed at the caster, which is what makes it interruptible and
    // what stops it from putting a body inside a wall.
    // `instanceof` against the api's own class, not a name string: one module
    // evaluation means one class for the life of the page, which is the whole
    // reason `packApi.ts` exists — so this is the check that would notice a
    // second copy of `Dash` as well as a missing one.
    const dash = victim.buffs.find((buff): buff is InstanceType<typeof Dash> => buff instanceof Dash);
    expect(dash, 'the victim got no dash buff, so nothing is moving them').toBeTruthy();
    expect(dash!.dashSpeed).toBe(Q_PULL_SPEED);
  });

  it('comes back empty when it catches nothing', () => {
    indexObjects(game, [pudge]);
    const spell = new Pudge_Q(pudge);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });

    const hook = spell.live!;
    flyUntilCaught(hook);

    expect(hook.caught).toBeNull();
    expect(hook.toRemove, 'the hook never retracted').toBe(true);
  });

  it('never reaches past its own range', () => {
    // Aimed at four times the range: a DIRECTION cast picks the direction and
    // the spell owns the distance, so aiming further must not throw further.
    indexObjects(game, [pudge]);
    const spell = new Pudge_Q(pudge);
    pressSpell(spell, { at: { x: Q_RANGE * 4, y: 0 } });

    // Compared against the range constant, not against anything the spell
    // computed: a check that asks the code under test what it meant agrees
    // with it however wrong it is.
    expect(spell.live!.destination.x).toBeCloseTo(Q_RANGE, 1);
  });

  it('charges its mana and starts its cooldown once', () => {
    indexObjects(game, [pudge]);
    const spell = new Pudge_Q(pudge);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);

    expect(pudge.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses the cast it cannot pay for', () => {
    indexObjects(game, [pudge]);
    pudge.stats.mana.baseValue = 0;
    const spell = new Pudge_Q(pudge);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(false);
  });

  it('leaves an ally alone', () => {
    const friend = unit(game, 300, 'radiant');
    indexObjects(game, [pudge, friend]);

    const spell = new Pudge_Q(pudge);
    pressSpell(spell, { at: { x: Q_RANGE, y: 0 } });
    flyUntilCaught(spell.live!);

    expect(friend.stats.health.value).toBe(100);
    expect(spell.live!.caught).toBeNull();
  });
});
