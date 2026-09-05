/**
 * Every spell this pack ships, by id.
 *
 * Read by two things and written by hand: `catalog.config.mjs` points the
 * catalogue generator at this file, and the generator uses it twice — once to
 * construct each spell and read its display fields into
 * `generated/spellCatalog.ts`, and once to emit `generated/spellModules.ts`,
 * the `id -> () => import('...')` map a match loads kits through.
 *
 * The export *name* is the spell id. `pack.ts`'s roster names the same string
 * in a champion's `spells: [...]`, and a mismatch is a champion with an empty
 * slot rather than an error, so keep them in step.
 *
 * `moba2d-pack-add spell` appends here.
 */
export { default as Pudge_Q } from './Pudge_Q';
export { default as Pudge_W } from './Pudge_W';
export { default as Pudge_E } from './Pudge_E';
export { default as Pudge_R } from './Pudge_R';
export { default as Lina_Q } from './Lina_Q';
export { default as Lina_W } from './Lina_W';
export { default as Lina_E } from './Lina_E';
export { default as Lina_R } from './Lina_R';
export { default as Juggernaut_Q } from './Juggernaut_Q';
export { default as Juggernaut_W } from './Juggernaut_W';
export { default as Juggernaut_E } from './Juggernaut_E';
export { default as Juggernaut_R } from './Juggernaut_R';
export { default as CrystalMaiden_Q } from './CrystalMaiden_Q';
export { default as CrystalMaiden_W } from './CrystalMaiden_W';
export { default as CrystalMaiden_E } from './CrystalMaiden_E';
export { default as CrystalMaiden_R } from './CrystalMaiden_R';
export { default as Axe_Q } from './Axe_Q';
export { default as Axe_W } from './Axe_W';
export { default as Axe_E } from './Axe_E';
export { default as Axe_R } from './Axe_R';
export { default as VengefulSpirit_Q } from './VengefulSpirit_Q';
export { default as VengefulSpirit_W } from './VengefulSpirit_W';
export { default as VengefulSpirit_E } from './VengefulSpirit_E';
export { default as VengefulSpirit_R } from './VengefulSpirit_R';
export { default as Slark_Q } from './Slark_Q';
export { default as Slark_W } from './Slark_W';
export { default as Slark_E } from './Slark_E';
export { default as Slark_R } from './Slark_R';
export { default as Earthshaker_Q } from './Earthshaker_Q';
export { default as Earthshaker_W } from './Earthshaker_W';
export { default as Earthshaker_E } from './Earthshaker_E';
export { default as Earthshaker_R } from './Earthshaker_R';
export { default as Sniper_Q } from './Sniper_Q';
export { default as Sniper_W } from './Sniper_W';
export { default as Sniper_E } from './Sniper_E';
export { default as Sniper_R } from './Sniper_R';

// Items. Registered here like any other spell — the barrel is what the
// catalogue generator reads — but named in `pack.ts`'s `items` map rather
// than in any champion's `spells` kit, and deliberately kept out of
// `spellDisplay`. See the note over `displayData()`.
export { default as Item_BladeMail } from './Item_BladeMail';
export { default as Item_Euls } from './Item_Euls';
export { default as Item_BlackKingBar } from './Item_BlackKingBar';
export { default as Item_ShivasGuard } from './Item_ShivasGuard';
export { default as Item_Heart } from './Item_Heart';
export { default as Item_SpiritVessel } from './Item_SpiritVessel';
export { default as Item_Desolator } from './Item_Desolator';
export { default as Item_Hood } from './Item_Hood';
export { default as Item_Pipe } from './Item_Pipe';
export { default as Item_Vanguard } from './Item_Vanguard';
export { default as Item_CrimsonGuard } from './Item_CrimsonGuard';
export { default as Item_Satanic } from './Item_Satanic';
// moba2d-pack-add spell: new barrel entries go above this line
