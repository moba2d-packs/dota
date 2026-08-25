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
 * The pack's shelf logo is imported here too, and it is why this script owns
 * the file rather than a `render-icons` step beside it: the tile used to be a
 * hand-drawn SVG of the map, which is a picture of something this pack does
 * not ship (the map is not written yet) wearing the place a player looks for
 * "which game is this". Valve's own Dota 2 emblem is the answer to that
 * question, and once the tile is Valve's art it belongs on the same provenance
 * ledger as the portraits.
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
/** Where Valve publishes the game's own logo, as opposed to its hero and ability art. */
const STEAM_BLOG = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/blog/play';
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

/** The shelf tile's edge, in px. Core hot-links this file straight off the pack's root. */
const ICON_SIZE = 256;

/**
 * The shelf tile: Valve's emblem on a plate of our own.
 *
 * Valve publishes the logo as one wide image — the emblem stacked over the
 * "DOTA 2" wordmark, 352x206 — and a shelf tile is a square. The wordmark is
 * what loses: it is unreadable at 256px, the tile sits beside the pack's name
 * already, and the emblem alone is the half that is recognisable at a glance.
 * So the top of the source is extracted and trimmed to whatever the mark
 * actually occupies, rather than to hard-coded pixels that would silently
 * mis-crop the day Valve re-exports the file.
 *
 * The ® stays in the crop. It is part of the mark, and a fan project trimming
 * a trademark symbol off someone else's logo is the wrong instinct.
 *
 * The plate underneath is this pack's own: Dota's near-black with a warm cast,
 * rounded the same 52px the previous hand-drawn tile used, so the shelf's
 * geometry does not shift.
 */
async function shelfIcon(buffer) {
  const { width } = await sharp(buffer).metadata();
  // The top 60% of the source is the emblem; `trim` finds its real edges
  // inside that band, so the number only has to be "above the wordmark".
  const band = await sharp(buffer)
    .extract({ left: 0, top: 0, width, height: Math.round(206 * 0.59) })
    .toBuffer();
  const mark = await sharp(band)
    .trim({ threshold: 1 })
    .resize(Math.round(ICON_SIZE * 0.62), Math.round(ICON_SIZE * 0.62), {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
       <defs>
         <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#1a1512"/>
           <stop offset="1" stop-color="#2b1410"/>
         </linearGradient>
       </defs>
       <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="52" fill="url(#p)"/>
     </svg>`
  );

  return sharp(plate)
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

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

  const wanted = [
    {
      url: `${STEAM_BLOG}/dota_logo.png`,
      localPath: 'public/icon.png',
      // Not an `AssetManager` key: core's packs screen hot-links this file off
      // the pack's published root, which is why it lands in `public/` — the one
      // directory Vite copies verbatim — and never under `assets/`.
      localAssetKey: null,
      transform: shelfIcon,
    },
  ];
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
