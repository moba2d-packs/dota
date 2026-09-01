/**
 * How long this pack makes a player wait, stated out loud.
 *
 * The engine's band (`@moba2d/core/testing/tempo`, measured off the reference
 * pack's 306 abilities) is **10s on an ultimate, 12s on a basic**. This pack
 * is nowhere near it, on purpose or by inheritance — its heroes come from a
 * game built around long cooldowns:
 *
 *   ultimates  10–60s   (median 40)
 *   basics      0–30s   (median 14)
 *
 * The override below is that fact written down, not an endorsement of it.
 * moba2d is a fast game — a bot with a 60-second Omnislash is a
 * basic-attacker for a minute — and bringing these into the band is a real
 * balance decision somebody should make deliberately. Until then the ceiling
 * at least stops the numbers growing, and the disagreement is in a file
 * rather than in nobody's head.
 */
import { describeTempo } from '@moba2d/core/testing/tempo';
import { data } from '../pack';
import { spellCatalog } from '../generated/spellCatalog';

describeTempo({
  label: 'dota — inherited long cooldowns, held where they are',
  spellCatalog,
  champions: (data.champions ?? []).filter(champion => champion.playable),
  maxUltimateMs: 60_000,
  maxBasicMs: 30_000,
});
