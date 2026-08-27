import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type {
  ContentPackCode,
  ContentPackData,
  ItemDef,
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
    if (id.startsWith('Item_')) continue;
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
const itemEntries = (): Record<string, ItemDef> => ({
  // ---- Components ------------------------------------------------------
  broadsword: {
    id: 'broadsword',
    name: 'Kiếm Lớn',
    icon: 'item_broadsword',
    cost: 450,
    description: 'Tăng 7 sát thương công.',
    stats: { attackDamage: 7 },
  },
  chainmail: {
    id: 'chainmail',
    name: 'Giáp Xích',
    icon: 'item_chainmail',
    cost: 350,
    description: 'Tăng 16 giáp.',
    stats: { armor: 16 },
  },
  staff_of_wizardry: {
    id: 'staff_of_wizardry',
    name: 'Gậy Phù Thủy',
    icon: 'item_staff_of_wizardry',
    cost: 450,
    description: 'Tăng 20 năng lượng tối đa.',
    stats: { maxMana: 20 },
  },
  void_stone: {
    id: 'void_stone',
    name: 'Đá Hư Không',
    icon: 'item_void_stone',
    cost: 400,
    description: 'Tăng 1.2 hồi năng lượng.',
    stats: { manaRegen: 1.2 },
  },
  ogre_axe: {
    id: 'ogre_axe',
    name: 'Rìu Ogre',
    icon: 'item_ogre_axe',
    cost: 500,
    description: 'Tăng 25 máu tối đa.',
    stats: { maxHealth: 25 },
  },
  mithril_hammer: {
    id: 'mithril_hammer',
    name: 'Búa Mithril',
    icon: 'item_mithril_hammer',
    cost: 500,
    description: 'Tăng 10 sát thương công.',
    stats: { attackDamage: 10 },
  },
  platemail: {
    id: 'platemail',
    name: 'Giáp Tấm',
    icon: 'item_platemail',
    cost: 550,
    description: 'Tăng 26 giáp.',
    stats: { armor: 26 },
  },
  robe_of_the_magi: {
    id: 'robe_of_the_magi',
    name: 'Áo Choàng Pháp Sư',
    icon: 'item_robe_of_the_magi',
    cost: 350,
    description: 'Tăng 16 kháng phép.',
    stats: { magicResist: 16 },
  },
  vitality_booster: {
    id: 'vitality_booster',
    name: 'Bình Sinh Lực',
    icon: 'item_vitality_booster',
    cost: 500,
    description: 'Tăng 30 máu tối đa.',
    stats: { maxHealth: 30 },
  },

  // ---- Finished --------------------------------------------------------
  blade_mail: {
    id: 'blade_mail',
    name: 'Blade Mail',
    icon: 'item_blade_mail',
    cost: 1_000,
    description:
      'Tăng 7 sát thương công và 16 giáp. Kích hoạt: phản 70% sát thương nhận vào trong 4.5 giây.',
    stats: { attackDamage: 7, armor: 16 },
    active: 'Item_BladeMail',
    buildsFrom: ['broadsword', 'chainmail'],
  },
  euls_scepter: {
    id: 'euls_scepter',
    name: "Eul's Scepter",
    icon: 'item_euls_scepter',
    cost: 1_100,
    description:
      'Tăng 20 năng lượng tối đa, 1.2 hồi năng lượng và 0.3 tốc chạy. Kích hoạt: cuốn tung một tướng địch 1.5 giây.',
    stats: { maxMana: 20, manaRegen: 1.2, speed: 0.3 },
    active: 'Item_Euls',
    buildsFrom: ['staff_of_wizardry', 'void_stone'],
  },
  black_king_bar: {
    id: 'black_king_bar',
    name: 'Black King Bar',
    icon: 'item_black_king_bar',
    cost: 1_250,
    description:
      'Tăng 25 máu tối đa và 10 sát thương công. Kích hoạt: gỡ khống chế và +65 kháng phép trong 6 giây.',
    stats: { maxHealth: 25, attackDamage: 10 },
    active: 'Item_BlackKingBar',
    buildsFrom: ['ogre_axe', 'mithril_hammer'],
  },
  shivas_guard: {
    id: 'shivas_guard',
    name: "Shiva's Guard",
    icon: 'item_shivas_guard',
    cost: 1_300,
    description:
      'Tăng 26 giáp và 16 kháng phép. Nội tại: toả hơi lạnh làm chậm 25% mọi kẻ địch trong bán kính 500.',
    stats: { armor: 26, magicResist: 16 },
    passive: 'Item_ShivasGuard',
    buildsFrom: ['platemail', 'robe_of_the_magi'],
  },
  heart_of_tarrasque: {
    id: 'heart_of_tarrasque',
    name: 'Heart of Tarrasque',
    icon: 'item_heart_of_tarrasque',
    cost: 1_300,
    description:
      'Tăng 55 máu tối đa. Nội tại: sau 5 giây không trúng đòn, hồi 5 máu mỗi 0.5 giây.',
    stats: { maxHealth: 55 },
    passive: 'Item_Heart',
    buildsFrom: ['vitality_booster', 'ogre_axe'],
  },
});

export const data: ContentPackData = {
  // `coreRange` is the oldest core this pack works against. Core parses
  // exactly two shapes — `*` and `>=X.Y.Z` — and treats anything else as
  // unsatisfiable, so `^1` is not a loose range, it is a pack that refuses to
  // install. `scripts/write-manifest.mjs` states the same floor for the
  // published manifest; raise both together.
  // Raised from `>=1.0.0` when this pack grew a shop. `items` did not exist in
  // `ContentPackData` before core 1.3, `buildsFrom` before 1.4, and the two
  // fields the item passives lean on — `Buff.hudVisible` and `Buff.sourceSpell`
  // — before 1.5. An older core does not *fail* on any of them; it ignores what
  // it does not know, which would install this pack with a shop full of items
  // whose passives never come off when sold and whose bookkeeping fills the
  // buff bar. Stating a floor turns that into a refusal a player can read.
  //
  // Now `>=1.6.0`, and that last step is the one this comment cannot justify
  // from the content: nothing here uses anything 1.6 added — there is no
  // `monsters/` in this pack, so `MonsterAbility.onKilled` (the whole of the
  // 1.6 contract bump) is unreachable from it. The floor is held level with
  // core's current contract on purpose, so every pack in this workspace states
  // one number. The cost is real and worth naming: a core 1.5 build would run
  // this pack correctly and is now refused anyway. Drop back to `>=1.5.0` the
  // day that matters more than the alignment does.
  manifest: { id: 'dota', version: '1.0.0', coreRange: '>=1.6.0', assets: 'dota' },
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
    {
      id: 'axe',
      name: 'Axe',
      image: 'champ_axe',
      playable: true,
      // A melee bruiser who wants to be surrounded: he hits hard and slowly,
      // and every ability in the kit is about making people stand next to him.
      attack: { damage: 16, attacksPerSecond: 0.9, range: 125 },
      spells: ['Axe_Q', 'Axe_W', 'Axe_E', 'Axe_R'],
    },
    {
      id: 'vengefulspirit',
      name: 'Vengeful Spirit',
      image: 'champ_vengefulspirit',
      playable: true,
      // A ranged support: her swing is ordinary and her value is what she does
      // to everyone else's — an aura that pays her whole side, and an ultimate
      // that is pure position.
      attack: { damage: 12, attacksPerSecond: 0.95, range: 390 },
      spells: [
        'VengefulSpirit_Q',
        'VengefulSpirit_W',
        'VengefulSpirit_E',
        'VengefulSpirit_R',
      ],
    },
    {
      id: 'slark',
      name: 'Slark',
      image: 'champ_slark',
      playable: true,
      // A melee carry who wins the long fight rather than the short one: every
      // swing he lands makes the next one worth more, and his ultimate is what
      // buys him the time to keep swinging.
      attack: { damage: 14, attacksPerSecond: 1.0, range: 125 },
      spells: ['Slark_Q', 'Slark_W', 'Slark_E', 'Slark_R'],
    },
    {
      id: 'earthshaker',
      name: 'Earthshaker',
      image: 'champ_earthshaker',
      playable: true,
      // A melee initiator: the slowest swing on the roster, because none of
      // what he is for happens with his weapon.
      attack: { damage: 15, attacksPerSecond: 0.88, range: 128 },
      spells: ['Earthshaker_Q', 'Earthshaker_W', 'Earthshaker_E', 'Earthshaker_R'],
    },
    {
      id: 'sniper',
      name: 'Sniper',
      image: 'champ_sniper',
      playable: true,
      // The longest reach on the roster before Ngắm Bắn is even pressed, and
      // the weakest body behind it — the whole hero is the argument that range
      // is worth a slot.
      attack: { damage: 13, attacksPerSecond: 0.95, range: 400 },
      spells: ['Sniper_Q', 'Sniper_W', 'Sniper_E', 'Sniper_R'],
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
    spells[id] = () => load().then(module => module.default);
  }
  return { spells };
};

export default code;
