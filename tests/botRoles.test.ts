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
  knownDebt: [
  // Costed `SELF` casts with nothing declared, so `inferRoles` files each of
  // them beside a panic button. Blade Fury is a spin that damages everyone
  // touching it; Berserker's Call is a taunt; Pounce is a leap.
  'self-cast-untagged:Axe_E',
  'self-cast-untagged:Axe_Q',
  'self-cast-untagged:Axe_R',
  'self-cast-untagged:CrystalMaiden_E',
  'self-cast-untagged:CrystalMaiden_R',
  'self-cast-untagged:Earthshaker_E',
  'self-cast-untagged:Earthshaker_R',
  'self-cast-untagged:Earthshaker_W',
  'self-cast-untagged:Juggernaut_E',
  'self-cast-untagged:Juggernaut_Q',
  'self-cast-untagged:Lina_E',
  'self-cast-untagged:Pudge_E',
  'self-cast-untagged:Slark_E',
  'self-cast-untagged:Slark_Q',
  'self-cast-untagged:Slark_R',
  'self-cast-untagged:Sniper_E',
  'self-cast-untagged:Sniper_W',
  'self-cast-untagged:VengefulSpirit_E',
  // The same abilities, priced: `Buff + Shield` is 5 − 5 = 0 above half
  // health, and `chooseSpell` drops anything scoring `<= 0`.
  'dead-in-combat:Axe_E',
  'dead-in-combat:Axe_Q',
  'dead-in-combat:CrystalMaiden_E',
  'dead-in-combat:Earthshaker_E',
  'dead-in-combat:Earthshaker_W',
  'dead-in-combat:Juggernaut_E',
  'dead-in-combat:Juggernaut_Q',
  'dead-in-combat:Lina_E',
  'dead-in-combat:Pudge_E',
  'dead-in-combat:Slark_E',
  'dead-in-combat:Slark_Q',
  'dead-in-combat:Sniper_E',
  'dead-in-combat:Sniper_W',
  'dead-in-combat:VengefulSpirit_E',
  // Culling Blade is an execute and Echo Slam is the largest area in the
  // pack; both currently score 6 in a fight and 31 while dying.
  'panic-ultimate:Axe_R',
  'panic-ultimate:CrystalMaiden_R',
  'panic-ultimate:Earthshaker_R',
  'panic-ultimate:Slark_R',
  ],
});
