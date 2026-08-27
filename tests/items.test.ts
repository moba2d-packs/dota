import { describe, expect, it } from 'vitest';
import { data } from '../pack';
import { assetManifest } from '../generated/assetManifest';
import { spellCatalog } from '../generated/spellCatalog';

/**
 * The shop, checked as data.
 *
 * `packInstallable.test.ts` runs core's own `validatePackData`, which answers
 * the question core asks: will this install. It already covers the recipe rules
 * that are core's — a `buildsFrom` naming an item that exists, a total under the
 * sum of its parts, a cycle. These are the questions core has no opinion about
 * and a player notices immediately: a blank icon in the shop, an item whose
 * active is also offered as a free ability in the loadout screen, a component
 * priced like a finished item.
 *
 * It reads only the **data half**, so it needs no game, no p5 stubs and no
 * engine — plus `generated/spellCatalog.ts`, which is plain values.
 */
const items = () => Object.values(data.items ?? {});
const finished = () => items().filter(item => item.buildsFrom !== undefined);
const components = () => items().filter(item => item.buildsFrom === undefined);
const kitIds = () => (data.champions ?? []).flatMap(champion => champion.spells);

describe('the shop', () => {
  it('ships the five items this pack claims, and the parts they need', () => {
    expect(finished().map(item => item.id).sort()).toEqual([
      'black_king_bar',
      'blade_mail',
      'euls_scepter',
      'heart_of_tarrasque',
      'shivas_guard',
    ]);
    expect(components().length).toBeGreaterThan(0);
  });

  it('gives every item an icon that exists in this pack’s own art', () => {
    for (const item of items()) {
      expect(item.icon, `${item.id} has no icon`).toBeTruthy();
      expect(
        Object.hasOwn(assetManifest, item.icon),
        `${item.id}: icon key "${item.icon}" is in no manifest of ours`
      ).toBe(true);
    }
  });

  it('prices components and finished items on two different scales', () => {
    for (const item of components()) {
      expect(item.cost, `${item.id} is priced like a finished item`).toBeGreaterThanOrEqual(300);
      expect(item.cost, `${item.id} is priced like a finished item`).toBeLessThanOrEqual(550);
    }
    for (const item of finished()) {
      expect(item.cost, `${item.id} is priced like a component`).toBeGreaterThanOrEqual(900);
      expect(item.cost, `${item.id} is priced like a component`).toBeLessThanOrEqual(1_300);
    }
  });

  it('describes what holding it does, in Vietnamese', () => {
    for (const item of items()) {
      expect(item.description, `${item.id} has no description`).toBeTruthy();
      expect(
        item.description!.trim().length,
        `${item.id} has an empty description`
      ).toBeGreaterThan(10);
      expect(item.description, `${item.id} still carries placeholder text`).not.toMatch(
        /Chưa hoàn thiện|TODO|PLACEHOLDER/i
      );
    }
  });

  it('gives at least two of them something to press', () => {
    expect(items().filter(item => item.active !== undefined).length).toBeGreaterThanOrEqual(2);
  });

  it('points every passive and active at a spell this pack actually ships', () => {
    for (const item of items()) {
      for (const id of [item.passive, item.active]) {
        if (!id) continue;
        expect(
          Object.hasOwn(spellCatalog, id),
          `${item.id}: "${id}" is in no barrel of ours`
        ).toBe(true);
      }
    }
  });

  /**
   * The rule that keeps an item's spell an *item's*. An id that also appeared
   * in a kit would be an ability a champion casts for free and an item the shop
   * charges for, which is one spell wearing two prices.
   */
  it('never puts an item’s spell in a champion’s kit', () => {
    const kit = new Set(kitIds());
    for (const item of items()) {
      for (const id of [item.passive, item.active]) {
        if (!id) continue;
        expect(kit.has(id), `${item.id}: "${id}" is also in a champion's kit`).toBe(false);
      }
    }
  });

  /**
   * And the rule that keeps it out of the loadout screen. `spellDisplay` is
   * what a picker offers as a choosable ability, so an item's active sitting in
   * it can be handed to somebody who never bought the item.
   */
  it('keeps every item spell out of spellDisplay', () => {
    const display = data.spellDisplay ?? {};
    for (const id of Object.keys(display)) {
      expect(id.startsWith('Item_'), `${id} is offered as a choosable ability`).toBe(false);
    }
    // And the same fact from the other side: the item spells exist, they are
    // simply not on that list.
    for (const item of items()) {
      for (const id of [item.passive, item.active]) {
        if (!id) continue;
        expect(Object.hasOwn(display, id), `${id} leaked into spellDisplay`).toBe(false);
      }
    }
  });

  /**
   * Items need a core that has a shop. `items` did not exist before 1.3,
   * `buildsFrom` before 1.4, and `Buff.hudVisible`/`sourceSpell` before 1.5 —
   * and an older core *ignores* what it does not know rather than refusing, so
   * the floor is the only thing standing between a player and a silently broken
   * install. 1.5 is what the shop actually needs; the declared floor sits a
   * minor above it by choice, and `pack.ts`'s own note says why.
   */
  it('declares a core floor that actually has a shop in it', () => {
    expect(data.manifest.coreRange).toBe('>=1.6.0');
  });
});
