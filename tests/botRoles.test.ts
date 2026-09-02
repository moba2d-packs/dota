/**
 * Can a bot reach these kits?
 *
 * The rules live in core (`@moba2d/core/testing/bots`) and score every
 * ability through `BotBrain.scoreSpell` itself, so nothing here restates the
 * weights the bot actually uses. This file is the population and the debt.
 *
 * The first sweep found 36 findings across nine heroes, and one line of
 * `inferRoles` explains all of them: a `SELF` cast with a mana cost reads as
 * `Buff | Shield`, which `scoreSpell` prices at **−5 above half health**, so
 * the mask comes to exactly 0 in a fight and `chooseSpell` drops candidates
 * scoring `<= 0`.
 *
 * The heroes it hits are the ones where it is most obviously wrong: Axe's
 * whole identity is a taunt and an execute, and a bot holding him presses
 * neither unless it is already dying. This pack is small enough to fix
 * properly — nine heroes, eighteen tags — and each tag is a sentence about
 * what an ability *is*, so they are worth writing one at a time rather than
 * guessing in a batch.
 *
 * Delete a line when you tag the spell. Stale entries fail on their own.
 */
import { describeBotRoles } from '@moba2d/core/testing/bots';
import { data } from '../pack';
import * as spells from '../spells/index';

describeBotRoles({
  label: 'dota — the bot can reach every kit',
  spells,
  champions: (data.champions ?? [])
    .filter(champion => champion.playable)
    .map(champion => ({ id: champion.id, name: champion.name, spells: champion.spells ?? [] })),
  // Emptied by reading all eighteen and saying what each one is — see the
  // header. What replaced the list is a tag per ability, each carrying the
  // sentence that justifies it.
  knownDebt: [
  ],
});
