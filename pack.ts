import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type {
  ContentPackCode,
  ContentPackData,
  SpellDisplayData,
  SpellSource,
} from '@moba2d/core/content/ContentPack';
import { setPackApi } from './packApi';
import { spellCatalog } from './generated/spellCatalog';
import { spellModules } from './generated/spellModules';

/**
 * Dota 2 — a roster pack: heroes and their kits, and deliberately no map yet.
 *
 * Core validates a pack before installing it, and a `playable` champion there
 * means exactly this: a portrait, and a kit of **four**. Three is not a pack
 * with a gap in it, it is a pack that fails to install, in a browser, after it
 * is already published.
 *
 * **No `maps` field, on purpose.** A map here would be a shape somebody
 * guessed at; the League pack's Summoner's Rift is hand-traced polygon by
 * polygon off the real minimap, which is why it reads as that map rather than
 * as an arena with three lines through it. Dota's map is the same job and has
 * not been done. `maps` is optional in `ContentPackData` and core plays these
 * heroes on whatever map is installed, so the roster ships now and the world
 * lands when it is traced rather than invented. The neutral creeps wait with
 * it: a `MonsterDef` is only ever reached through a `NeutralSlot`, and a
 * slot's `role` is a *map's* private vocabulary, so a Roshan with no Dota map
 * under him would never spawn anywhere.
 *
 * ## The two halves, and why the data one imports no spell
 *
 * `data` is inert: a roster, a map to list, and the display strings a picker
 * draws. It must be readable without ever building a `ContentApi`, because a
 * menu screen that only wants champion names should never load the engine
 * first — see `@moba2d/core/content/ContentPack`'s own header.
 *
 * So the numbers below come from `generated/spellCatalog.ts`, which the
 * catalogue generator produced by *constructing* each spell once at build
 * time and reading its fields. Nothing here imports `./spells/...`, and
 * nothing here may: a spell module reads `api` the moment it evaluates, and
 * at data-read time nobody has set one. `tests/dataHalf.test.ts` enforces it.
 *
 * `code` is the other half. It sets the api first — that single call is what
 * lets every spell file be an ordinary class declaration — and then hands
 * core a loader per spell, so a match downloads the kits in play.
 */
const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries(spellCatalog)) {
    out[id] = {
      name: entry.name,
      description: entry.description,
      iconKey: entry.iconKey,
      coolDownMs: entry.coolDownMs,
      manaCost: entry.manaCost,
      specCoolDownMs: entry.specCoolDownMs,
    };
  }
  return out;
};

export const data: ContentPackData = {
  // `coreRange` is the oldest core this pack works against. Core parses
  // exactly two shapes — `*` and `>=X.Y.Z` — and treats anything else as
  // unsatisfiable, so `^1` is not a loose range, it is a pack that refuses to
  // install. `scripts/write-manifest.mjs` states the same floor for the
  // published manifest; raise both together.
  manifest: { id: 'dota', version: '1.0.0', coreRange: '>=1.0.0', assets: 'dota' },
  champions: [
    {
      id: 'pudge',
      name: 'Pudge',
      // A key in this pack's own `generated/assetManifest.ts`, never one of
      // core's — see the `pack-asset-key` seam. The key is the file's path
      // under `assets/` with the extension dropped and its folder mapped to a
      // prefix, so `assets/images/champions/pudge.png` is `champ_pudge`. A
      // `playable` champion must have one.
      image: 'champ_pudge',
      playable: true,
      // A melee bruiser: he hits hard and slowly, and has to walk to you.
      attack: { damage: 16, attacksPerSecond: 0.85, range: 120 },
      spells: ['Pudge_Q', 'Pudge_W', 'Pudge_E', 'Pudge_R'],
    },
    {
      id: 'lina',
      name: 'Lina',
      image: 'champ_lina',
      playable: true,
      // A ranged nuker: her damage is in her abilities, not her swing.
      attack: { damage: 12, attacksPerSecond: 0.9, range: 380 },
      spells: ['Lina_Q', 'Lina_W', 'Lina_E', 'Lina_R'],
    },
    {
      id: 'juggernaut',
      name: 'Juggernaut',
      image: 'champ_juggernaut',
      playable: true,
      // A melee carry: the fastest swing on the roster, and the shortest reach.
      attack: { damage: 15, attacksPerSecond: 1.05, range: 130 },
      spells: ['Juggernaut_Q', 'Juggernaut_W', 'Juggernaut_E', 'Juggernaut_R'],
    },
    {
      id: 'crystalmaiden',
      name: 'Crystal Maiden',
      image: 'champ_crystalmaiden',
      playable: true,
      // A support: the longest reach and the weakest swing.
      attack: { damage: 11, attacksPerSecond: 0.85, range: 400 },
      spells: [
        'CrystalMaiden_Q',
        'CrystalMaiden_W',
        'CrystalMaiden_E',
        'CrystalMaiden_R',
        // moba2d-pack-add spell: new slot ids go above this line
      ],
    },
  ],
  spellDisplay: displayData(),
};

const code = (api: ContentApi): ContentPackCode => {
  // **First, and before anything reaches a spell module.** Every class in
  // `spells/` is declared against `packApi.ts`'s `api`, so this call is what
  // makes them constructible at all. The loaders below are lazy, so nothing
  // has evaluated yet when this runs.
  setPackApi(api);

  const spells: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    spells[id] = () => load().then(module => module.default);
  }
  return { spells };
};

export default code;
