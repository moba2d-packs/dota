# Working on this pack

Recipes for changing `@moba2d/content-dota`. Written to be followed
literally — by a person or by an agent — without reading the engine first.

`README.md` says what each file is. This says what to do.

**One rule above all the others:** run `npm run verify` before you say you are
done. It is `art:check`, `icons:check`, `assets:check`, `catalog:check`,
`typecheck`, `check-unused`, `check-seams`, the build, and the tests. Every
trap below is something it catches; none of them are things you will notice by
looking.

---

## Add an ability

```bash
npx moba2d-pack-add spell Firebolt --champion Hero --slot W
```

Writes `spells/Hero_W.ts` and `tests/Hero_W.test.ts`, and adds the export to
`spells/index.ts`. **That barrel line is the whole registration** — the
catalogue generator reads the barrel to write `generated/spellCatalog.ts` (the
name, cooldown and mana core's HUD reads) and `generated/spellModules.ts` (the
lazy `id -> import()` map the game loads from). One export reaches all three.

Then, by hand:

1. Put the id in the champion's kit in `pack.ts` — `spells: ['Hero_Q', …]`.
   A **playable** champion needs exactly four, in `Q W E R` order.
2. Write the ability. Start from the generated file; it extends
   `api.MissileSpellObject` and shows the shape.
3. `npm run verify`.

## Change what an ability does

Edit `spells/<Champion>_<Slot>.ts` and its test together. Nothing else — the
numbers a player sees come off the class at build time, so `pack.ts` restates
none of them and neither does any doc.

**Export tuning values as constants** so the test imports them:

```ts
export const FIREBOLT_DAMAGE = 22;
```

Retuning damage must not mean editing a test.

## Remove an ability

1. Delete `spells/<Champion>_<Slot>.ts` and its test.
2. Delete its line from `spells/index.ts`.
3. Delete its id from the champion's `spells` array in `pack.ts`.
4. `npm run verify` — `catalog:check` fails if you missed step 2, and
   `packInstallable` fails if a playable champion is left with three abilities.

## Add a champion

No generator for this one yet. By hand:

1. Four abilities, as above.
2. A portrait: add the hero to `scripts/import-art.mjs`'s `ROSTER` and run
   `npm run art:import && npm run assets:generate`. The key is the path under
   `assets/` with the extension dropped and the folder mapped to a prefix, so
   `assets/images/champions/pudge.png` is `champ_pudge` — and stays
   `champ_pudge` when the build re-encodes it to WebP.
3. A row in `pack.ts`'s `champions`, with `playable: true`, the `image` key
   from step 2, an `attack` profile, and the four ids.

Core refuses to install a playable champion with no portrait or without
exactly four abilities, and says which one is wrong.

## Add an item

An item's `passive` and `active` are **ordinary spells**, from the same barrel
a champion's abilities come from. That is the whole mechanism; everything
below is what keeps one from also behaving like an ability.

1. Write `spells/Item_<Name>.ts` and its test, and export it from
   `spells/index.ts` — same as any spell. `manaCost = 0`, and a passive has
   `coolDown = 0` too.
2. Art: add a row to `scripts/import-art.mjs`'s `ITEMS` table, then
   `npm run art:import && npm run assets:generate`. The key is
   `item_<local>` — singular `item`, because the generator maps the folder
   that way and `items_foo` is a plural nobody guesses.
3. A row in `pack.ts`'s `itemEntries()`: `id`, `name`, `icon`, `cost`, a
   Vietnamese `description`, optional `stats`, and `passive`/`active` naming
   the local spell ids. `buildsFrom` is the recipe.
4. `npm run verify`.

**Never put an item's spell id in a champion's `spells: [...]`.** That would
be one spell wearing two prices — an ability a champion casts for free and an
item the shop charges for. `tests/items.test.ts` fails if you do.

**`cost` is the total, written once.** What a player pays when the parts are
already in the bag is `cost` minus the parts, worked out by core's
`ItemShop.priceFor`. A separate combine cost is the same fact in two places,
and they drift on the first retune. Core refuses a total under the sum of its
parts.

## Remove a champion

Delete its four spell files and tests, its four lines from `spells/index.ts`,
its row from `pack.ts`, and its art from `assets/`. Then
`npm run assets:generate && npm run verify`.

## Add art

**Art in this pack is fetched, not dropped in.** `assets/images/` is written
entirely by `npm run art:import`, which pulls hero portraits and ability icons
from Valve's own CDN and records the URL and a content hash per file in
`assets/source-manifest.json`. To add a hero's art, add a row to that script's
`ROSTER` table (Valve's internal hero slug, this pack's local name, and the
four ability slugs in Q/W/E/R order) and re-run it; then
`npm run assets:generate` to regenerate the typed key union.

`npm run art:check` is the offline half — it re-hashes what is committed
against the manifest and fails when the two have drifted. It is in `verify`,
so a machine with no network still catches art and provenance coming apart.
**Commit the art and the manifest together**, always.

The one hand-drawn image is `tools/icons/pack/icon.svg`, the shelf logo core's
packs screen hot-links off this pack's published root. Its SVG is the source;
edit it, run `npm run icons:render`, commit both halves, and `icons:check`
fails if they drift.

Use **this pack's own keys**, never one of core's. `check-seams` enforces it:
reusing a key that happens to exist in core's art is a pack that draws the
engine's pictures.

## Publish

```bash
git push
```

`.github/workflows/publish.yml` builds and deploys to GitHub Pages on every
push to the default branch. Players install from
`https://<owner>.github.io/<repo>/manifest.json`.

Nothing to bump by hand. `scripts/write-manifest.mjs` derives `buildId` from
the file list, core hangs it off the entry URL, and a player whose installed
copy is older is offered the update.

---

## Traps

Each of these has cost real time, and none is visible from the file you are
editing.

**Never `import { Spell } from '@moba2d/core'`.** Not once, not in a test.
The pack builds with core marked `external` and publishes its own `pack.js`,
which a browser `import()`s from another origin — a surviving value import is
a bare specifier nothing resolves. The engine *arrives* instead, through
`packApi.ts`: `export default class Firebolt extends api.Spell {}`. `import
type` is fine; the compiler erases it.

**`generated/` is written, not authored.** Editing a file in there is undone
by the next `assets:generate` or `catalog:generate`, both of which `prepare`
runs after every install, and `verify` fails when the two disagree.

**A `UNIT` spell must declare `targetingRequest: { targetTeam: 'ENEMY' }`.**
Omit it and targeting defaults to `'ANY'`, which includes the caster — with
the cursor on empty ground the nearest-target fallback resolves *her*, and the
spell dashes to and damages its own caster. Four abilities shipped that way in
the largest pack there is before anyone noticed.

**Spend mana through `spendMana()` and read range through `Reach`.** Touching
`stats.mana` directly opts out of the match rules that make URF work;
`check-seams` bans the name from `spells/`.

**Art keys strip the extension.** `assets/champ_hero.png` and
`assets/champ_hero.webp` are the same key, which is what lets the build
re-encode art without touching a line of code — and also means two files with
the same stem are a duplicate-key error.

**Ship art as files, not as data URIs.** `vite.config.ts` sets
`assetsInlineLimit: 0` on purpose: `pack.js` is downloaded before the menu can
draw, and inlined art puts every champion's portrait in it to play a match
that needs four.

**Label your damage.** `takeDamage(amount, this.owner, 'MAGIC', 'Tên Chiêu')`
— damage type (`'PHYSICAL' | 'MAGIC' | 'TRUE'`), then the player-facing
source label core's death-recap modal groups by. Damage without them shows as
"Không rõ". Tests spying on `takeDamage` match the trailing args with
`expect.any(String)`, or `.slice(0, 2)` the call — never restate the label.

**A re-applied Slow must `RENEW_EXISTING`.** `Slow`'s default add type stacks
ten deep, so an aura or zone re-applying per tick turns "40% slow" into a
standstill. One slow, clock rewound:
`slow.buffAddType = api.enums.BuffAddType.RENEW_EXISTING`.

**An item's spell must stay out of `spellDisplay`.** That map is what a
loadout screen offers as a *choosable ability*, so an item's active left in it
gets handed to a player who never bought the item. `pack.ts`'s `displayData()`
skips anything named `Item_*`; keep the prefix, and do not replace the check
with a list — the next item is the one that gets left off it.

**A pack with items needs `coreRange: '>=1.5.0'`.** `items` did not exist in
`ContentPackData` before core 1.3, `buildsFrom` before 1.4, and
`Buff.hudVisible`/`Buff.sourceSpell` before 1.5. An older core does not fail
on any of them — it *ignores* what it does not know, and installs a shop whose
passives never come off when sold. `pack.ts` and `scripts/write-manifest.mjs`
state that floor separately and must move together.

**A bookkeeping buff hides itself.** An item passive's internal state sets
`hudVisible = false`, or every purchase adds a row to the buff bar.
`duration = 0` means permanent and draws no countdown.

**`interrupts:` — only `SpellForm.CHANNELED` breaks on the caster's own
movement.** `AIMED`/`HELD`/`TETHERED` survive moving and blinks and break
only on death, stun or silence — that is what keeps cast-then-blink combos
playable. Reserve `CHANNELED` for a true channel (a teleport, a Recall-like).

**Use `Dash.onDashUpdate`, never `dashBuff.onUpdate = …`.** The instance
assignment replaces the dash's own movement instead of hooking it, and the
hero plays the spell standing still.

**"Player is not available in this test context" is usually not the error.**
Vitest's failure printer walks the test game and trips its throwing `player`
getter while serialising an ordinary assertion diff. The real failure is the
assertion above it — read the whole output before touching the fixture.

**A gitignored lockfile still pins.** `package-lock.json` is untracked here
but real on disk: `npm install` resolves `@moba2d/core`'s git dependency to
whatever commit the *local* lockfile recorded, however old — this checkout
sat on a core four minors stale that way while its spec said `#main`, which
made items structurally impossible. To actually pick up core's current
`#main`, run `npm update @moba2d/core`. CI never has the lockfile, so it
resolves fresh every run — which is exactly why the drift only ever shows up
locally.

**`npm install` (and any `bun install`) stomps a dev link.** While this pack
is linked to a local core checkout (`npm run pack:link` from core), an
install here silently replaces the symlink with the npm copy.
`scripts/check-core-link.mjs` (first step of `verify`, warn-only on
`postinstall`) is what tells you; `npm run pack:link` from core is the
repair. The pre-push hook (`npm run hooks:install`, once per clone) runs the
full `verify`; `git push --no-verify` or `MOBA2D_SKIP_VERIFY=1 git push`
skips it once, deliberately.

---

## Two things this pack decided, that a reader will otherwise undo

**`vitest.setup.ts` registers the real asset manifest, not `{}`.** The scaffold
hands `installPackForTests` an empty object, which is correct for exactly as
long as no spell has an icon: `api.asset(key)` throws `Unknown asset key` at
*class construction* time, so the first ability that declares
`image = api.asset(...)` — which is every real one — takes every test in the
pack down with it, from a stack pointing at `AssetManager` rather than at the
setup file. Do not put the `{}` back.

**There is no map here, on purpose.** See README. `maps` is optional in
`ContentPackData` and these heroes play on whatever map is installed. When the
Dota map is eventually traced from the real minimap, the neutral creeps land
with it and not before: a `MonsterDef` is only reachable through a
`NeutralSlot`, and a slot's `role` is a *map's* private vocabulary, so a creep
with no map under it never spawns anywhere. `scripts/import-art.mjs` still
carries `resolveWikiUrls` for exactly that day — the creep art is not on
Valve's CDN, and the wiki's own paths carry an unguessable content-hash
directory.
