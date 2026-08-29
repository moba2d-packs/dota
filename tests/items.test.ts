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

  /**
   * The reason core grew `Stats.abilityPower`, held to a number here.
   *
   * Every ability in this pack dealt a flat amount that no purchase could
   * move, while attack damage climbed with the shop — so a full build made
   * right-click better and this pack's four casters exactly as good as they
   * were on the first frame.
   *
   * **The ceiling is lower than the other installed pack's on purpose.** This
   * shop is fourteen items against thirty-three, and only two of them are
   * finished items an ability build wants, so the same multiplier would mean
   * absurd numbers per item. A full ability build here doubles-to-triples a
   * kit rather than tripling it, and the fix for that is more items, not
   * bigger ones.
   */
  it('sells enough ability power for a build to roughly double a kit', () => {
    const powers = items()
      .map(item => item.stats?.abilityPower ?? 0)
      .filter(amount => amount > 0)
      .sort((a, b) => b - a);

    // Six slots, and with only four ability items in the shop a real build
    // holds duplicate components — which is why the top two are counted twice.
    const bestSix = [...powers, ...powers.slice(2)]
      .slice(0, 6)
      .reduce((sum, amount) => sum + amount, 0);

    expect(powers.length, 'no item grants ability power at all').toBeGreaterThanOrEqual(4);
    expect(
      bestSix,
      `the best six slots grant ${bestSix.toFixed(2)}, a ${(1 + bestSix).toFixed(2)}x kit`
    ).toBeGreaterThanOrEqual(1.5);
    expect(bestSix).toBeLessThanOrEqual(2.5);
  });

  it('sells cooldown reduction, and never enough of it to reach the cap', () => {
    // `MAX_COOLDOWN_REDUCTION` is 0.6 in core, and a shop that can reach it
    // sells a key which can be held down.
    const reductions = items()
      .map(item => item.stats?.cooldownReduction ?? 0)
      .filter(amount => amount > 0);

    expect(reductions.length).toBeGreaterThanOrEqual(1);
    expect(reductions.reduce((sum, amount) => sum + amount, 0)).toBeLessThan(0.6);
  });

  it('describes what an item *does*, and leaves what it grants to the stat list', () => {
    // A description used to be required of every item and used to open by
    // restating that item's own stat block in prose. Core builds a stat list
    // for both the shop card and the inventory tooltip now
    // (`hud/itemStatLines.ts`), so the prose was printing the same numbers a
    // second time in the one place and standing in for a list that did not
    // exist in the other.
    //
    // What is left is the passive, the active and any note the numbers cannot
    // carry — which the nine pure-stat components of this shop do not have, so
    // they say nothing rather than repeating the list beside them.
    for (const item of items()) {
      if (item.description === undefined) {
        expect(item.passive ?? item.active, `${item.id} has neither text nor an ability`).toBe(
          undefined
        );
        continue;
      }
      expect(
        item.description.trim().length,
        `${item.id} has an empty description`
      ).toBeGreaterThan(10);
      expect(item.description, `${item.id} restates its own stat list`).not.toMatch(/^Tăng /);
      expect(item.description, `${item.id} still carries placeholder text`).not.toMatch(
        /Chưa hoàn thiện|TODO|PLACEHOLDER/i
      );
    }
  });

  it('colours every number it does print, the way a spell description does', () => {
    // The item panel rendered as one flat grey paragraph beside a spell panel
    // with three colours in it — same pipeline, same stylesheet, nothing in
    // the text for either to work on. Any digit left outside a span is a
    // number this pack chose to print and did not colour.
    const SPAN = /<span class="(damage|buff|time)">[^<]*<\/span>/g;
    const untagged = items()
      .filter(item => /\d/.test((item.description ?? '').replace(SPAN, '')))
      .map(item => item.id);

    expect(untagged).toEqual([]);
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
   * install.
   *
   * 1.7 is what the shop needs now, and for once not silently: five items grant
   * `abilityPower` or `cooldownReduction`, and core's item stats are an
   * allow-list, so an older core refuses this pack outright rather than
   * shipping it with inert mage items. See `pack.ts`'s own note.
   */
  it('declares a core floor that actually has a shop in it', () => {
    expect(data.manifest.coreRange).toBe('>=1.8.0');
  });
});
