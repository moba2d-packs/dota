import type { AttackableUnit, Rectangle } from '@moba2d/core/content/types';
import { api } from '../packApi';

const Spell = api.Spell;
const SpellObject = api.SpellObject;
const Stun = api.buffs.Stun;
const Unit = api.units.AttackableUnit;
const Circle = api.utils.Quadtree.Circle;
const Rectangle = api.utils.Quadtree.Rectangle;
const PredefinedFilters = api.combat.PredefinedFilters;
const VectorUtils = api.utils.VectorUtils;
const SAT = api.utils.SAT;
const hasFlag = api.utils.hasFlag;
const ActionState = api.enums.ActionState;
const slabVertices = api.terrain.slabVertices;
const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;

/**
 * Khe Nứt — the ground opens in a line. Everyone standing on it is thrown down
 * and stunned, and what is left is a wall of raised stone nobody walks through.
 *
 *   press in a direction -> the crack runs out from him and the stone comes up
 *   standing on the line -> damage and a stun, once
 *   afterwards          -> six seconds of terrain, for both teams
 *   it crumbles         -> the ground is ordinary again
 *
 * ## Why it is a wall of its own rather than an entry in the terrain map
 *
 * `TerrainMap`'s quadtree has no `remove`, and anything in it also blocks
 * *vision* — a player-made wall has to be opaque to feet and transparent to
 * eyes, and it has to be able to end. So the slab does its own SAT push-out,
 * exactly as the sibling pack's ice wall does, and implements `DynamicWall` so
 * that anything asking `wallOutlinesInArea` — a hook, a grapple, a dash that
 * sweeps to the first wall — sees it for free.
 *
 * ## The slab does not start at his feet
 *
 * A body *inside* a slab is ejected to its nearest face, and past the midplane
 * that is the far one — so the wall throws it through itself. The caster is the
 * one body that reliably ends up inside, because on a phone the aim point is
 * often on top of his own champion. `Q_START_OFFSET` holds the near end clear
 * of him; everyone else walks in from outside and rests against a face, which
 * is why this only ever looked broken for the caster.
 */
export const Q_LENGTH = 420;
export const Q_THICKNESS = 44;
/** How far ahead of him the stone starts. See the header — this is not decoration. */
export const Q_START_OFFSET = 60;
export const Q_DAMAGE = 26;
export const Q_STUN_MS = 1_200;
export const Q_LIFETIME_MS = 6_000;
export const Q_COOLDOWN_MS = 15_000;
export const Q_MANA = 40;

export default class Earthshaker_Q extends Spell {
  image = api.asset('spell_earthshaker_q');
  name = 'Khe Nứt (Earthshaker_Q)';
  description =
    `Xé toạc mặt đất theo hướng chỉ định, gây ` +
    `<span class="damage">${Q_DAMAGE} sát thương phép</span> và ` +
    `<span class="buff">choáng ${Q_STUN_MS / 1000} giây</span> lên kẻ địch trên đường nứt. ` +
    `Bức tường đá chắn đường trong <span class="time">${Q_LIFETIME_MS / 1000} giây</span>.`;
  coolDown = Q_COOLDOWN_MS;
  manaCost = Q_MANA;
  targetingMode = 'DIRECTION' as const;
  range = Q_LENGTH;

  /** The stone that is standing, for as long as it is. Read by the test. */
  live: Earthshaker_Q_Object | null = null;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      Q_START_OFFSET + Q_LENGTH
    );
    const heading = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);
    const startX = this.owner.position.x + Math.cos(heading) * Q_START_OFFSET;
    const startY = this.owner.position.y + Math.sin(heading) * Q_START_OFFSET;
    const endX = startX + Math.cos(heading) * Q_LENGTH;
    const endY = startY + Math.sin(heading) * Q_LENGTH;

    this.split({ x: startX, y: startY }, { x: endX, y: endY });

    const stone = new Earthshaker_Q_Object(this.owner);
    // Centred on the *slab*, not on him — the near end is held clear of his
    // body, see the header.
    stone.position = createVector((startX + endX) / 2, (startY + endY) / 2);
    stone.angle = heading;
    this.live = stone;
    this.game.objectManager.addObject(stone);
  }

  /**
   * The eruption, once, at cast. Everyone whose body meets the line the stone
   * is about to occupy.
   *
   * **No vision filter** — an area effect touches whoever is standing in it.
   */
  private split(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: midX, y: midY, r: Q_LENGTH / 2 + Q_THICKNESS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of found) {
      if (!victim || victim.isDead || victim.toRemove) continue;
      const reach = Q_THICKNESS / 2 + (victim.collisionRadius || 0);
      if (distanceToSegment(victim.position, from, to) > reach) continue;

      victim.takeDamage(Q_DAMAGE, this.owner, 'MAGIC', 'Khe Nứt');
      // After the damage: `addBuff` refuses a corpse rather than leaving a stun
      // on one.
      if (victim.isDead) continue;
      const floored = new Stun(Q_STUN_MS, this.owner, victim);
      floored.image = this.image;
      floored.stackId = 'dota_earthshaker_q_stun';
      victim.addBuff(floored);
    }
  }

  drawPreview(): void {
    super.drawPreview(Q_START_OFFSET + Q_LENGTH);
  }
}

/** Shortest distance from a point to a segment. The crack is a line, not a disc. */
function distanceToSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number }
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const along = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared)
  );
  return Math.hypot(point.x - (from.x + dx * along), point.y - (from.y + dy * along));
}

/**
 * The raised stone: real terrain for as long as it stands.
 *
 * It blocks from the very first frame rather than after its rise animation —
 * `growth` is the slab coming up on screen, and a barrier you can walk through
 * while it animates is not a barrier.
 */
export class Earthshaker_Q_Object extends SpellObject {
  image = api.asset('spell_earthshaker_q');
  /** Ground art: without this a `SpellObject` paints above the champions. */
  zIndex = GROUND_Z_INDEX;

  angle = 0;
  private ageMs = 0;
  private growth = 0;

  /** Built lazily — `position` and `angle` are assigned after construction. */
  private satPolygon: ReturnType<typeof buildPolygon> | null = null;
  private satCircle = new SAT.Circle(new SAT.Vector(0, 0), 1);
  private satResponse = new SAT.Response();

  update(): void {
    this.ageMs += Math.max(0, deltaTime);
    if (this.ageMs >= Q_LIFETIME_MS) {
      this.toRemove = true;
      return;
    }
    // The slab rising out of the ground, rather than popping in at full height.
    this.growth = lerp(this.growth, 1, 0.25);
    this.shoveBodiesOut();
  }

  /**
   * The push-out. This runs during `objectManager.update()`, i.e. *before*
   * `terrainMap.update()`, so a unit shoved into real terrain by this is shoved
   * back out again in the same frame.
   */
  private shoveBodiesOut(): void {
    if (!this.satPolygon) {
      this.satPolygon = buildPolygon(this.position, this.angle);
    }
    const polygon = this.satPolygon;
    const circle = this.satCircle;
    const response = this.satResponse;

    const bodies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: Math.hypot(Q_LENGTH, Q_THICKNESS) / 2 + 60,
      }),
      // The stone is terrain: it stops both teams, and Earthshaker with them.
      filters: [PredefinedFilters.type(Unit), PredefinedFilters.excludeDead],
    }) as AttackableUnit[];

    for (const body of bodies) {
      // Dashes and blinks clear the stone, exactly as they clear map terrain.
      if (hasFlag(body.stats.actionState, ActionState.IS_GHOSTED)) continue;

      response.clear();
      circle.pos.x = body.position.x;
      circle.pos.y = body.position.y;
      circle.r = body.stats.size.value / 2;

      if (SAT.testPolygonCircle(polygon, circle, response)) {
        body.position.x += response.overlapV.x;
        body.position.y += response.overlapV.y;
        body.onCollideWall?.();
      }
    }
  }

  /** `DynamicWall`: terrain for its whole life, and not one frame longer. */
  get blocksMovement(): boolean {
    return !this.toRemove;
  }

  wallVertices(): { x: number; y: number }[] {
    return slabVertices(this.position, this.angle, Q_LENGTH, Q_THICKNESS);
  }

  /** A long slab, so the box is a square big enough to hold it at any angle. */
  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox(Q_LENGTH + Q_THICKNESS + 40);
  }

  draw(): void {
    const fading =
      this.ageMs > Q_LIFETIME_MS - 500
        ? Math.max(0, (Q_LIFETIME_MS - this.ageMs) / 500)
        : 1;
    const halfLength = Q_LENGTH / 2;
    const halfThickness = (Q_THICKNESS / 2) * this.growth;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    // The crack in the floor underneath, drawn at the slab's true footprint so
    // the blocked line is unambiguous even before the stone is at full height.
    noStroke();
    fill(30, 22, 16, 180 * fading);
    rect(-halfLength, -Q_THICKNESS / 2, Q_LENGTH, Q_THICKNESS);

    // The stone itself, as separate plates rather than one bar: a solid
    // rectangle reads as a UI element, and the plates are what make it terrain.
    const plates = 9;
    for (let i = 0; i < plates; i++) {
      const at = -halfLength + (i + 0.5) * (Q_LENGTH / plates);
      const tall = halfThickness * (0.7 + ((i * 37) % 10) / 22);
      // A dark rim under each plate, drawn per piece — around the whole shape
      // the plates would merge into a blob over any ground colour.
      fill(58, 40, 28, 240 * fading);
      rect(at - Q_LENGTH / plates / 2, -tall, Q_LENGTH / plates, tall * 2);
      fill(126, 96, 66, 240 * fading);
      rect(at - Q_LENGTH / plates / 2 + 2, -tall + 2, Q_LENGTH / plates - 4, tall * 2 - 4);
    }
    pop();
  }
}

/** One SAT rectangle, in world space, turned to the slab's own angle. */
function buildPolygon(position: { x: number; y: number }, angle: number) {
  const halfLength = Q_LENGTH / 2;
  const halfThickness = Q_THICKNESS / 2;
  const polygon = new SAT.Polygon(new SAT.Vector(position.x, position.y), [
    new SAT.Vector(-halfLength, -halfThickness),
    new SAT.Vector(halfLength, -halfThickness),
    new SAT.Vector(halfLength, halfThickness),
    new SAT.Vector(-halfLength, halfThickness),
  ]);
  polygon.setAngle(angle);
  return polygon;
}
