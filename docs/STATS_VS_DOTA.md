# Converting Dota 2 into this engine

The engine under this pack is modelled on League of Legends, and Dota 2 keeps
different books. This is the conversion table, so that adding a hero, an ability
or an item is a lookup rather than an argument.

Core's own `docs/STATS_VS_LEAGUE.md` is the other half — it says what each stat
*is* and which slot it lands on. This says what a Dota number becomes on the way
in.

---

## The one rule that makes the rest fall out

**Convert as a share of the health pool, never as a number.**

Damage, health and armour are on completely different scales in the two games,
and no single divisor works across them. The share does:

| | Dota 2 | this pack |
|---|---|---|
| Hero health, early | ~600 | **135–220** (`DEFENCE`) |
| A basic nuke | ~100 (17% of the pool) | **22–30** (11–18%) |
| An ultimate | ~400 against ~1200 (33%) | **40–58** (25–35%) |

So Lina's Dragon Slave at 100 damage does not become 100, and it does not
become "100 ÷ 3.5" either — it becomes *whatever is a sixth of a body here*,
which is about 25. Every number in `spells/` was chosen that way, and the bands
above are what the pack actually ships.

**Time and mana transfer nearly unchanged.** Cooldowns here are 9–22s for a
basic ability and 40–60s for an ultimate, against Dota's own 9–20s and 60–140s
— so a basic ability's cooldown copies straight across and only an ultimate's
needs compressing, roughly by half. Mana costs are 25–125 here against Dota's
75–300: halve them. These are the two axes where a wiki number is nearly usable
as written, which is exactly why they are the two most likely to be copied
wrong in the other direction.

## The stat table

| Dota 2 | What it is there | Here |
|---|---|---|
| **Strength / Agility / Intelligence** | live attributes, growing per level, granting health, armour, attack speed, mana, and damage to the primary one | **Not stats.** One `defence` profile picked at champion definition — `DEFENCE.STRENGTH / AGILITY / INTELLIGENCE` in `pack.ts`. No growth, no per-point damage. A hero's primary attribute is a *body*, chosen once. |
| **Armor** | `0.06·A / (1 + 0.06·|A|)` — diminishing, works negative | `armor` points on core's own curve, `1 + armor/100`. **A different curve; do not copy Dota armour values.** This pack's band is 16–55. |
| **Magic resistance** | a percentage, 25% base for every hero, **multiplicative** between sources | `magicResist` points on the *same* curve as armour, and **additive**. 25 points is about a 20% reduction, which is roughly Dota's base — so a hero with no magic resistance item still wants ~25. |
| **Status resistance** | % off disable durations, multiplicative | `tenacity`, same meaning, **additive**. Core exempts nearsight and suppression and floors every disable at 300ms — Dota exempts a longer list, so a shorter one here is deliberate. |
| **Spell amplification** | % more ability damage | **`abilityPower`.** This is the closest match in the whole table: core's ability power is a *global multiplier at the damage funnel*, not points with per-spell ratios, which is Dota's spell amp exactly. `abilityPower: 0.2` is +20% spell amp. |
| **Spell lifesteal** | % | `spellVamp` |
| **Lifesteal** | % | `lifesteal` |
| **Heal amplification** | % | `healingReceived` |
| **Healing reduction** (Spirit Vessel, Ancient Apparition) | % | the `HealCut` buff. Strongest live one wins; they never sum. |
| **Attack speed (IAS)** | points; roughly `base · (1 + IAS/100)` | `attackSpeed` as a **share of base** — so **divide IAS by 100**. IAS 100 → `attackSpeed: 1.0`. |
| **Cooldown reduction** | a percentage | `abilityHaste` in **points**: `haste = 100·r / (1 − r)`. 25% → 33 haste, 10% → 11. |
| **Movement speed** | flat units on ~300, plus % multipliers, capped at 550 | `speed` flat on a base of **3**, plus `speedPercent`. Divide Dota's flat number by 100; the percent copies straight. |
| **Armor reduction** (Desolator −6) | a flat debuff **on the victim** | `StatAmp` with `armor: { flatBonus: -x }` applied **to the target**. See the rule below. |
| **Magic resistance reduction** (Veil −25%) | a % debuff on the victim | `StatAmp` with `magicResist: { percentBonus: -x }` on the target. |
| **Crit / bash** | chance × multiplier | `critChance` and `critDamage` |
| **HP / mana regen** | per second | `healthRegen` / `manaRegen` are applied **per frame** — multiply a per-second figure by 60, or read `FRAMES_PER_SECOND`. Base health regen is 0.06, i.e. 3.6/s. |
| **Attack range, cast range** | units | `attackRange`, and a spell's own constants |
| **Damage block** (Stout Shield, Vanguard) | flat block per instance | **Not modelled.** The nearest honest thing is a small `Shield` that comes back, not a new stat. |
| **Evasion / miss chance** | % to miss | **Not modelled.** Do not fake it with a slow or a shield — say so in the description instead. |
| **Gold per minute** | — | **Not modelled.** |

## The rule a Dota author will get wrong

**Dota has no attacker-side penetration, and this pack must not use any.**

Core sells `armorPenetration` and `magicPenetration` — shares of the victim's
resistance that *the attacker* ignores, which is League's model. Dota does not
work that way: Desolator, Veil of Discord and Medusa's Mystic Snake all apply a
**debuff to the victim**, which then makes that victim softer to *everyone* on
the map, including the four allies who bought nothing.

That difference is the whole reason those items are picked in a five-man draft,
so collapsing it into attacker-side penetration would delete the interesting
half. Write it as a `StatAmp` on the target — negative `armor.flatBonus` or
negative `magicResist.percentBonus` — and let the rest of the team benefit.

`tests/statConversion.test.ts` enforces this: no item in this shop may grant
either penetration stat. If some future Dota mechanic really is attacker-side,
change the test and say why in its message, rather than quietly adding a key.

## What to do with a stat this engine does not have

Three honest answers, in order of preference:

1. **Express it with what exists.** Damage block is a small recurring shield;
   Break is a `StatAmp` that zeroes the passive's own numbers.
2. **Drop it, and say so in the description.** A hero missing evasion is a hero
   with a different W, which is fine — this pack is inspired by Dota, not a
   port of it.
3. **Ask core for the stat.** Only when several items and several heroes all
   want it, since a new stat is six edits in `Stats.ts` plus five tables, and
   raises this pack's `coreRange`. `abilityHaste`, `tenacity` and the heal cut
   all arrived that way, driven by the other pack.

**Never fake it with a stat that means something else.** The lol pack spent a
release with Vi's armour shred implemented as a movement slow and Garen's
tenacity implemented as omnivamp — both invisible to the compiler, both wrong
in a way only a player noticed, and both found by diffing the implementation
against the record. That is the failure this document exists to prevent.

## What this pack uses today

Measured 2026-09-01, so it is clear how much of core's model is still unclaimed
here:

| Stat | Items | Spells |
|---|---|---|
| `abilityHaste` | 2 | 0 |
| `abilityPower` | 5 | – |
| `attackSpeed` | 0 | 1 (`Lina_E`) |
| everything else new — penetration, tenacity, `healingReceived`, the three vamps, `speedPercent`, `onHitDamage`, crit | **0** | **0** |

The obvious first three, if this shop grows: **Spirit Vessel** (a heal cut, and
Dota's own answer to a regen carry), **Desolator** (flat armour reduction on the
victim, per the rule above) and **Black King Bar**, which already exists and
already removes crowd control on cast — giving it `tenacity` for the duration
would be the record rather than a substitute.
