/**
 * Fetches this pack's champion, ability and neutral-creep art from its real
 * sources, and records where every byte came from.
 *
 * **This is a pack, so third-party art belongs here.** Core carries none — its
 * README's trademark section is explicit that the engine draws every pixel it
 * ships, and that a roster's art "lives in the separate content pack, which is
 * where Riot-derived material belongs". The same line is what puts Valve's
 * Dota 2 art in *this* repository rather than in core: a player installing a
 * Dota pack is told what it contains, and the engine stays installable and
 * redistributable on its own without it.
 *
 * Hero portraits and ability icons come off Steam's own CDN, the same files
 * the Dota 2 client and the official web profile use. Ability icons are
 * already 128x128 and are taken verbatim; hero art only exists as a wide crop
 * (400x250), so it is centre-cropped to a square here rather than squashed —
 * the roster row draws a square and a squashed face reads as a rendering bug.
 *
 * The pack's shelf logo is on this script's ledger too, without being fetched
 * by it — see `LOCAL_ASSETS`.
 *
 * `resolveWikiUrls` is kept, unused by the roster above, for the half of this
 * pack that is not written yet: neutral creeps and Roshan are not on that CDN
 * (it carries heroes and items), and the wiki's own paths carry a content-hash
 * directory (`/7/73/`) nobody can guess, so they have to be resolved by file
 * title through the MediaWiki API. They arrive with the map — a `MonsterDef`
 * is only reachable through a `NeutralSlot`, and a slot's `role` is a *map's*
 * private vocabulary, so a creep with no Dota map to stand on would never
 * spawn anywhere.
 *
 * `--check` re-hashes what is on disk against `assets/source-manifest.json`
 * and touches the network for nothing. That is what `verify` runs, so a build
 * on a machine with no internet still fails loudly when the committed art and
 * the recorded provenance have drifted apart — rather than silently re-fetching
 * and turning a review of "which art changed" into a diff of binary blobs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'assets/source-manifest.json');
const UA = 'moba2d-content-dota art importer (+https://github.com/moba2d-packs/dota)';

const STEAM = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';
const WIKI = 'https://dota2.fandom.com/api.php';

/**
 * The roster, and the only place a hero's four abilities are named.
 *
 * `slug` is Valve's own internal hero name (what the CDN paths use); `local`
 * is what this pack calls the file, and therefore half of its asset key —
 * `assets/images/champions/crystalmaiden.png` is `champ_crystalmaiden`, which
 * is the string `pack.ts` writes. The two differ for exactly one hero, and
 * writing both down is cheaper than a rule about dropping underscores.
 *
 * The four abilities are in Q/W/E/R order, which is the order core reads a
 * `spells: [...]` kit in — not Dota's own ability order, which has no slots.
 */
export const ROSTER = [
  { slug: 'pudge', local: 'pudge', abilities: ['meat_hook', 'rot', 'flesh_heap', 'dismember'] },
  { slug: 'lina', local: 'lina', abilities: ['dragon_slave', 'light_strike_array', 'fiery_soul', 'laguna_blade'] },
  { slug: 'juggernaut', local: 'juggernaut', abilities: ['blade_fury', 'healing_ward', 'blade_dance', 'omni_slash'] },
  { slug: 'crystal_maiden', local: 'crystalmaiden', abilities: ['crystal_nova', 'frostbite', 'brilliance_aura', 'freezing_field'] },
  { slug: 'axe', local: 'axe', abilities: ['berserkers_call', 'battle_hunger', 'counter_helix', 'culling_blade'] },
  { slug: 'vengefulspirit', local: 'vengefulspirit', abilities: ['magic_missile', 'wave_of_terror', 'command_aura', 'nether_swap'] },
  { slug: 'slark', local: 'slark', abilities: ['dark_pact', 'pounce', 'essence_shift', 'shadow_dance'] },
  { slug: 'earthshaker', local: 'earthshaker', abilities: ['fissure', 'enchant_totem', 'aftershock', 'echo_slam'] },
  { slug: 'sniper', local: 'sniper', abilities: ['shrapnel', 'take_aim', 'headshot', 'assassinate'] },
];

const SLOTS = ['q', 'w', 'e', 'r'];

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Resolves wiki file titles to real URLs in one request — the paths are unguessable. */
async function resolveWikiUrls(titles) {
  const query = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
    titles: titles.join('|'),
  });
  const response = await fetch(`${WIKI}?${query}`, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`wiki api: ${response.status} ${response.statusText}`);
  const body = await response.json();
  const out = new Map();
  for (const page of Object.values(body.query?.pages ?? {})) {
    const url = page.imageinfo?.[0]?.url;
    if (url) out.set(page.title, url.split('/revision/')[0]);
  }
  return out;
}

/**
 * Square, without squashing. Valve's hero crop is 400x250 and the wiki's creep
 * icons are 128x72; both are wider than tall, and a `resize(n, n)` on either
 * distorts a face. `cover` takes the centre square instead, which is where the
 * subject of both crops actually is.
 */
const square = (buffer, size) =>
  sharp(buffer).resize(size, size, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9 }).toBuffer();

/** Ability icons arrive at exactly the size the HUD wants, so they are not touched. */
const verbatim = buffer => sharp(buffer).png({ compressionLevel: 9 }).toBuffer();

/**
 * The shelf tile is **committed, not fetched, and not transformed.**
 *
 * Two earlier cuts got this wrong in the same direction. The first was a
 * hand-drawn SVG of a map this pack does not ship. The second took Valve's
 * published logo, cropped the emblem out of the top of it and composited that
 * onto a plate of our own — two decisions this repository has no business
 * making about someone else's mark, and it looked it: the emblem's art is not
 * centred inside its own bounds (the ® hangs off one corner), so a "centred"
 * crop sat visibly off-axis.
 *
 * The file in `public/icon.png` is the Dota 2 logo at exactly the size the
 * tile wants, supplied by the project owner, and it is copied in byte for
 * byte. It still carries a `source-manifest.json` entry so `art:check` hashes
 * it with everything else — the ledger's job is "this file is what it says it
 * is", and a locally-supplied file needs that as much as a fetched one. It
 * simply has no `sourceUrl`, which is the honest record of where it came from.
 */
const LOCAL_ASSETS = [
  {
    localPath: 'public/icon.png',
    // Not an `AssetManager` key: core's packs screen hot-links this file off
    // the pack's published root, which is why it lands in `public/` — the one
    // directory Vite copies verbatim — and never under `assets/`.
    localAssetKey: null,
    note: 'Dota 2 logo, supplied by the project owner. Property of Valve Corporation.',
  },
];

async function main() {
  const check = process.argv.includes('--check');

  if (check) {
    if (!existsSync(MANIFEST)) {
      console.error('import-art --check: assets/source-manifest.json is missing. Run `npm run art:import`.');
      process.exit(1);
    }
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const problems = [];
    for (const entry of manifest.sources) {
      const path = join(root, entry.localPath);
      if (!existsSync(path)) {
        problems.push(`${entry.localPath} — recorded but not on disk`);
        continue;
      }
      const actual = sha256(readFileSync(path));
      if (actual !== entry.contentHash) problems.push(`${entry.localPath} — content does not match the recorded hash`);
    }
    if (problems.length) {
      console.error(`import-art --check: ${problems.length} problem(s):`);
      for (const problem of problems) console.error('  ' + problem);
      console.error('Run `npm run art:import` and commit the art together with the manifest.');
      process.exit(1);
    }
    console.log(`import-art --check: ${manifest.sources.length} asset(s) match their recorded source`);
    return;
  }

  const wanted = [];
  for (const hero of ROSTER) {
    wanted.push({
      url: `${STEAM}/heroes/crops/${hero.slug}.png`,
      localPath: `assets/images/champions/${hero.local}.png`,
      localAssetKey: `champ_${hero.local}`,
      transform: buffer => square(buffer, 256),
    });
    hero.abilities.forEach((ability, index) => {
      wanted.push({
        url: `${STEAM}/abilities/${hero.slug}_${ability}.png`,
        localPath: `assets/images/spells/${hero.local}_${SLOTS[index]}.png`,
        localAssetKey: `spell_${hero.local}_${SLOTS[index]}`,
        transform: verbatim,
      });
    });
  }

  const sources = [];
  for (const item of wanted) {
    const raw = await download(item.url);
    const png = await item.transform(raw);
    const path = join(root, item.localPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    sources.push({
      contentHash: sha256(png),
      fetchedAt: new Date().toISOString(),
      localAssetKey: item.localAssetKey,
      localPath: item.localPath,
      sourceHash: sha256(raw),
      sourceUrl: item.url,
    });
    console.log(`  ${item.localPath}  <-  ${item.url}`);
  }

  // Hashed, never downloaded — see `LOCAL_ASSETS`.
  for (const local of LOCAL_ASSETS) {
    const path = join(root, local.localPath);
    if (!existsSync(path)) {
      console.error(`import-art: ${local.localPath} is missing and cannot be fetched — it is a committed file.`);
      process.exit(1);
    }
    const bytes = readFileSync(path);
    sources.push({
      contentHash: sha256(bytes),
      fetchedAt: new Date().toISOString(),
      localAssetKey: local.localAssetKey,
      localPath: local.localPath,
      note: local.note,
      sourceHash: sha256(bytes),
      sourceUrl: null,
    });
    console.log(`  ${local.localPath}  <-  committed`);
  }

  sources.sort((a, b) => a.localPath.localeCompare(b.localPath));
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        schemaVersion: 1,
        note:
          'Dota 2 art, fetched from Valve\'s own CDN and the Dota 2 wiki. Dota 2 and all related ' +
          'trademarks and artwork are the property of Valve Corporation; this pack is an unofficial, ' +
          'non-commercial fan project and claims no ownership of them. See README.md.',
        sources,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`import-art: ${sources.length} asset(s) written, provenance in assets/source-manifest.json`);
}

await main();
