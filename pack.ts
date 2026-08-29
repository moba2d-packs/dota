import type { ContentApi } from "@moba2d/core/content/ContentApi";
import type {
  ContentPackCode,
  ContentPackData,
  ItemDef,
  SpellDisplayData,
  SpellSource,
} from "@moba2d/core/content/ContentPack";
import { setPackApi } from "./packApi";
import { spellCatalog } from "./generated/spellCatalog";
import { spellModules } from "./generated/spellModules";

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
/**
 * The display strings a picker draws, for the abilities a champion casts.
 *
 * **The `Item_*` spells are deliberately left out.** This is the difference
 * between a spell that belongs to a champion's kit and one that belongs to an
 * item: `spellDisplay` is what the loadout screen offers as a *choosable
 * ability*, so leaving an item's active in it puts Gậy Hắc Vương in the list of
 * things a random loadout can hand somebody who never bought it. The items have
 * their own display strings — `ItemDef.name` and `.description`, read by the
 * shop — so nothing here is lost by the omission.
 *
 * Matched on the `Item_` prefix rather than a hand-kept list of five, because
 * the sixth item is exactly the one somebody forgets to add to a list.
 */
const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries(spellCatalog)) {
    if (id.startsWith("Item_")) continue;
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

/**
 * The shop: nine components and the five things they build into.
 *
 * ## `cost` is the total, and it is written exactly once
 *
 * A finished item's `cost` is what it costs *from nothing*. What a player
 * actually pays when the parts are already in the bag is that number minus what
 * those parts cost, worked out by core's `ItemShop.priceFor` — so a separate
 * combine cost is a second place the same fact would live, and the two drift
 * the first time anyone retunes. Core refuses a total under the sum of its
 * parts, which would make combining pay the player.
 *
 * ## `passive` and `active` are local spell ids, and never kit ids
 *
 * Both name a spell in `spells/index.ts`, which is the same barrel a
 * champion's abilities come from — an item's spell is an ordinary spell, and
 * that is the whole mechanism. What makes it an *item's* is that its id appears
 * here and in no champion's `spells: [...]`, and that `displayData()` keeps it
 * out of `spellDisplay` so a loadout screen cannot offer it as an ability. See
 * that function's own note.
 *
 * ## The stat keys are an allow-list
 *
 * `ItemDef.stats` accepts `ItemStatKey`, not every field on `StatsModifier` —
 * `health` and `size` are deliberately off it. Numbers here are scaled to the
 * ~100 health pool this pack tunes everything against, which is why a Heart of
 * Tarrasque reads as +55 rather than the +250 the real game gives it.
 */
/**
 * How much punishment each kind of hero takes — this pack's own taxonomy, and
 * the half that did not exist until now.
 *
 * Every champion above declares an `attack` profile and none declared a body,
 * so all nine were **100 health with no resistances** — less than a lane
 * creep's 140, and identical for Pudge and for Sniper. It was survivable while
 * nothing could be bought and stopped being when the shop grew.
 *
 * ## The resistances carry this, not the health pool
 *
 * A flat health pool and a resistance are not interchangeable for the six
 * abilities in this pack that heal or shield a **flat amount** (Juggernaut's
 * ward, Pudge's rot-fed regeneration among them). A 40-point shield behind 100
 * armour is worth 80 — the same multiplier the pool gets, so those six keep
 * their worth exactly. Doubling the pool instead would halve them against a
 * body twice the size, and the repair would be six edits here and 39 in the
 * other installed pack.
 *
 * Resistances also cannot run away: `100 / (100 + r)` is asymptotic, so no
 * stack of armour is ever immunity.
 *
 * ## Where these numbers came from
 *
 * The strength/agility/intelligence split of the source game, read off each
 * hero's own line above: a melee initiator is a wall, a ranged nuker is not.
 * Tuned so a full defensive build survives a full damage build for about four
 * to five seconds instead of the two and a half it managed before.
 */
export const DEFENCE = {
  /** Melee initiators — the ones expected to walk in first. */
  STRENGTH: { health: 220, healthRegen: 0.09, armor: 55, magicResist: 45 },
  /** Melee carries — real bodies, but they came to deal damage. */
  AGILITY: { health: 165, healthRegen: 0.07, armor: 32, magicResist: 20 },
  /** Ranged nukers and supports — the reason the front line exists. */
  INTELLIGENCE: { health: 135, healthRegen: 0.06, armor: 16, magicResist: 24 },
} as const;

export type Role = keyof typeof DEFENCE;

/** The attack half, so a hand-built kit can take a whole body rather than half of one. */
const ROLE_ATTACK: Record<
  Role,
  { damage: number; attacksPerSecond: number; range: number }
> = {
  STRENGTH: { damage: 16, attacksPerSecond: 0.88, range: 125 },
  AGILITY: { damage: 15, attacksPerSecond: 1.02, range: 128 },
  INTELLIGENCE: { damage: 12, attacksPerSecond: 0.9, range: 390 },
};

const ROLE_NAME: Record<Role, string> = {
  STRENGTH: "Sức Mạnh",
  AGILITY: "Nhanh Nhẹn",
  INTELLIGENCE: "Trí Tuệ",
};

/**
 * This pack's taxonomy, published for the loadout screen.
 *
 * A player who assembles a kit by hand has no hero to inherit a body from, and
 * core cannot invent one — it does not know what "strength" means and
 * deliberately never will, because a taxonomy is the roster's vocabulary and
 * not the engine's. So the pack hands the picker its three, exactly the way it
 * hands over its heroes and its items, and core stores only the chosen id.
 */
const archetypeEntries = () =>
  (Object.keys(DEFENCE) as Role[]).map((role) => ({
    id: role.toLowerCase(),
    name: ROLE_NAME[role],
    attack: ROLE_ATTACK[role],
    defence: DEFENCE[role],
  }));

const itemEntries = (): Record<string, ItemDef> => ({
  // ---- Components ------------------------------------------------------
  broadsword: {
    id: "broadsword",
    name: "Kiếm Lớn",
    icon: "item_broadsword",
    cost: 450,
    stats: { attackDamage: 7 },
  },
  chainmail: {
    id: "chainmail",
    name: "Giáp Xích",
    icon: "item_chainmail",
    cost: 350,
    stats: { armor: 16 },
  },
  staff_of_wizardry: {
    id: "staff_of_wizardry",
    name: "Gậy Phù Thủy",
    icon: "item_staff_of_wizardry",
    cost: 550,
    stats: { maxMana: 20, abilityPower: 0.2 },
  },
  void_stone: {
    id: "void_stone",
    name: "Đá Hư Không",
    icon: "item_void_stone",
    cost: 500,
    stats: { manaRegen: 1.2, cooldownReduction: 0.1 },
  },
  ogre_axe: {
    id: "ogre_axe",
    name: "Rìu Ogre",
    icon: "item_ogre_axe",
    cost: 500,
    stats: { maxHealth: 25 },
  },
  mithril_hammer: {
    id: "mithril_hammer",
    name: "Búa Mithril",
    icon: "item_mithril_hammer",
    cost: 500,
    stats: { attackDamage: 10 },
  },
  platemail: {
    id: "platemail",
    name: "Giáp Tấm",
    icon: "item_platemail",
    cost: 550,
    stats: { armor: 34 },
  },
  robe_of_the_magi: {
    id: "robe_of_the_magi",
    name: "Áo Choàng Pháp Sư",
    icon: "item_robe_of_the_magi",
    cost: 500,
    stats: { magicResist: 26, abilityPower: 0.18 },
  },
  vitality_booster: {
    id: "vitality_booster",
    name: "Bình Sinh Lực",
    icon: "item_vitality_booster",
    cost: 500,
    stats: { maxHealth: 30 },
  },

  // ---- Finished --------------------------------------------------------
  blade_mail: {
    id: "blade_mail",
    name: "Blade Mail",
    icon: "item_blade_mail",
    cost: 1_000,
    description:
      'Kích hoạt: phản <span class="buff">70%</span> sát thương nhận vào trong <span class="time">4.5 giây</span>.',
    stats: { attackDamage: 7, armor: 22 },
    active: "Item_BladeMail",
    buildsFrom: ["broadsword", "chainmail"],
  },
  euls_scepter: {
    id: "euls_scepter",
    name: "Eul's Scepter",
    icon: "item_euls_scepter",
    cost: 1_300,
    description:
      'Kích hoạt: cuốn tung một tướng địch <span class="time">1.5 giây</span>.',
    stats: {
      maxMana: 20,
      manaRegen: 1.2,
      speed: 0.3,
      abilityPower: 0.6,
      cooldownReduction: 0.15,
    },
    active: "Item_Euls",
    buildsFrom: ["staff_of_wizardry", "void_stone"],
  },
  black_king_bar: {
    id: "black_king_bar",
    name: "Black King Bar",
    icon: "item_black_king_bar",
    cost: 1_250,
    description:
      'Kích hoạt: gỡ khống chế và thêm <span class="buff">65</span> kháng phép trong <span class="time">6 giây</span>.',
    stats: { maxHealth: 25, attackDamage: 10, magicResist: 30 },
    active: "Item_BlackKingBar",
    buildsFrom: ["ogre_axe", "mithril_hammer"],
  },
  shivas_guard: {
    id: "shivas_guard",
    name: "Shiva's Guard",
    icon: "item_shivas_guard",
    cost: 1_300,
    description:
      'Nội tại: toả hơi lạnh làm chậm <span class="buff">25%</span> mọi kẻ địch trong bán kính <span class="buff">500</span>.',
    stats: { armor: 40, magicResist: 30, abilityPower: 0.55 },
    passive: "Item_ShivasGuard",
    buildsFrom: ["platemail", "robe_of_the_magi"],
  },
  heart_of_tarrasque: {
    id: "heart_of_tarrasque",
    name: "Heart of Tarrasque",
    icon: "item_heart_of_tarrasque",
    cost: 1_300,
    description:
      'Nội tại: sau <span class="time">5 giây</span> không trúng đòn, hồi <span class="buff">5</span> máu mỗi <span class="time">0.5 giây</span>.',
    stats: { maxHealth: 55 },
    passive: "Item_Heart",
    buildsFrom: ["vitality_booster", "ogre_axe"],
  },
});

export const data: ContentPackData = {
  // `coreRange` is the oldest core this pack works against. Core parses
  // exactly two shapes — `*` and `>=X.Y.Z` — and treats anything else as
  // unsatisfiable, so `^1` is not a loose range, it is a pack that refuses to
  // install. This is the only place it is stated: `moba2d-write-manifest`
  // reads it off the built pack for the published manifest.
  // Raised from `>=1.0.0` when this pack grew a shop. `items` did not exist in
  // `ContentPackData` before core 1.3, `buildsFrom` before 1.4, and the two
  // fields the item passives lean on — `Buff.hudVisible` and `Buff.sourceSpell`
  // — before 1.5. An older core does not *fail* on any of them; it ignores what
  // it does not know, which would install this pack with a shop full of items
  // whose passives never come off when sold and whose bookkeeping fills the
  // buff bar. Stating a floor turns that into a refusal a player can read.
  //
  // `>=1.6.0` was the one step this comment could not justify from the
  // content: nothing in this pack used anything 1.6 added — there is no
  // `monsters/` here, so `MonsterAbility.onKilled` (the whole of that bump)
  // was unreachable from it. The floor was held level with core's contract for
  // alignment alone, and the cost was real: a core 1.5 build would have run
  // this pack correctly and was refused anyway.
  //
  // `>=1.7.0` was not that. Five items below grant `abilityPower` or
  // `cooldownReduction`, the two stats that make this pack's abilities scale
  // with a build at all, and core's `ITEM_STAT_KEYS` is an allow-list —
  // `validate.ts` refuses a pack naming a key that is not on it. An older core
  // does not quietly ignore these items, it rejects the whole pack, so the
  // floor is what turns that into a sentence a player can read. The alignment
  // argument above is now redundant rather than load-bearing.
  //
  // `>=1.8.0` adds `ChampionEntry.defence` and `ContentPackData.archetypes` —
  // the durability half of a hero and the taxonomy a hand-built kit picks a
  // body from. `defence` fails the silent way on an older core (every hero back
  // to 100 health, no resistances) and `archetypes` the loud way (an unknown
  // key, so the pack is refused). One floor covers both.
  manifest: {
    id: "dota",
    version: "1.0.0",
    coreRange: ">=1.8.0",
    assets: "dota",
  },
  archetypes: archetypeEntries(),
  champions: [
    {
      id: "pudge",
      name: "Pudge",
      // A key in this pack's own `generated/assetManifest.ts`, never one of
      // core's — see the `pack-asset-key` seam. The key is the file's path
      // under `assets/` with the extension dropped and its folder mapped to a
      // prefix, so `assets/images/champions/pudge.png` is `champ_pudge`. A
      // `playable` champion must have one.
      image: "champ_pudge",
      playable: true,
      // A melee bruiser: he hits hard and slowly, and has to walk to you.
      attack: { damage: 16, attacksPerSecond: 0.85, range: 120 },
      defence: DEFENCE.STRENGTH,
      spells: ["Pudge_Q", "Pudge_W", "Pudge_E", "Pudge_R"],
    },
    {
      id: "lina",
      name: "Lina",
      image: "champ_lina",
      playable: true,
      // A ranged nuker: her damage is in her abilities, not her swing.
      attack: { damage: 12, attacksPerSecond: 0.9, range: 380 },
      defence: DEFENCE.INTELLIGENCE,
      spells: ["Lina_Q", "Lina_W", "Lina_E", "Lina_R"],
    },
    {
      id: "juggernaut",
      name: "Juggernaut",
      image: "champ_juggernaut",
      playable: true,
      // A melee carry: the fastest swing on the roster, and the shortest reach.
      attack: { damage: 15, attacksPerSecond: 1.05, range: 130 },
      defence: DEFENCE.AGILITY,
      spells: ["Juggernaut_Q", "Juggernaut_W", "Juggernaut_E", "Juggernaut_R"],
    },
    {
      id: "crystalmaiden",
      name: "Crystal Maiden",
      image: "champ_crystalmaiden",
      playable: true,
      // A support: the longest reach and the weakest swing.
      attack: { damage: 11, attacksPerSecond: 0.85, range: 400 },
      defence: DEFENCE.INTELLIGENCE,
      spells: [
        "CrystalMaiden_Q",
        "CrystalMaiden_W",
        "CrystalMaiden_E",
        "CrystalMaiden_R",
        // moba2d-pack-add spell: new slot ids go above this line
      ],
    },
    {
      id: "axe",
      name: "Axe",
      image: "champ_axe",
      playable: true,
      // A melee bruiser who wants to be surrounded: he hits hard and slowly,
      // and every ability in the kit is about making people stand next to him.
      attack: { damage: 16, attacksPerSecond: 0.9, range: 125 },
      defence: DEFENCE.STRENGTH,
      spells: ["Axe_Q", "Axe_W", "Axe_E", "Axe_R"],
    },
    {
      id: "vengefulspirit",
      name: "Vengeful Spirit",
      image: "champ_vengefulspirit",
      playable: true,
      // A ranged support: her swing is ordinary and her value is what she does
      // to everyone else's — an aura that pays her whole side, and an ultimate
      // that is pure position.
      attack: { damage: 12, attacksPerSecond: 0.95, range: 390 },
      defence: DEFENCE.INTELLIGENCE,
      spells: [
        "VengefulSpirit_Q",
        "VengefulSpirit_W",
        "VengefulSpirit_E",
        "VengefulSpirit_R",
      ],
    },
    {
      id: "slark",
      name: "Slark",
      image: "champ_slark",
      playable: true,
      // A melee carry who wins the long fight rather than the short one: every
      // swing he lands makes the next one worth more, and his ultimate is what
      // buys him the time to keep swinging.
      attack: { damage: 14, attacksPerSecond: 1.0, range: 125 },
      defence: DEFENCE.AGILITY,
      spells: ["Slark_Q", "Slark_W", "Slark_E", "Slark_R"],
    },
    {
      id: "earthshaker",
      name: "Earthshaker",
      image: "champ_earthshaker",
      playable: true,
      // A melee initiator: the slowest swing on the roster, because none of
      // what he is for happens with his weapon.
      attack: { damage: 15, attacksPerSecond: 0.88, range: 128 },
      defence: DEFENCE.STRENGTH,
      spells: [
        "Earthshaker_Q",
        "Earthshaker_W",
        "Earthshaker_E",
        "Earthshaker_R",
      ],
    },
    {
      id: "sniper",
      name: "Sniper",
      image: "champ_sniper",
      playable: true,
      // The longest reach on the roster before Ngắm Bắn is even pressed, and
      // the weakest body behind it — the whole hero is the argument that range
      // is worth a slot.
      attack: { damage: 13, attacksPerSecond: 0.95, range: 400 },
      defence: DEFENCE.INTELLIGENCE,
      spells: ["Sniper_Q", "Sniper_W", "Sniper_E", "Sniper_R"],
    },
  ],
  spellDisplay: displayData(),
  items: itemEntries(),
};

const code = (api: ContentApi): ContentPackCode => {
  // **First, and before anything reaches a spell module.** Every class in
  // `spells/` is declared against `packApi.ts`'s `api`, so this call is what
  // makes them constructible at all. The loaders below are lazy, so nothing
  // has evaluated yet when this runs.
  setPackApi(api);

  const spells: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    spells[id] = () => load().then((module) => module.default);
  }
  return { spells };
};

export default code;
