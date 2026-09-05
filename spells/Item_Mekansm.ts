import type { AttackableUnit, CastSpec, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const AttackableUnit = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
const heal = api.text.heal;

/**
 * Mekansm's active: one press, and everyone standing with him is mended at
 * once.
 *
 *   press        -> a ring of light washes out to the radius it really has
 *   caught in it -> every ally (him included) is healed, immediately
 *   15 seconds   -> it can do it again
 *
 * ## A burst, not regeneration — and through `takeHeal`, always
 *
 * The instant team heal is the third team button on this shelf and the only
 * one that answers damage *already taken* — the two barrier items answer the
 * volley that has not landed yet, which is why all three coexist. The mending
 * goes through `takeHeal` rather than any arithmetic of this file's own, so
 * every rule core hangs on healing applies unasked: the caster's ability
 * power amplifies it, overheal clamps, and — the one this shop sells the
 * counter to — Bình Hồn's wound cuts it. An item that healed around the heal
 * cut would un-sell the other item.
 *
 * ## Snapshot, like the barriers
 *
 * Whoever is in the ring at the press is healed; arriving a beat later gets
 * nothing. Timing the press against the room's health bars is the whole skill
 * of the item, exactly as timing Vệ Binh Đỏ against the volley is.
 */
export const HEAL_AMOUNT = 15;
export const RADIUS = 400;
export const COOLDOWN_MS = 15_000;

export default class Item_Mekansm extends Spell {
  targetingMode = 'SELF' as const;
  image = api.asset('item_mekansm');
  name = 'Mekansm (Item_Mekansm)';
  description =
    `Kích hoạt: hồi ${heal(HEAL_AMOUNT, ' máu')} ngay lập tức cho bản thân và ` +
    `đồng minh trong bán kính ${RADIUS}.`;
  coolDown = COOLDOWN_MS;
  manaCost = 0;

  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 0,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onSpellCast(): void {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
      ],
    }) as AttackableUnit[];

    for (const ally of found) {
      if (!ally || ally.isDead || ally.toRemove) continue;
      // `queryObjects` answers on bounds; the edge is re-checked against the
      // radius the light actually reaches.
      if (ally.position.dist(this.owner.position) > RADIUS) continue;

      // Through the front door — the heal cut, overheal clamping and ability
      // power all live in `takeHeal`. See the header.
      ally.takeHeal(HEAL_AMOUNT, this.owner);
    }

    const wash = new Item_Mekansm_Object(this.owner);
    wash.position = this.owner.position.copy();
    this.game.objectManager.addObject(wash);
  }
}

/** How long the wash of light takes to reach the edge and fade. */
export const WASH_MS = 600;

/**
 * The mend: one ring washing out to the true radius, then gone.
 *
 * A moment, not a field — the heal is already done by the first frame this
 * draws. Green and soft against the two barrier buttons' amber and blue: in a
 * teamfight the one question this art answers is which team button was just
 * pressed.
 */
export class Item_Mekansm_Object extends SpellObject {
  zIndex = GROUND_Z_INDEX;

  private ageMs = 0;

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= WASH_MS) this.toRemove = true;
  }

  /** A square around its own centre, at the radius the wash reaches. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(RADIUS * 2 + 40);
  }

  draw(): void {
    const at = this.position;
    const t = Math.min(1, this.ageMs / WASH_MS);
    // Eases out — light, not soldiers.
    const washed = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    push();
    noFill();
    // The ring itself, at the reach the heal really had.
    stroke(120, 220, 150, 170 * fade);
    strokeWeight(2.5);
    circle(at.x, at.y, RADIUS * 2 * washed);
    // A second, closer ring trailing it, so the wash has depth without a fill.
    stroke(170, 240, 190, 110 * fade);
    strokeWeight(1.5);
    circle(at.x, at.y, RADIUS * 2 * washed * 0.72);
    // Small crosses drifting up near the centre — the universal word for
    // "healed", drawn where the button was pressed.
    stroke(150, 235, 170, 190 * fade);
    strokeWeight(2);
    for (let mark = 0; mark < 3; mark++) {
      const angle = (mark / 3) * Math.PI * 2 + 0.5;
      const mx = at.x + Math.cos(angle) * 34;
      const my = at.y + Math.sin(angle) * 22 - t * 26;
      line(mx - 5, my, mx + 5, my);
      line(mx, my - 5, mx, my + 5);
    }
    pop();
  }
}
