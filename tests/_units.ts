import { buildTestApi, indexObjects, type TestGame } from '@moba2d/core/testing';
import type { AttackableUnit } from '@moba2d/core/content/types';

const { AttackableUnit: Unit } = buildTestApi().units;

/**
 * One test body, at full health and mana.
 *
 * Shared because every spell test in this pack needs the same three lines and
 * because the *defaults* matter to the assertions: a 100 health pool is what
 * `docs/VFX_STANDARD.md` scales every damage number in this pack against, so a
 * test that quietly used 500 would stop being able to tell a tuned ability
 * from an untuned one.
 */
export function unit(game: TestGame, x: number, teamId: string, y = 0): AttackableUnit {
  const created = new Unit({ game, position: createVector(x, y), teamId });
  created.stats.mana.baseValue = 100;
  created.stats.maxMana.baseValue = 100;
  created.stats.health.baseValue = 100;
  created.stats.maxHealth.baseValue = 100;
  return created;
}

/** `indexObjects`, re-exported so a test file imports its whole world from one place. */
export { indexObjects };
