import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import Lina_Q from '../spells/Lina_Q';
import { indexObjects, unit } from './_units';

/**
 * Damage this pack deals reaches the death recap with the ability's name on it.
 *
 * Reported from a real match: killed by Lina, the recap said only "Sát thương
 * phép" and named no ability. Twelve `takeDamage` calls in this pack — her whole
 * kit among them — passed neither a damage type nor a source, so the recap fell
 * through to `DAMAGE_TYPE_LABEL`.
 *
 * The fix is not twelve edits here. Core infers the name from whatever is
 * casting (`@moba2d/core`'s `combat/DamageAttribution.ts`), so this passes with
 * `Lina_Q.ts` untouched — and so does every spell written after it. This is the
 * test that says so, asserting on the recap the player reads rather than on an
 * argument that has to be remembered.
 */
describe('damage this pack deals names itself in the recap', () => {
  let game: TestGame;
  let lina: AttackableUnit;
  let victim: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    lina = unit(game, 0, 'radiant');
    victim = unit(game, 60, 'dire');
    game.setPlayer(lina);
    indexObjects(game, [lina, victim]);
  });

  it('files a missile hit under the ability that fired it', () => {
    const spell = new Lina_Q(lina);
    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);

    // The wave lands during `objectManager.update()`, frames after the cast
    // returned — on an object with no name of its own. That gap is the whole
    // reason the attribution is stamped at construction rather than passed.
    vi.stubGlobal('deltaTime', 16);
    for (let tick = 0; tick < 90 && victim.recentDamageLog.length === 0; tick++) {
      game.objectManager.update();
    }

    const hit = victim.recentDamageLog[0];
    expect(hit, 'the wave never connected, so this proves nothing').toBeDefined();
    expect(hit?.source, 'the recap would print the damage type instead').toBe(spell.name);
  });
});
