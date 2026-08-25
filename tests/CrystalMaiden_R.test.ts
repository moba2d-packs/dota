import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@moba2d/core/testing';
import { pressSpell } from '@moba2d/core/testing/spell';
import type { AttackableUnit } from '@moba2d/core/content/types';
import CrystalMaiden_R, {
  R_BLAST_DAMAGE,
  R_BLAST_RADIUS,
  R_CHANNEL_MS,
  R_MANA,
  R_MAX_DAMAGE,
  R_RING_INNER,
  R_RING_OUTER,
  R_SLOW,
  R_TICK_MS,
  R_TICKS,
} from '../spells/CrystalMaiden_R';
import { indexObjects, unit } from './_units';

/** She stands somewhere the quadtree covers in every direction. */
const HOME = { x: 1_000, y: 1_000 };

/**
 * With `random` answering the midpoint of whatever range it is handed, every
 * blast this ability seeds is at bearing `(0 + 2PI) / 2 = PI` and reach
 * `(120 + 320) / 2 = 220` — i.e. 220px due west of her. Written out here by
 * hand rather than read back off the object, so the test knows where the
 * damage is supposed to land independently of the code that lands it.
 */
const BLAST = { x: HOME.x - (R_RING_INNER + R_RING_OUTER) / 2, y: HOME.y };

/** Makes the blast sequence deterministic. Must run before the cast that seeds it. */
const freezeBlasts = (): void => {
  vi.stubGlobal('random', (low = 1, high?: number) =>
    high === undefined ? low / 2 : (low + high) / 2
  );
};

const advance = (spell: CrystalMaiden_R, ms: number): void => {
  vi.stubGlobal('deltaTime', ms);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

const slowOn = (target: AttackableUnit) =>
  target.buffs.find(buff => buff.constructor.name === 'Slow') as unknown as
    | { percent: number }
    | undefined;

describe('CrystalMaiden_R — Băng Trường', () => {
  let game: TestGame;
  let maiden: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    maiden = unit(game, HOME.x, 'radiant', HOME.y);
    // The ultimate costs 125 against the shared helper's 100 pool. A real
    // champion carrying it has the mana for it; the helper's default is scaled
    // for the ordinary abilities.
    maiden.stats.maxMana.baseValue = 200;
    maiden.stats.mana.baseValue = 200;
    game.setPlayer(maiden);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blasts an enemy standing where the ice falls, tick after tick', () => {
    freezeBlasts();
    const victim = unit(game, BLAST.x, 'dire', BLAST.y);
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_R(maiden);
    expect(pressSpell(spell, { at: HOME })).toBe(true);
    expect(spell.field, 'no storm was put into the world').not.toBeNull();

    // Nothing until the first blast is due.
    advance(spell, R_TICK_MS - 50);
    expect(victim.stats.health.value).toBe(100);

    advance(spell, 50);
    expect(victim.stats.health.value).toBe(100 - R_BLAST_DAMAGE);
    advance(spell, R_TICK_MS);
    advance(spell, R_TICK_MS);
    expect(victim.stats.health.value).toBe(100 - R_BLAST_DAMAGE * 3);
  });

  it('leaves what it catches crawling', () => {
    freezeBlasts();
    const victim = unit(game, BLAST.x, 'dire', BLAST.y);
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    advance(spell, R_TICK_MS);

    expect(slowOn(victim)?.percent).toBe(R_SLOW);
  });

  it('leaves an ally standing in a blast alone', () => {
    freezeBlasts();
    const friend = unit(game, BLAST.x, 'radiant', BLAST.y);
    indexObjects(game, [maiden, friend]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    for (let i = 0; i < 4; i++) advance(spell, R_TICK_MS);

    expect(friend.stats.health.value).toBe(100);
    expect(slowOn(friend)).toBeUndefined();
  });

  it('never hits the ground she is standing on', () => {
    // The blasts land in a *ring*, so there is a hole in the middle. That hole
    // is the reason the total in the header is not the number anybody takes.
    freezeBlasts();
    const underfoot = unit(game, HOME.x, 'dire', HOME.y);
    indexObjects(game, [maiden, underfoot]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);

    expect(underfoot.stats.health.value).toBe(100);
  });

  it('stops each blast where it draws its rim', () => {
    // Offsets from the blast written out by hand rather than as
    // `R_BLAST_RADIUS ± n`. A test that derives its own geometry from the
    // constant it is checking slides along with a retune and stops testing the
    // boundary at all. 80 is inside a 95 radius; 180 is not.
    freezeBlasts();
    const clipped = unit(game, BLAST.x, 'dire', BLAST.y + 80);
    const missed = unit(game, BLAST.x, 'dire', BLAST.y + 180);
    indexObjects(game, [maiden, clipped, missed]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    advance(spell, R_TICK_MS);

    expect(clipped.stats.health.value, 'a body inside the blast was missed').toBe(
      100 - R_BLAST_DAMAGE
    );
    expect(missed.stats.health.value, 'a body outside the blast was hit').toBe(100);
  });

  it('leaves an enemy standing a thousand pixels away alone', () => {
    // Nowhere a blast can reach, whichever way the storm rolls.
    freezeBlasts();
    const distant = unit(game, HOME.x + 1_000, 'dire', HOME.y);
    indexObjects(game, [maiden, distant]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);

    expect(distant.stats.health.value).toBe(100);
  });

  it('stops dead when the channel is cancelled', () => {
    freezeBlasts();
    const victim = unit(game, BLAST.x, 'dire', BLAST.y);
    indexObjects(game, [maiden, victim]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    advance(spell, R_TICK_MS);
    advance(spell, R_TICK_MS);
    const whenSheStopped = victim.stats.health.value;
    expect(whenSheStopped).toBe(100 - R_BLAST_DAMAGE * 2);

    expect(spell.cancel('PLAYER_CANCEL')).toBe(true);
    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);

    expect(victim.stats.health.value).toBe(whenSheStopped);
    expect(spell.field, 'the storm is still drawn after she stopped').toBeNull();
  });

  it('seeds all ten blasts once, inside the ring it draws', () => {
    // Real randomness here, deliberately: this is the case the frozen one
    // cannot see. Seeding per frame would make the picture boil and would stop
    // it agreeing with where the damage went.
    indexObjects(game, [maiden]);
    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });

    const seeded = spell.field?.offsets ?? [];
    expect(seeded).toHaveLength(R_TICKS);
    for (const offset of seeded) {
      const reach = Math.hypot(offset.x, offset.y);
      expect(reach).toBeGreaterThanOrEqual(R_RING_INNER);
      expect(reach).toBeLessThanOrEqual(R_RING_OUTER);
    }
    expect(
      seeded.some(offset => offset.x !== seeded[0].x || offset.y !== seeded[0].y),
      'every blast landed on the same spot'
    ).toBe(true);

    const before = seeded.map(offset => `${offset.x},${offset.y}`).join('|');
    for (let i = 0; i < 4; i++) advance(spell, R_TICK_MS);
    const after = (spell.field?.offsets ?? []).map(offset => `${offset.x},${offset.y}`).join('|');
    expect(after, 'the blast sequence was re-rolled mid-channel').toBe(before);
  });

  it('charges its mana up front and its cooldown at the end', () => {
    freezeBlasts();
    indexObjects(game, [maiden]);

    const spell = new CrystalMaiden_R(maiden);
    pressSpell(spell, { at: HOME });
    expect(maiden.stats.mana.value).toBe(200 - R_MANA);
    // `cooldown.startAt: 'end'` — an ultimate she was stunned out of after
    // half a second must not be on a 90 second cooldown from that moment.
    expect(spell.currentCooldown).toBe(0);

    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);

    expect(spell.state).toBe('COOLDOWN');
    expect(spell.currentCooldown).toBeGreaterThan(0);
  });

  it('refuses a cast she cannot pay for', () => {
    freezeBlasts();
    const victim = unit(game, BLAST.x, 'dire', BLAST.y);
    indexObjects(game, [maiden, victim]);
    maiden.stats.mana.baseValue = R_MANA - 1;

    const spell = new CrystalMaiden_R(maiden);
    expect(pressSpell(spell, { at: HOME })).toBe(false);
    expect(spell.field).toBeNull();

    for (let i = 0; i < R_TICKS; i++) advance(spell, R_TICK_MS);
    expect(victim.stats.health.value).toBe(100);
  });

  it('is tuned as a channel nobody should stand in', () => {
    // Ten blasts is 60 against a 100 pool — the top of the ultimate band, and
    // only for somebody who stood in every one of them for 3.5 seconds. What a
    // real exchange collects is two to four, which is ordinary ability damage.
    expect(R_TICKS).toBe(R_CHANNEL_MS / R_TICK_MS);
    expect(R_MAX_DAMAGE).toBe(R_BLAST_DAMAGE * R_TICKS);
    expect(R_MAX_DAMAGE).toBeLessThanOrEqual(60);
    expect(R_BLAST_DAMAGE * 2).toBeGreaterThanOrEqual(10);
    expect(R_BLAST_DAMAGE * 4).toBeLessThanOrEqual(35);
    // The ring has to have a hole, or the total above is what everybody takes.
    expect(R_RING_INNER).toBeGreaterThan(R_BLAST_RADIUS);
  });
});
