/**
 * The VFX rules a scan can hold.
 *
 * They live in core (`@moba2d/core/testing/vfx`) because each is a fact about
 * the **engine** rather than about anyone's champions: what
 * `MissileSpellObject` carries, which globals p5 supplies, which globals the
 * test harness supplies, and which of an object's callbacks `ObjectManager`
 * runs under the caster's attribution. This pack cannot get any of them right
 * by reading its own source, and neither can the next one.
 *
 * Wired in at zero debt — the scan found nothing here on the day it was
 * added, which is the only moment adopting a rule set is free.
 */
import { describeVfxRules } from '@moba2d/core/testing/vfx';
import { join } from 'node:path';

describeVfxRules({
  label: 'dota — VFX rules a scan can hold',
  spellsDir: join(__dirname, '../spells'),
  // `file:rule` pairs not fixed yet. Every entry is something a player will
  // eventually report, so an empty list is the goal and not a formality.
  knownDebt: [],
});
