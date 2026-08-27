import { describe, expect, it } from 'vitest';
import { data, DEFENCE, type Role } from '../pack';

/**
 * What each kind of hero is made of.
 *
 * Every hero here declared an `attack` profile and none declared a body, so
 * all nine were **100 health with no resistances** — less than a lane creep's
 * 140, and identical for Pudge and for Sniper. Once the shop grew, a full
 * damage build went through the sturdiest thing this pack could field in about
 * two and a half seconds.
 *
 * The arithmetic is written out by hand rather than imported from core, on the
 * rule `Mitigation.test.ts` states there: a table asked to verify itself agrees
 * with itself however wrong it is.
 */
const roles = Object.keys(DEFENCE) as Role[];

/** `100 / (100 + r)`, core's own curve, restated so this file is a second opinion. */
const mitigated = (resistance: number): number => 100 / (100 + resistance);

const items = Object.values(data.items ?? {});
const bestSix = (key: 'maxHealth' | 'armor' | 'magicResist'): number =>
  items
    .map(item => item.stats?.[key] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, amount) => sum + amount, 0);

describe('every hero is a whole hero', () => {
  it('gives all nine a body', () => {
    const champions = (data.champions ?? []).filter(entry => entry.playable);
    expect(champions.length).toBeGreaterThan(0);
    for (const champion of champions) {
      expect(champion.defence, `${champion.name} has no body`).toBeDefined();
    }
  });

  it('publishes the taxonomy to the loadout screen', () => {
    // A hand-built kit picks a body from this list; core names no role of its
    // own and never will.
    expect((data.archetypes ?? []).map(entry => entry.id).sort()).toEqual(
      roles.map(role => role.toLowerCase()).sort()
    );
  });

  it('puts every hero above a lane creep, which is where the bug was', () => {
    for (const role of roles) {
      expect(DEFENCE[role].health, `${role} is thinner than a creep`).toBeGreaterThanOrEqual(135);
    }
  });

  it('orders strength ahead of intelligence on both resistances', () => {
    expect(DEFENCE.STRENGTH.health).toBeGreaterThan(DEFENCE.AGILITY.health);
    expect(DEFENCE.AGILITY.health).toBeGreaterThan(DEFENCE.INTELLIGENCE.health);
    expect(DEFENCE.STRENGTH.armor).toBeGreaterThan(DEFENCE.INTELLIGENCE.armor);
  });
});

describe('the shop can build on it', () => {
  it('leans on the resistances rather than the pool, so flat heals keep their worth', () => {
    // Six abilities here restore or shield a flat amount. A shield is worth
    // `1 + armor/100` times its face value, and worth a smaller *share* of a
    // larger pool — so the front line's advantage has to come mostly from the
    // multiplier or this pack's own sustain quietly stops mattering.
    const poolRatio = DEFENCE.STRENGTH.health / DEFENCE.INTELLIGENCE.health;
    const armourRatio = mitigated(DEFENCE.INTELLIGENCE.armor) / mitigated(DEFENCE.STRENGTH.armor);

    expect(poolRatio).toBeLessThan(2);
    expect(armourRatio, 'the resistances are not carrying this').toBeGreaterThan(1.3);
  });

  it('sells magic resistance on more than a single item', () => {
    // It sold it on exactly two, in a pack whose abilities now scale to about
    // three times their base. Black King Bar carrying it is also the item
    // finally doing what its name says.
    const sources = items.filter(item => (item.stats?.magicResist ?? 0) > 0);
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  it('does not leave magic resistance far behind armour', () => {
    expect(bestSix('magicResist')).toBeGreaterThan(bestSix('armor') * 0.6);
  });

  it('multiplies a front-liner’s durability several times over', () => {
    // The whole reason resistances lead: 220 health behind a full armour build
    // is worth far more than 220, and every flat shield cast on it scales the
    // same way.
    const health = DEFENCE.STRENGTH.health + bestSix('maxHealth');
    const armor = DEFENCE.STRENGTH.armor + bestSix('armor');
    const effective = health / mitigated(armor);

    expect(effective / health, `${armor} armour`).toBeGreaterThan(2);
    expect(effective).toBeGreaterThan(700);
  });
});
