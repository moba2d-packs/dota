import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A hand-rolled display box must carry `data: this`.
 *
 * `ObjectManager` puts whatever `getDisplayBoundingBox()` returns straight
 * into the display quadtree, and the draw pass reads `entry.data.zIndex` back
 * off it to sort the frame. A rectangle built without that field is an entry
 * whose `data` is `undefined`, so **every frame** throws
 * `Cannot read properties of undefined (reading 'zIndex')` out of
 * `ObjectManager.draw`.
 *
 * The reason this is a scan and not a lesson in a doc comment: nothing else in
 * this repository could see it. `verify` is green — it is a runtime failure in
 * a renderer no unit test starts. The Playwright driver was green too, and for
 * a nastier reason: the game **catches** a draw error and paints an in-game
 * banner, so it never reaches `page.on('pageerror')`. Two of this pack's four
 * hand-rolled boxes shipped without the field and were found by a human
 * looking at a screenshot.
 *
 * `squareDisplayBoundingBox(edge)` fills the field in itself, which is exactly
 * why the hand-rolled branch — the one `docs/ADDING_SPELLS.md` tells you to
 * take when the box is not a square around your own centre — is the only one
 * that can get it wrong, and the one place it is never demonstrated.
 *
 * Comments are stripped before matching, or this file's own explanation of
 * the rule would satisfy the rule.
 */
const SPELLS = join(__dirname, '../spells');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Every `new Rectangle({...})` / `new RectangleArea({...})` call, with its own object literal. */
const boxLiterals = (source: string): string[] =>
  [...source.matchAll(/new (?:Rectangle|RectangleArea)\((\{[\s\S]*?\})\)/g)].map(match => match[1]);

describe('a hand-rolled getDisplayBoundingBox', () => {
  const files = readdirSync(SPELLS).filter(name => name.endsWith('.ts') && name !== 'index.ts');

  it('names data on every rectangle it builds', () => {
    const offenders: string[] = [];
    for (const name of files) {
      const source = stripComments(readFileSync(join(SPELLS, name), 'utf8'));
      for (const literal of boxLiterals(source)) {
        if (!/\bdata\s*:/.test(literal)) offenders.push(name);
      }
    }
    expect(offenders, `${offenders.join(', ')} build a display box with no \`data\``).toEqual([]);
  });

  it('scans a population big enough for the rule to mean something', () => {
    // A scan that silently stops matching any file passes forever. This is the
    // guard on the guard: at least one spell in this pack really does hand-roll
    // a box, so the case above is exercised against real code every run.
    const found = files.flatMap(name =>
      boxLiterals(stripComments(readFileSync(join(SPELLS, name), 'utf8')))
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('can see the omission it is meant to catch', () => {
    const planted = 'return new Rectangle({ x: left, y: top, w: 10, h: 10 });';
    const literal = boxLiterals(planted)[0];
    expect(literal).toBeTruthy();
    expect(/\bdata\s*:/.test(literal)).toBe(false);
  });
});
