# Dota 2 content pack for MOBA2D

[![Verify](https://github.com/moba2d-packs/dota/actions/workflows/verify.yml/badge.svg)](https://github.com/moba2d-packs/dota/actions/workflows/verify.yml)

Four Dota 2 heroes and their kits, built against [`@moba2d/core`](https://github.com/moba2d-game/core)'s public `ContentApi` and installed into the game from a URL at runtime. Nothing here is compiled into the engine.

**Install it:** open the game, go to **Tìm pack**, and paste

```
https://moba2d-packs.github.io/dota/manifest.json
```

## What is in it

| Hero | Q | W | E | R |
|---|---|---|---|---|
| **Pudge** | Móc Thịt — a chain that drags the first thing it catches back to him | Rữa Nát — a cloud he carries that hurts everything near him, himself included | Chồng Thịt — a shield worth more the more of them are around him | Xẻ Thịt — he takes hold of one enemy and drains them |
| **Lina** | Thiêu Rồng — a wave of fire down a line, piercing everything in it | Trận Địa Sáng — a delayed column of fire that stuns | Hồn Lửa — she burns faster for a few seconds | Lôi Quang Kiếm — one bolt, one enemy, a great deal of damage |
| **Juggernaut** | Cuồng Đao — he spins, and cannot swing while he does | Cột Hồi Máu — a ward that heals allies and can be killed | Vũ Đao — his basic attacks bite harder for a while | Đao Vô Song — he blinks between enemies, striking four times |
| **Crystal Maiden** | Tân Tinh — a burst of ice that damages and slows an area | Băng Giá — one enemy is frozen in place and bleeds cold | Hào Quang Pháp Thuật — allies near her get their mana back | Băng Trường — she stands still and the ground around her explodes |

Damage is scaled to this engine's ~100 health pool, not to Dota's own numbers: a normal ability lands 15–35 and an ultimate 40–60. Ranges are scaled to the canvas rather than to a 2D-projected Dota map. So the abilities *behave* like their originals and none of the numbers are the originals — that is deliberate, and `docs/VFX_STANDARD.md` in core is the bar they were written against.

## No map, yet

This pack ships **no map**, and that is a decision rather than an omission. `maps` is optional in `ContentPackData`, so these heroes play on whatever map is installed.

A map here would have to be Dota's map, and the way the League pack got Summoner's Rift is by tracing the real minimap polygon by polygon — which is why it reads as that map instead of as an arena with three lines drawn through it. Generating a plausible-looking diamond with a river across it was tried, looked fine in a preview, and was thrown away: it is not the map, and a map that is *nearly* right is worse than no map at all, because a player who knows the real one will keep walking into walls that are not where they should be.

The neutral creeps wait with it. A `MonsterDef` is only ever reachable through a `NeutralSlot`, and a slot's `role` is a *map's* private vocabulary — so Roshan with no Dota map under him would never spawn anywhere.

## Working on it

Requires Node 20+ and nothing else installed.

```bash
git clone https://github.com/moba2d-packs/dota.git
cd dota
npm install
npm run verify
```

`verify` is the whole offline gate and exactly what CI runs: art provenance, the shelf logo, the asset manifest, the spell catalogue, the type-check, the unused-export scan, the seam scan, the published build, and the tests.

| Script | What it does |
|---|---|
| `npm run verify` | Everything CI runs. Do this before opening a PR |
| `npm test` | The unit suite (`npx vitest run tests/Pudge_Q.test.ts` for one file) |
| `npm run build` | Builds `dist/` and writes `dist/manifest.json` |
| `npm run art:import` | Re-fetches every champion image and ability icon from its real source |
| `npm run art:check` | Offline: re-hashes the committed art against `assets/source-manifest.json` |
| `npm run check-seams` | The source-scan rules — `pack-core-boundary`, `pack-asset-key`, and the rest |

Adding an ability is `npx moba2d-pack-add spell <Name> --champion <Hero> --slot <Slot>`, but note a **playable** champion's kit is full at four: core refuses to install a fifth. [`docs/PACK_AUTHORING.md`](https://github.com/moba2d-game/core/blob/main/docs/PACK_AUTHORING.md) in core is the whole guide, and [`docs/ADDING_SPELLS.md`](https://github.com/moba2d-game/core/blob/main/docs/ADDING_SPELLS.md) is the spell mechanism.

### Two things that will bite you

- **A pack may not value-import core.** `import { api } from './packApi'` is the only door; `import type` is fine because it erases. The pack is built with `@moba2d/core` marked `external` and `import()`ed cross-origin, so a surviving bare specifier is a module nothing can resolve. `check-seams` fails the build over it.
- **`pack.ts`'s data half must never import a spell.** It is read before any `ContentApi` exists. The numbers in it come from `generated/spellCatalog.ts`, which the generator produced by constructing each spell once at build time.

## Trademarks and art

This is a non-commercial, unofficial fan project. It is **not affiliated with, authorised by, or endorsed by [Valve Corporation](https://www.valvesoftware.com/)**, and it generates no revenue.

Dota 2, its heroes, their names, their ability names, and all the artwork in `assets/images/` are the property of Valve Corporation. This repository claims no ownership over any of it.

**Every image here is fetched, not redrawn, and every one records where it came from.** `npm run art:import` pulls hero portraits and ability icons from Valve's own CDN — the same files the Dota 2 client and the official web profile serve — and writes `assets/source-manifest.json` with the URL and a content hash per file. `npm run art:check` re-hashes what is committed against that manifest offline, so the art and its provenance cannot drift apart unnoticed.

That art lives here rather than in the engine on purpose. Core carries no third-party material at all — it draws every pixel it ships, so it stays installable and redistributable on its own — and this repository is the half where a licensed roster belongs. The game's packs screen names this pack for what it contains, because a player deciding whether to install something has to know what is in it.

The shelf logo is the Dota 2 logo, committed rather than fetched and copied byte for byte — nothing cropped, nothing painted behind it. It is on the same ledger as everything else, with no `sourceUrl`, which is the honest record of a file supplied by hand. It was a hand-drawn SVG of a map until this: a tile is what a player looks at to answer "which game is this", and a drawing of a map this pack does not ship yet was the wrong answer.
