import type { AttackableUnit } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const Shield = api.buffs.Shield;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const AoePulse = api.AoePulse;
const Reach = api.combat.Reach;

/**
 * Chồng Thịt — he braces, and the more of them there are around him the more
 * he can take.
 *
 *   press with nobody near   -> a small shield, and the ring closes empty
 *   press with two enemies   -> the ring counts them and the shield is bigger
 *   press with five          -> still counts three; the ability has a ceiling
 *
 * The source ability is a passive that banks a permanent stack per nearby
 * death. Two things stopped that shape from being copied. It is a *passive*,
 * and a slot that does nothing when pressed is a slot the player learns to
 * ignore; and a permanent stack farmed off a body count is the trap this
 * engine has already shipped three times — the stack is paid for by the
 * corpse, and every version that banked one per *cast* grew without limit off
 * targets that never died. What survives is the part a player can read: being
 * surrounded is what makes him hard to kill.
 */
export const E_BASE_SHIELD = 20;
export const E_PER_ENEMY = 11;
/** The ceiling. Being surrounded by five should not be five times a duel. */
export const E_MAX_STACKS = 3;
export const E_COUNT_RADIUS = 260;
export const E_DURATION_MS = 5_000;
export const E_COOLDOWN_MS = 14_000;
export const E_MANA = 45;

/** What the shield is worth against `count` enemies. Exported so the test never restates the arithmetic. */
export const shieldFor = (count: number): number =>
  E_BASE_SHIELD + Math.min(count, E_MAX_STACKS) * E_PER_ENEMY;

export default class Pudge_E extends Spell {
  image = api.asset('spell_pudge_e');
  name = 'Chồng Thịt (Pudge_E)';
  description =
    `Pudge gồng mình, nhận <span class="buff">Lá Chắn ${E_BASE_SHIELD}</span> cộng thêm ` +
    `<span class="buff">${E_PER_ENEMY}</span> cho mỗi kẻ địch trong bán kính ${E_COUNT_RADIUS} ` +
    `(tối đa ${E_MAX_STACKS}), kéo dài <span class="time">${E_DURATION_MS / 1000} giây</span>.`;
  coolDown = E_COOLDOWN_MS;
  manaCost = E_MANA;
  targetingMode = 'SELF' as const;
  range = E_COUNT_RADIUS;

  /** What the last cast counted. Read by the test, and by nothing else. */
  lastCount = 0;

  onSpellCast(): void {
    // The query already collides against each candidate's own body circle, so
    // it takes the caster term of `Reach` alone — handing it both would count
    // the target's radius twice.
    const nearby = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: Reach.effectiveRange(E_COUNT_RADIUS, this.owner),
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        // Counting a body he cannot see would hand him a shield for an enemy
        // standing behind a wall. This picks units out of a query to decide a
        // number, which is acquisition, so it takes the vision seam.
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    this.lastCount = nearby.length;
    const amount = shieldFor(nearby.length);

    const braced = new Shield(E_DURATION_MS, this.owner, this.owner);
    braced.amount = amount;
    braced.image = this.image;
    braced.color = [190, 120, 70];
    // Without an id it shares one stack pool with every other bare Shield in
    // the match, including the enemy support's.
    braced.stackId = 'dota_pudge_e_shield';
    this.owner.addBuff(braced);

    // The ring is drawn at the radius the count actually used, so the player
    // can see who was in and who was out — a shield number with no picture of
    // where it came from teaches nothing.
    const counted = new AoePulse(this.owner);
    counted.position = this.owner.position.copy();
    counted.radius = E_COUNT_RADIUS;
    counted.lifeTime = 620;
    counted.color = [200, 130, 80];
    counted.fillAlpha = 26;
    this.game.objectManager.addObject(counted);
  }

  drawPreview(): void {
    super.drawPreview(E_COUNT_RADIUS);
  }
}
