import { describeSpellDescriptions } from '@moba2d/core/testing/spellText';
import { spellCatalog } from '../generated/spellCatalog';
import { data } from '../pack';

/**
 * This pack's coloured numbers, held to core's rules rather than to a copy of
 * them written out here.
 *
 * ## What used to be in this file
 *
 * A scan of its own: every `damage` span must name a type, the type must match
 * what the file's `takeDamage` deals, the figure must come first, and the
 * words after it must not be "máu"/"giây"/"lần". Those rules were written
 * because all 38 spans in this pack were bare `class="damage"` — which core
 * reads as MAGIC, so seven physical abilities claimed a scaling their cast
 * path refuses, and ten spans reading "sát thương phép" were painted in the
 * physical red.
 *
 * Every one of those rules is now unreachable rather than merely checked.
 * `api.text.dmg(amount, type, tail)` takes the type as a required argument and
 * writes the markup itself, so there is no span to forget a type on, no
 * leading figure for a `+` to displace, and no way to tag a sword count except
 * by calling `dmg` on it on purpose. The rules that remain are core's, live
 * beside the parser that gives them meaning, and are the same three lines in
 * all three packs — see `@moba2d/core/testing/spellText`.
 *
 * The other half of that scan — that a span's damage type matches the
 * `takeDamage` in the same file — is deliberately *not* here any more. It
 * cannot be core's (core cannot read a pack's source) and it could not survive
 * contact with the other packs anyway: naruto deals its damage in separate
 * spell-object files, so a file-local comparison reports every one of them as
 * a span with no damage behind it. `tests/damageAttribution.test.ts` is what
 * exercises the real path.
 */
describeSpellDescriptions({
  descriptions: () => [
    ...Object.entries(spellCatalog).map(
      ([id, spell]): [string, string] => [id, spell.description]
    ),
    ...Object.values(data.items ?? {}).map(
      (item): [string, string] => [`item ${item.id}`, item.description ?? '']
    ),
  ],
});
