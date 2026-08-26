import { describe, expect, it } from 'vitest';
import { data } from '../pack';
import { assetManifest } from '../generated/assetManifest';

/**
 * The whole roster, checked as data.
 *
 * `packInstallable.test.ts` runs core's own `validatePackData`, which answers
 * the question core asks: will this install. These are the questions core has
 * no opinion about and a player notices immediately — a blank icon, a spell
 * whose tooltip still says the placeholder text, a name that does not carry
 * its own slot.
 *
 * It reads only the **data half**, which is the half `pack.ts` guarantees can
 * be read without ever building a `ContentApi` — so this file needs no game,
 * no p5 stubs and no engine at all.
 */
const kits = () => (data.champions ?? []).filter(champion => champion.playable);
const display = data.spellDisplay ?? {};

describe('the roster', () => {
  it('ships the heroes this pack claims', () => {
    expect(kits().map(champion => champion.id).sort()).toEqual([
      'axe',
      'crystalmaiden',
      'juggernaut',
      'lina',
      'pudge',
      'vengefulspirit',
    ]);
  });

  it('gives every playable hero a portrait that exists in this pack’s own art', () => {
    for (const champion of kits()) {
      expect(champion.image, `${champion.id} has no portrait`).toBeTruthy();
      expect(
        Object.hasOwn(assetManifest, champion.image!),
        `${champion.id}: portrait key "${champion.image}" is in no manifest of ours`
      ).toBe(true);
    }
  });

  it('gives every playable hero exactly four abilities, and no id appears twice', () => {
    const everyId: string[] = [];
    for (const champion of kits()) {
      expect(champion.spells.length, `${champion.id} does not have four abilities`).toBe(4);
      everyId.push(...champion.spells);
    }
    expect(new Set(everyId).size, 'two heroes share an ability id').toBe(everyId.length);
  });
});

describe('every ability a hero can cast', () => {
  const entries = () =>
    kits().flatMap(champion =>
      champion.spells.map(id => ({ champion: champion.id, id, entry: display[id] }))
    );

  it('has display data at all', () => {
    for (const { id, entry } of entries()) {
      expect(entry, `${id} is in a kit but has no spellDisplay entry`).toBeTruthy();
    }
  });

  it('has an icon that exists in this pack’s own art', () => {
    for (const { id, entry } of entries()) {
      expect(entry.iconKey, `${id} has no icon`).toBeTruthy();
      expect(
        Object.hasOwn(assetManifest, entry.iconKey!),
        `${id}: icon key "${entry.iconKey}" is in no manifest of ours`
      ).toBe(true);
    }
  });

  /**
   * `'<tên tiếng Việt> (Champion_Slot)'`. The parenthesised half is what lets a
   * player, a bug report and a source file all name the same ability — and it
   * is the half a rename silently drops.
   */
  it('is named in Vietnamese and carries its own slot', () => {
    for (const { id, entry } of entries()) {
      expect(entry.name, `${id} is named "${entry.name}"`).toMatch(
        new RegExp(`^.+ \\(${id}\\)$`)
      );
    }
  });

  /**
   * The scaffold's placeholder text, and the reason this test exists: an
   * unfinished ability is *installable*, plays, and reads as finished in the
   * HUD. Nothing else in `verify` can tell the difference.
   */
  it('describes what it does, rather than saying it is unfinished', () => {
    for (const { id, entry } of entries()) {
      expect(entry.description.trim().length, `${id} has an empty description`).toBeGreaterThan(20);
      expect(entry.description, `${id} still carries placeholder text`).not.toMatch(
        /Chưa hoàn thiện|TODO|PLACEHOLDER/i
      );
    }
  });

  it('costs something and has a real cooldown', () => {
    for (const { id, entry } of entries()) {
      expect(entry.coolDownMs, `${id} has no cooldown`).toBeGreaterThan(0);
      expect(entry.manaCost, `${id} has a negative mana cost`).toBeGreaterThanOrEqual(0);
    }
  });
});
