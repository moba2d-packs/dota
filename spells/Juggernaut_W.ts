import type { AttackableUnit, KillCredit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Pet = api.units.Pet;
const Unit = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Cột Hồi Máu — he plants a totem, and everyone on his side who stands near it
 * gets better.
 *
 *   press at a spot in range -> a totem stands there for 9 seconds
 *   every 600ms              -> every ally inside 260 is mended for 4
 *   the enemy hits it twice  -> it is gone
 *
 * ## It is a real `Pet`, not a `SpellObject` dressed as one
 *
 * `api.units.Pet` — a genuine unit with 20 health that the enemy can click and
 * kill, which is the entire decision the ability offers. Written as a
 * `SpellObject` the totem would be an effect with a timer: unclickable,
 * invisible to every query, and therefore a flat "your team heals for nine
 * seconds" with no counterplay at all. Three of `Pet`'s own rules are what
 * make it work unmodified — it expires on `lifeTimeMs`, it dies with its
 * summoner, and `die()` retires the corpse instead of respawning it, so
 * killing it is worth something.
 *
 * Two things had to be turned off rather than tuned. `stationary` and an
 * `aggroRadius` of 0 are not enough on their own to make a totem that does not
 * fight (a zero-radius quadtree query still answers with whatever body the
 * point is inside), so `findTarget` is overridden to return nothing at all —
 * a totem that never picks a target is one sentence, where a totem that picks
 * one and is disarmed is three.
 *
 * ## The arithmetic
 *
 * A pulse the moment it lands and one every `W_TICK_MS` after, so
 * `ceil(9000 / 600)` = **15** fit inside its life: 15 x 4 = **60** to an ally
 * who stands beside it for the whole nine seconds. That is a champion's entire
 * pool, and it is priced that way on purpose — nine seconds is most of a
 * teamfight, the totem is worth two basic attacks to delete, and standing
 * still in a 260 circle for that long is the cost. What a real fight pays out
 * is two or three pulses.
 *
 * ## Where the ground art lives
 *
 * The 260 ring is a `Juggernaut_W_Ring`, a `SpellObject` attached to the
 * totem, not something the totem draws itself. A unit's own
 * `getDisplayBoundingBox` is its body, and it is what `ObjectManager` indexes
 * into the quadtree — widening it so a 260 ring survives the camera edge would
 * widen the totem's own broad-phase footprint at the same time. The ring is
 * the thing that reaches, so the ring is the thing that owns the box.
 */
export const W_RANGE = 450;
export const W_LIFETIME_MS = 9_000;
export const W_HEALTH = 20;
export const W_TICK_MS = 600;
export const W_HEAL_PER_TICK = 4;
export const W_HEAL_RADIUS = 260;
/** Was 30s. The practice room's 20s ceiling and Vũ Đao's already-compliant 18s cooldown left no round-thousand slot above it for both this and the ultimate, so this settles below Vũ Đao instead — the room went to the ultimate. */
export const W_COOLDOWN_MS = 16_000;
export const W_MANA = 55;

/** One at birth and one every `W_TICK_MS` after — `ceil`, because the first is free. */
export const W_TICKS = Math.ceil(W_LIFETIME_MS / W_TICK_MS);
/** What one ally who never leaves the ring is mended for in total. See the header. */
export const W_MAX_TOTAL_HEAL = W_HEAL_PER_TICK * W_TICKS;

export default class Juggernaut_W extends Spell {
  image = api.asset('spell_juggernaut_w');
  name = 'Cột Hồi Máu (Juggernaut_W)';
  description =
    `Dựng một cột totem ${W_HEALTH} máu trong <span class="time">${W_LIFETIME_MS / 1000} giây</span>. ` +
    `Mỗi <span class="time">${W_TICK_MS / 1000} giây</span> nó hồi ` +
    `<span class="buff">${W_HEAL_PER_TICK} máu</span> cho mọi đồng minh trong bán kính ` +
    `${W_HEAL_RADIUS} (tối đa <span class="buff">${W_MAX_TOTAL_HEAL}</span>). Kẻ địch có thể phá nó.`;
  coolDown = W_COOLDOWN_MS;
  manaCost = W_MANA;
  targetingMode = 'POINT' as const;
  range = W_RANGE;

  /** The totem this cast planted. Read by the test; never cleaned up from here — see below. */
  ward: Juggernaut_W_Ward | null = null;

  onSpellCast(): void {
    // Clamped rather than refused: a press past 450 plants the totem at 450
    // along the same line, which is what every point-targeted ability in this
    // engine does and what a player dragging a thumb across a phone expects.
    const spot = VectorUtils.getVectorWithMaxRange(this.owner.position, this.aimPoint, W_RANGE).to;

    const ward = new Juggernaut_W_Ward(this.owner, spot);
    this.ward = ward;
    this.game.objectManager.addObject(ward);

    const ring = new Juggernaut_W_Ring(ward);
    // Attached, so the ring goes when the totem goes — killed, expired or
    // dropped with its summoner — rather than outliving it on its own clock.
    ring.attachTo(ward);
    this.game.objectManager.addObject(ring);
  }

  /**
   * There is deliberately no `onComplete` / `deactivate` / `onRemoved`
   * teardown here, and that is not the omission it looks like.
   *
   * This is an instant `PRESS` with no channel and no active window, so the
   * runtime completes the activation on the same frame as the cast — cleanup
   * hung on `onComplete` would delete the totem a frame after planting it. The
   * totem's life is its own (`Pet.lifeTimeMs`), its death with its summoner is
   * `Pet`'s own rule, and the ring is attached to it. Nothing is left dangling.
   */
  drawPreview(): void {
    super.drawPreview(W_HEAL_RADIUS);
  }
}

/** The totem itself: a body that stands there, mends its own side, and can be killed. */
export class Juggernaut_W_Ward extends Pet {
  /**
   * `Pet` already defaults to this, and it is restated rather than inherited
   * because it is the single most expensive field on the class to get wrong:
   * `Pet extends Champion`, so `instanceof` says "champion" and every totem the
   * enemy deletes would land on somebody's KDA. Restating it here means a
   * reader of this file can see that it is answered.
   *
   * `ChampionPresetData` has no `killCredit` field to put it in — the preset
   * carries name, avatar, spells and attack tuning and nothing else — so this
   * is the class body, which is where `Pet` itself declares it.
   */
  killCredit: KillCredit = 'none';

  /** Its own clock, not `Pet.age`: that one is advanced *after* `super.update()`, so reading it here would start the schedule at one frame rather than zero. */
  private aliveMs = 0;
  private mendsFired = 0;
  /** Milliseconds since the last pulse, for the flash. Starts high so nothing flashes before the first one. */
  sinceMendMs = 9_999;
  /** Who the last pulse actually reached, so the flash can land **on** them rather than near them. */
  lastMended: AttackableUnit[] = [];

  constructor(summoner: AttackableUnit, spot: p5.Vector) {
    super({
      game: summoner.game,
      position: spot.copy(),
      teamId: summoner.teamId,
      ownerUnit: summoner,
      lifeTimeMs: W_LIFETIME_MS,
      // It was planted where it was planted. Following him would make it a
      // second body in the fight rather than a place on the map.
      followsOwner: false,
      stationary: true,
      aggroRadius: 0,
      avatar: api.asset('spell_juggernaut_w'),
      preset: {
        name: 'Cột Hồi Máu',
        // Zero damage as well as `findTarget` returning nothing: two locks on
        // a totem that must never swing, because either one alone is a single
        // edit away from a healing ward that also fights.
        attack: { damage: 0, attacksPerSecond: 1, range: 0 },
      },
    });

    // Sizing a summon's pool at birth, which is neither billing nor granting —
    // the `takeDamage`/`takeHeal` seam owns those, and this unit has not
    // existed long enough to have been hit by anything. `tests/_units.ts`
    // builds its bodies exactly this way.
    this.stats.maxHealth.baseValue = W_HEALTH;
    this.stats.health.baseValue = W_HEALTH;
  }

  /** A totem does not fight. Stated as "there is no target" rather than "the target is unreachable". */
  findTarget(): AttackableUnit | null {
    return null;
  }

  /**
   * The pulse is fired **before** `super.update()`, and the ordering is
   * load-bearing rather than a style choice.
   *
   * `Pet.update` advances its own `age` and then expires the totem on the
   * frame that age reaches `lifeTimeMs`, returning early. With the pulse after
   * that call, the fifteenth one — scheduled at 8400ms, comfortably inside the
   * totem's life — would be eaten by the expiry on the very same frame, and a
   * nine-second ward would quietly deliver fourteen pulses while every
   * constant in this file said fifteen. It is exactly the kind of off-by-one
   * that reads as a tuning question and is not one.
   *
   * The liveness checks are `Pet`'s own three, asked here instead: a totem
   * that has been killed, has been retired, or has lost its summoner must not
   * get one last pulse in on its way out.
   */
  update(): void {
    if (!this.isDead && !this.toRemove && !this.ownerUnit.isDead && !this.ownerUnit.toRemove) {
      // Scheduled off elapsed life rather than a "time since last pulse"
      // accumulator, so fifteen pulses land at 0, 600 … 8400 whatever the
      // frame lengths were and a long frame cannot swallow one.
      while (this.mendsFired < W_TICKS && this.mendsFired * W_TICK_MS <= this.aliveMs) {
        this.mendsFired += 1;
        this.mend();
      }

      const step = Math.max(0, deltaTime);
      this.aliveMs += step;
      this.sinceMendMs += step;
    }
    super.update();
  }

  /** One pulse: everyone on his side inside the ring is mended. */
  private mend(): void {
    const allies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: W_HEAL_RADIUS }),
      filters: [
        PredefinedFilters.type(Unit),
        PredefinedFilters.teamId(this.teamId),
        PredefinedFilters.excludeDead,
        // Not itself. A totem that mends its own 20 health four points at a
        // time outlasts anything the enemy can do to it in two swings, which
        // deletes the only decision the ability offers.
        PredefinedFilters.excludeObjects([this]),
      ],
      // No vision filter, and deliberately: this mends everything the ring
      // overlaps rather than picking a unit out of it. An ally standing in an
      // unlit bush beside the totem is inside the circle the player can see
      // drawn on the ground, and must be mended like anyone else.
    }) as AttackableUnit[];

    // `takeHeal` is the unit's own door for being given health, beside
    // `restoreMana`. Writing `stats.health` here would be the granting side of
    // the seam `spendMana` owns for billing.
    for (const ally of allies) ally.takeHeal(W_HEAL_PER_TICK, this);

    this.lastMended = allies;
    this.sinceMendMs = 0;
  }

  draw(): void {
    // The health bar and the lifetime bar, which are the two things a player
    // has to read off a killable summon.
    super.draw();
    if (this.isDead || this.toRemove) return;

    const post = this.position;
    push();
    // The totem: a planted pole with a jade head, drawn on its own body only.
    // Everything that reaches further is the ring object's.
    stroke(70, 55, 40, 235);
    strokeWeight(5);
    line(post.x, post.y + 14, post.x, post.y - 16);
    noStroke();
    fill(120, 245, 200, 230);
    circle(post.x, post.y - 20, 13);
    fill(235, 255, 245, 200);
    circle(post.x, post.y - 20, 6);
    pop();
  }
}

/**
 * The totem's reach, and the mend landing on each ally it reached.
 *
 * A `SpellObject` rather than something the totem paints itself, for the
 * reason in this file's header: what reaches past a body owns its own display
 * box, and a unit's box is indexed into the quadtree.
 */
export class Juggernaut_W_Ring extends SpellObject {
  /** Ground art: `Z_INDEX_MAP` is keyed by exact constructor, so a subclass names its layer or falls to 99, above the feet of everyone standing in it. */
  zIndex = GROUND_Z_INDEX;

  private age = 0;

  constructor(readonly ward: Juggernaut_W_Ward) {
    super(ward);
  }

  update(): void {
    // Attached in `onSpellCast`, so this is what ends the ring when the totem
    // is killed, expires or goes down with its summoner.
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.ward.position.x, this.ward.position.y);
    this.age += Math.max(0, deltaTime);
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((W_HEAL_RADIUS + 40) * 2);
  }

  draw(): void {
    const centre = this.position;
    // Winds out over the first 260ms — `1 - (1 - t) * (1 - t)`, so the ring
    // snaps to its real size rather than popping into existence at it.
    const settling = Math.min(1, this.age / 260);
    const opened = 1 - (1 - settling) * (1 - settling);
    const edge = W_HEAL_RADIUS * opened;
    // 1 at the instant a pulse lands, 0 four hundred milliseconds later.
    const mended = Math.max(0, 1 - this.ward.sinceMendMs / 400);

    push();
    noStroke();
    fill(70, 200, 160, 16 + mended * 16);
    circle(centre.x, centre.y, edge * 2);

    // A dashed rim on the real 260, so an ally can tell from across the screen
    // whether they are in it. Dashed rather than solid because it is a friendly
    // area and Q's solid jade rim is a hostile one — two rings on the same
    // champion in the same colour must not read as the same rule.
    //
    // The rim is drawn as one dashed arc rather than as its dashes. It used to
    // be a 42-iteration loop laying down two `line()`s with their own `stroke`
    // and `strokeWeight` in front of each — **252 p5 calls every frame a totem
    // stood**, and p5 charges 6-10x the raw canvas call underneath it, which is
    // most of why this ability measured 11ms a frame. Canvas dashes are
    // measured in pixels *along the path*, so half a segment on and half off
    // around a circle of circumference `TWO_PI * edge` is the same forty-two
    // dashes in the same places, not an approximation of them: same picture,
    // ten calls. The two passes share one `beginPath`, which is the other half
    // of the saving — the bed and the rim are the same circle stroked twice.
    if (edge > 0.5) {
      const ctx = drawingContext;
      const segment = (TWO_PI * edge) / 42;
      ctx.save();
      ctx.setLineDash([segment / 2, segment / 2]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, edge, 0, TWO_PI);
      // the dark bed, so the bright rim reads against pale ground too
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(15, 45, 38, 0.47)';
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(140, 250, 205, ${(150 + mended * 80) / 255})`;
      ctx.stroke();
      ctx.restore();
    }

    // The pulse lands **on** each ally it reached, not in a ring around the
    // totem: a heal number with no picture of who got it teaches nothing.
    if (mended > 0) {
      const risen = 1 - (1 - mended) * (1 - mended);
      for (const ally of this.ward.lastMended) {
        if (ally.isDead || ally.toRemove) continue;
        const body = ally.position;
        noFill();
        stroke(150, 255, 210, 210 * mended);
        strokeWeight(3);
        circle(body.x, body.y, 30 + (1 - mended) * 22);
        // A cross rising off the body, so the direction of the effect agrees
        // with what it does.
        const lift = body.y - 18 - risen * 16;
        stroke(235, 255, 245, 235 * mended);
        strokeWeight(4);
        line(body.x - 7, lift, body.x + 7, lift);
        line(body.x, lift - 7, body.x, lift + 7);
      }
    }
    pop();
  }
}
