/**
 * Rasterises this pack's one piece of original artwork — the shelf logo.
 *
 * **The SVG is the source.** `--check` re-renders into memory and fails when
 * the committed PNG no longer matches the SVG beside it, rather than letting
 * the two drift until someone notices a stale logo on the packs screen.
 *
 * Core's own `scripts/render-icons.mjs` is the same idea for its status
 * glyphs. The pack's *roster* art is a different question with a different
 * answer — see `scripts/import-art.mjs`.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/** Both trees, and the pixel size each renders at. A portrait is read at roster size; an icon at HUD size. */
const TREES = [
  // Only the shelf logo. Every champion, ability and creep image in this pack
  // is Valve's own art and arrives through `scripts/import-art.mjs`; this one
  // is drawn here because it is a picture of *this pack's* map, and because
  // core's packs screen hot-links it off this pack's published root rather
  // than resolving it through `AssetManager` — which is also why it lands in
  // `public/`, the directory Vite copies verbatim into `dist/`, and not under
  // `assets/`.
  { from: 'tools/icons/pack', to: 'public', size: 256 },
];

let rendered = 0;
let stale = [];

for (const tree of TREES) {
  const fromDir = join(root, tree.from);
  const toDir = join(root, tree.to);
  if (!existsSync(fromDir)) continue;
  mkdirSync(toDir, { recursive: true });

  for (const file of readdirSync(fromDir).sort()) {
    if (!file.endsWith('.svg')) continue;
    const svg = readFileSync(join(fromDir, file));
    const out = join(toDir, basename(file, '.svg') + '.png');
    const png = await sharp(svg, { density: 384 })
      .resize(tree.size, tree.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    if (check) {
      if (!existsSync(out) || !readFileSync(out).equals(png)) stale.push(tree.to + '/' + basename(out));
    } else {
      writeFileSync(out, png);
    }
    rendered++;
  }
}

if (check && stale.length) {
  console.error(`render-icons --check: ${stale.length} PNG(s) do not match their SVG source:`);
  for (const name of stale) console.error('  ' + name);
  console.error('Run `npm run icons:render` and commit both halves.');
  process.exit(1);
}
console.log(check ? `render-icons --check: ${rendered} icon(s) match their source` : `render-icons: ${rendered} icon(s) written`);
