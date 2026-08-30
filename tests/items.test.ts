import { describe, expect, it } from 'vitest';
import { describeItemShop } from '@moba2d/core/testing/items';
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
/**
 * Everything about this shop that is really a rule about *core*: the icon it
 * looks up, the spell ids it resolves, the recipe it combines, the ceiling it
 * clamps cooldowns at, and what a description may contain now that both the
 * shop card and the inventory tooltip draw the stat list themselves.
 *
 * It used to be written out here, and a differently-shaped half of it was
 * written out in the other pack — with core's own `MAX_COOLDOWN_REDUCTION`
 * copied into each as a literal `0.6`, and the recipe rules present only
 * there, so *this* shop was never checked for a combine that is a downgrade
 * or a component that leads nowhere. `@moba2d/core/testing/items` is the one
 * copy; what is left below is this pack's own design.
 */
describeItemShop({ data, assetManifest, spellCatalog });

const items = () => Object.values(data.items ?? {});
const finished = () => items().filter(item => item.buildsFrom !== undefined);
const components = () => items().filter(item => item.buildsFrom === undefined);

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

  it('sells cooldown reduction at all', () => {
    // The ceiling — that the whole shop cannot reach `MAX_COOLDOWN_REDUCTION`,
    // which would be a shop selling a key that can be held down — is core's
    // own rule and lives in `describeItemShop` above. What is this pack's is
    // that the stat is *for sale*: without it Eul's and the void stone scale
    // on one axis, which is not the item they were designed as.
    const sources = items().filter(item => (item.stats?.cooldownReduction ?? 0) > 0);
    expect(sources.length).toBeGreaterThanOrEqual(1);
  });

  it('gives at least two of them something to press', () => {
    expect(items().filter(item => item.active !== undefined).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * And the rule that keeps it out of the loadout screen. `spellDisplay` is
   * what a picker offers as a choosable ability, so an item's active sitting in
   * it can be handed to somebody who never bought the item.
   */
  it('keeps every `Item_` id out of spellDisplay, not only the ones in use', () => {
    // `describeItemShop` walks the ids this shop's items actually name. This
    // is the wider net over the same list: an item spell added later, before
    // the item that will carry it exists, is still a free ability handed to a
    // champion who never bought anything.
    for (const id of Object.keys(data.spellDisplay ?? {})) {
      expect(id.startsWith('Item_'), `${id} is offered as a choosable ability`).toBe(false);
    }
  });

  /**
   * Items need a core that has a shop. `items` did not exist before 1.3,
   * `buildsFrom` before 1.4, and `Buff.hudVisible`/`sourceSpell` before 1.5 —
   * and an older core *ignores* what it does not know rather than refusing, so
   * the floor is the only thing standing between a player and a silently broken
   * install.
   *
   * Every step since is recorded beside the value in `pack.ts`. The latest is
   * 1.11, and it is the silent kind: core amplifies heals and shields by the
   * caster's ability power and rescales a `class="heal"` span, so on an older
   * core those numbers quietly stay at what was typed.
   */
  it('declares a core floor that actually has a shop in it', () => {
    expect(data.manifest.coreRange).toBe('>=1.11.0');
  });
});
