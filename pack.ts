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
 * The shop: fifteen components and the twenty-six things they build into.
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

/**
 * A regeneration figure written the way a human reads it, in the unit the
 * engine actually stores.
 *
 * `Stats.update()` adds the whole regen stat **once per frame**, so the stored
 * number is per frame and `manaRegen: 1.2` is seventy-two mana a second against
 * a base of six. All three regen items here were written as per-second figures
 * — a 500-gold stone refilled a 500 pool in seven seconds — and nothing said
 * otherwise, because the shop card printed the stored number raw and so agreed
 * with whoever wrote it.
 *
 * Every call site now says which unit it means, which is the part that was
 * missing rather than the arithmetic.
 */
const perSecond = (amount: number): number => amount / 60;

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
    // +100% of a champion's own 6/s, which is what this stone is in Dota.
    stats: { manaRegen: perSecond(6), abilityHaste: 12 },
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
  ring_of_health: {
    id: "ring_of_health",
    name: "Nhẫn Sức Sống",
    icon: "item_ring_of_health",
    cost: 400,
    // +2.4/s against a champion's own 3.6/s base — Dota's Ring of Health is
    // the same idea, a regen component that two different tank lines share.
    stats: { healthRegen: perSecond(2.4) },
  },
  cloak: {
    id: "cloak",
    name: "Áo Khoác Kháng Phép",
    icon: "item_cloak",
    cost: 400,
    stats: { magicResist: 22 },
  },
  boots_of_speed: {
    id: "boots_of_speed",
    name: "Giày Thần Tốc",
    icon: "item_boots_of_speed",
    cost: 500,
    // Dota's +45 on a ~300 base, converted per `docs/STATS_VS_DOTA.md`:
    // divide the flat figure by 100 for this engine's base of 3.
    stats: { speed: 0.45 },
  },
  gloves_of_haste: {
    id: "gloves_of_haste",
    name: "Găng Tay Nhanh Nhẹn",
    icon: "item_gloves_of_haste",
    cost: 450,
    // The shop's first attack speed, so the conversion is worth restating:
    // this is a share of the wearer's own base rate (IAS 20 -> 0.2), never
    // swings. `tests/statConversion.test.ts` rails it.
    stats: { attackSpeed: 0.2 },
  },
  blades_of_attack: {
    id: "blades_of_attack",
    name: "Lưỡi Dao Tấn Công",
    icon: "item_blades_of_attack",
    cost: 380,
    stats: { attackDamage: 6 },
  },
  energy_booster: {
    id: "energy_booster",
    name: "Ngọc Năng Lượng",
    icon: "item_energy_booster",
    cost: 500,
    stats: { maxMana: 30 },
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
      // Builds from Đá Hư Không and carries its regen, unchanged.
      manaRegen: perSecond(6),
      speed: 0.3,
      abilityPower: 0.6,
      abilityHaste: 18,
    },
    active: "Item_Euls",
    buildsFrom: ["staff_of_wizardry", "void_stone"],
  },
  spirit_vessel: {
    id: "spirit_vessel",
    name: "Bình Hồn",
    icon: "item_spirit_vessel",
    cost: 1_150,
    description:
      'Nội tại: đòn đánh <span class="buff">giảm 45%</span> lượng hồi máu của mục tiêu trong <span class="time">3 giây</span>.',
    // The shop's first answer to sustain. Trái Tim Tarrasque is sold in this
    // same shop and nothing could argue with it until now.
    stats: { maxHealth: 40, armor: 18, manaRegen: perSecond(4) },
    passive: "Item_SpiritVessel",
    buildsFrom: ["vitality_booster", "chainmail"],
  },
  desolator: {
    id: "desolator",
    name: "Kẻ Hủy Diệt",
    icon: "item_desolator",
    cost: 1_200,
    description:
      'Nội tại: đòn đánh <span class="buff">trừ 6 giáp</span> của mục tiêu trong <span class="time">7 giây</span> — cả đội cùng hưởng.',
    // Armour off the *victim*, never penetration on the wearer — see
    // `docs/STATS_VS_DOTA.md`. The whole reason this is drafted is that the
    // rest of the team hits the corroded target harder too.
    stats: { attackDamage: 17 },
    passive: "Item_Desolator",
    buildsFrom: ["mithril_hammer", "broadsword"],
  },
  black_king_bar: {
    id: "black_king_bar",
    name: "Black King Bar",
    icon: "item_black_king_bar",
    cost: 1_250,
    description:
      'Kích hoạt: gỡ khống chế và thêm <span class="buff">65</span> kháng phép trong <span class="time">6 giây</span>.',
    stats: { maxHealth: 25, attackDamage: 10, magicResist: 30, tenacity: 0.25 },
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
  // The 2026-09-05 defensive shelf. The shop sold five finished damage or
  // utility pieces against two real tank items, and an ability build had no
  // answer at all beyond flat resistance — these four are barriers, in two
  // deliberate pairs: a personal wall that rebuilds (Tiên Phong / Mũ Kháng
  // Cự) and a team wall on a button (Vệ Binh Đỏ / Tẩu Thông Tuệ), each pair
  // split physical/magic so which one to buy is a decision about who is
  // killing you.
  vanguard: {
    id: "vanguard",
    name: "Vanguard",
    icon: "item_vanguard",
    cost: 1_100,
    description:
      'Nội tại: mang một lá chắn hấp thụ <span class="buff">12</span> sát thương vật lý; vỡ rồi thì <span class="time">8 giây</span> sau dựng lại.',
    stats: { maxHealth: 35, healthRegen: perSecond(2.4) },
    passive: "Item_Vanguard",
    buildsFrom: ["vitality_booster", "ring_of_health"],
  },
  hood_of_defiance: {
    id: "hood_of_defiance",
    name: "Hood of Defiance",
    icon: "item_hood_of_defiance",
    cost: 1_000,
    description:
      'Nội tại: mang một lá chắn hấp thụ <span class="buff">14</span> sát thương phép; vỡ rồi thì <span class="time">9 giây</span> sau dệt lại.',
    stats: { magicResist: 30, healthRegen: perSecond(2.4) },
    passive: "Item_Hood",
    buildsFrom: ["cloak", "ring_of_health"],
  },
  crimson_guard: {
    id: "crimson_guard",
    name: "Crimson Guard",
    icon: "item_crimson_guard",
    cost: 1_300,
    description:
      'Kích hoạt: bản thân và đồng minh gần nhận lá chắn hấp thụ <span class="buff">15</span> sát thương vật lý trong <span class="time">5 giây</span>.',
    stats: { maxHealth: 35, armor: 40 },
    active: "Item_CrimsonGuard",
    buildsFrom: ["vitality_booster", "platemail"],
  },
  pipe_of_insight: {
    id: "pipe_of_insight",
    name: "Pipe of Insight",
    icon: "item_pipe_of_insight",
    cost: 1_250,
    description:
      'Kích hoạt: bản thân và đồng minh gần nhận lá chắn hấp thụ <span class="buff">15</span> sát thương phép trong <span class="time">5 giây</span>.',
    stats: { magicResist: 50, abilityPower: 0.18 },
    active: "Item_Pipe",
    buildsFrom: ["cloak", "robe_of_the_magi"],
  },
  satanic: {
    id: "satanic",
    name: "Satanic",
    icon: "item_satanic",
    cost: 1_300,
    description:
      'Kích hoạt: trong <span class="time">4 giây</span>, đòn đánh thường hút thêm <span class="buff">50%</span> sát thương gây ra thành máu.',
    stats: { maxHealth: 30, attackDamage: 12, lifesteal: 0.15 },
    active: "Item_Satanic",
    buildsFrom: ["ogre_axe", "broadsword"],
  },
  power_treads: {
    id: "power_treads",
    name: "Power Treads",
    icon: "item_power_treads",
    cost: 1_150,
    // A pure stat item with a recipe — the stat list is the whole card.
    stats: { speed: 0.45, attackSpeed: 0.25, maxHealth: 15 },
    buildsFrom: ["boots_of_speed", "gloves_of_haste"],
  },
  crystalys: {
    id: "crystalys",
    name: "Crystalys",
    icon: "item_crystalys",
    cost: 1_050,
    // Crit chance is a fraction: 0.2 is a one-in-five crit, not 20 points.
    stats: { attackDamage: 15, critChance: 0.2 },
    buildsFrom: ["broadsword", "blades_of_attack"],
  },
  // The 2026-09-05 movement-and-teamplay shelf, landed the same evening as
  // the defensive one. Twelve more rows in four deliberate groups: legs on a
  // button (Force Staff always works, Blink Dagger refuses after a hit — one
  // line, both sides of it), two more team buttons (Mekansm answers damage
  // taken, Drum chooses the fight), the aura family grown to three (Radiance
  // burns outward, Vladmir's feeds inward, beside Shiva's cold), and the
  // right-click shelf completed with Skadi, Basher, Maelstrom, Daedalus and
  // the halberd that switches all four of them off. Octarine Core rounds out
  // the caster line.
  force_staff: {
    id: "force_staff",
    name: "Force Staff",
    icon: "item_force_staff",
    cost: 1_150,
    description:
      'Kích hoạt: đẩy bản thân đi đúng <span class="buff">480</span> theo hướng ' +
      "con trỏ — kể cả khi hướng đó là một sai lầm.",
    stats: { maxMana: 20, abilityPower: 0.25, healthRegen: perSecond(2.4) },
    active: "Item_ForceStaff",
    buildsFrom: ["staff_of_wizardry", "ring_of_health"],
  },
  blink_dagger: {
    id: "blink_dagger",
    name: "Blink Dagger",
    icon: "item_blink_dagger",
    cost: 1_000,
    description:
      'Kích hoạt: dịch chuyển tức thời tới điểm đã chọn, xa nhất <span class="buff">700</span>. ' +
      '<span class="buff">Không dùng được</span> trong <span class="time">3 giây</span> ' +
      "sau khi trúng đòn của kẻ địch.",
    // No stats and no recipe, exactly like the source item: the whole price
    // is the jump. The passive half is the damage sensor the active reads —
    // see `Item_BlinkGate.ts` for why the gate cannot live inside the active.
    passive: "Item_BlinkGate",
    active: "Item_BlinkDagger",
  },
  mekansm: {
    id: "mekansm",
    name: "Mekansm",
    icon: "item_mekansm",
    cost: 1_100,
    description:
      'Kích hoạt: hồi <span class="buff">15</span> máu ngay lập tức cho bản thân ' +
      'và đồng minh trong bán kính <span class="buff">400</span>.',
    stats: { armor: 20, healthRegen: perSecond(2.4) },
    active: "Item_Mekansm",
    buildsFrom: ["chainmail", "ring_of_health"],
  },
  drum_of_endurance: {
    id: "drum_of_endurance",
    name: "Drum of Endurance",
    icon: "item_drum_of_endurance",
    cost: 1_200,
    description:
      'Kích hoạt: bản thân và đồng minh trong bán kính <span class="buff">450</span> ' +
      'chạy nhanh thêm <span class="buff">15%</span> trong <span class="time">5 giây</span>.',
    // Carries the void stone's regen and haste unchanged, plus the ogre axe's
    // bulk — the drum is the tanky caster's second buy, not a boot.
    stats: { maxHealth: 30, manaRegen: perSecond(6), abilityHaste: 12 },
    active: "Item_Drum",
    buildsFrom: ["ogre_axe", "void_stone"],
  },
  radiance: {
    id: "radiance",
    name: "Radiance",
    icon: "item_radiance",
    cost: 1_300,
    description:
      'Nội tại: thiêu đốt mọi kẻ địch trong bán kính <span class="buff">450</span> — ' +
      '<span class="buff">2</span> sát thương phép mỗi <span class="time">0.5 giây</span>.',
    stats: { attackDamage: 18 },
    passive: "Item_Radiance",
    buildsFrom: ["mithril_hammer", "blades_of_attack"],
  },
  eye_of_skadi: {
    id: "eye_of_skadi",
    name: "Eye of Skadi",
    icon: "item_eye_of_skadi",
    cost: 1_300,
    description:
      'Nội tại: đòn đánh thường <span class="buff">làm chậm 25%</span> mục tiêu ' +
      'trong <span class="time">2.5 giây</span>.',
    stats: { maxHealth: 35, maxMana: 30, attackDamage: 8 },
    passive: "Item_Skadi",
    buildsFrom: ["vitality_booster", "energy_booster"],
  },
  daedalus: {
    id: "daedalus",
    name: "Daedalus",
    icon: "item_daedalus",
    cost: 1_300,
    // A pure stat upgrade of Crystalys, and the shop's only single-part
    // recipe: the crit knife sharpened, not a new idea. `critDamage` is a
    // bonus on core's own 1.75x, so this crits at 2.1x.
    stats: { attackDamage: 20, critChance: 0.25, critDamage: 0.35 },
    buildsFrom: ["crystalys"],
  },
  skull_basher: {
    id: "skull_basher",
    name: "Skull Basher",
    icon: "item_skull_basher",
    cost: 1_200,
    description:
      'Nội tại: mỗi đòn đánh thường <span class="buff">thứ 4</span> làm ' +
      '<span class="buff">choáng</span> mục tiêu <span class="time">0.5 giây</span>.',
    stats: { attackDamage: 12, maxHealth: 25 },
    passive: "Item_Basher",
    buildsFrom: ["mithril_hammer", "ogre_axe"],
  },
  octarine_core: {
    id: "octarine_core",
    name: "Octarine Core",
    icon: "item_octarine_core",
    cost: 1_300,
    // The caster's capstone, all on core's own stats — the shop's biggest
    // haste and its first spell vamp, so an ability build finally has a
    // second buy after Eul's. `spellVamp` is a fraction, like the other vamps.
    stats: { maxMana: 55, abilityPower: 0.2, abilityHaste: 30, spellVamp: 0.12 },
    buildsFrom: ["energy_booster", "staff_of_wizardry"],
  },
  maelstrom: {
    id: "maelstrom",
    name: "Maelstrom",
    icon: "item_maelstrom",
    cost: 1_150,
    description:
      'Nội tại: mỗi đòn đánh thường <span class="buff">thứ 3</span> phóng sét — ' +
      '<span class="buff">8</span> sát thương phép lên mục tiêu và tối đa ' +
      '<span class="buff">2</span> kẻ địch đứng gần mục tiêu.',
    stats: { attackDamage: 10, attackSpeed: 0.2 },
    passive: "Item_Maelstrom",
    buildsFrom: ["mithril_hammer", "gloves_of_haste"],
  },
  heavens_halberd: {
    id: "heavens_halberd",
    name: "Heaven's Halberd",
    icon: "item_heavens_halberd",
    cost: 1_200,
    description:
      'Kích hoạt: <span class="buff">tước vũ khí</span> một tướng địch trong ' +
      '<span class="time">2 giây</span> — không đánh thường được, nhưng vẫn ' +
      "đi lại và dùng chiêu.",
    stats: { maxHealth: 30, armor: 16, tenacity: 0.15 },
    active: "Item_Halberd",
    buildsFrom: ["ogre_axe", "chainmail"],
  },
  vladmirs_offering: {
    id: "vladmirs_offering",
    name: "Vladmir's Offering",
    icon: "item_vladmirs_offering",
    cost: 1_100,
    description:
      'Nội tại: bản thân và đồng minh trong bán kính <span class="buff">450</span> ' +
      'được <span class="buff">12%</span> hút máu từ đòn đánh thường.',
    stats: { attackDamage: 8, healthRegen: perSecond(2.4) },
    passive: "Item_Vladmir",
    buildsFrom: ["broadsword", "ring_of_health"],
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
  //
  // `>=1.11.0` is the silent kind again. Core amplifies heals and shields by
  // the caster's ability power now, and reads a `class="heal"` span in a
  // description as a number to rescale — so a heart that regenerates and a
  // shop tuned around ability power both behave differently on a core that
  // has neither, with nothing throwing and nothing to read. A floor is the
  // only way that becomes a sentence.
  //
  // `>=1.22.0` is the loud kind again, and this time by construction. Every
  // damage and heal figure in this pack is written by `api.text.dmg`/`heal`
  // now instead of by a hand-typed `<span class="damage">`, and `api.text`
  // does not exist on an older core — a spell module would throw reading it
  // before the pack finished loading. See `combat/DamageText.ts` in core for
  // what the helpers buy: the number and its damage type are arguments, so a
  // description can no longer forget a type, break its own leading figure, or
  // tag a number that is not a hit — the three ways spans in this pack were
  // silently wrong before.
  // `>=1.16.0` is the loud kind, and it is the same argument `>=1.7.0` made.
  // Core replaced the capped `cooldownReduction` fraction with `abilityHaste`
  // in points, and `ITEM_STAT_KEYS` is an allow-list: the void stone and
  // Eul's, the two items carrying this pack's cooldown scaling, named a key
  // core 1.16 has never heard of, so it refused the *whole pack* rather than
  // dropping two items. There is no build of this pack that runs on both
  // sides of that change, which is exactly what a floor is for. The same core
  // grants an item's `attackSpeed` as a share of the wearer's base rather than
  // in swings — no item in this shop sells attack speed, so that half costs
  // this pack nothing, and `Lina_E` already granted it that way.
  manifest: {
    id: "dota",
    version: "1.4.0",
    coreRange: ">=1.22.0",
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
