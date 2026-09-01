import { resolve } from 'node:path';
import { describeCoreBoundary } from '@moba2d/core/testing/boundary';

/**
 * This pack names no core internal.
 *
 * The rule, the scan and the reasoning live in core
 * (`@moba2d/core/testing/boundary`, over `src/seams/packCoreBoundary.ts`);
 * what is here is the one thing that is this pack's — where its root is.
 *
 * It runs from `npm test` and not only from `check-seams` because TypeScript
 * cannot see this class of mistake and never will: `tsconfig.json` has to
 * publish core's own `@/*` alias so this pack's `tsc` can see types through
 * core's unbundled source, and `paths` is a program-wide mapping with no
 * notion of which file is asking. So `import Buff from '@/game/…'` in a spell
 * compiles cleanly and the editor underlines nothing. Everything the engine
 * offers arrives on `api` (`packApi.ts`).
 *
 * This pack had no such check at all until the rule moved into core — the lol
 * pack had it as ten local lines, and this one silently had nothing.
 */
describeCoreBoundary({
  packRoot: resolve(__dirname, '..'),
  label: 'dota',
  minimumFiles: 40,
});
