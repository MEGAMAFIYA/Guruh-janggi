import {
  BUILDING_DEFS,
  BUILD_RANGE_FROM_OWN_BUILDING,
  BUILDING_MIN_GAP,
  BuildingKind,
  MAP_HEIGHT,
  MAP_WIDTH,
  MATCH_TIME_LIMIT_MS,
  MAX_QUEUE_LENGTH,
  P1_BASE,
  P2_BASE,
  RESOURCE_INTERVAL_MS,
  RESOURCE_PER_INTERVAL,
  STARTING_RESOURCE,
  UNIT_DEFS,
  UnitKind,
} from './constants';
import { PlayerRole } from './state-types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface UnitInstance {
  id: string;
  ownerId: PlayerRole;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  moveTarget: Vec2 | null;
  attackTargetId: string | null; // a unit id OR a building id
  lastAttackAt: number;
}

export interface ProductionOrder {
  id: string;
  kind: UnitKind;
  queuedAt: number;
  readyAt: number;
}

export interface BuildingInstance {
  id: string;
  ownerId: PlayerRole;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  constructionEndsAt: number | null; // null once construction is complete
  queue: ProductionOrder[];
}

export interface RtsWorld {
  units: Map<string, UnitInstance>;
  buildings: Map<string, BuildingInstance>;
  resources: Record<PlayerRole, number>;
  lastResourceTickAt: number;
  nextEntityId: number;
  startedAt: number;
}

function opponentOf(role: PlayerRole): PlayerRole {
  return role === 'player1' ? 'player2' : 'player1';
}

function nextId(world: RtsWorld, prefix: string): string {
  world.nextEntityId += 1;
  return `${prefix}${world.nextEntityId}`;
}

export function createWorld(now: number): RtsWorld {
  const world: RtsWorld = {
    units: new Map(),
    buildings: new Map(),
    resources: { player1: STARTING_RESOURCE, player2: STARTING_RESOURCE },
    lastResourceTickAt: now,
    nextEntityId: 0,
    startedAt: now,
  };

  const cc = BUILDING_DEFS.commandCenter;
  const b1: BuildingInstance = {
    id: nextId(world, 'b'),
    ownerId: 'player1',
    kind: 'commandCenter',
    x: P1_BASE.x,
    y: P1_BASE.y,
    hp: cc.hp,
    maxHp: cc.hp,
    constructionEndsAt: null,
    queue: [],
  };
  const b2: BuildingInstance = {
    id: nextId(world, 'b'),
    ownerId: 'player2',
    kind: 'commandCenter',
    x: P2_BASE.x,
    y: P2_BASE.y,
    hp: cc.hp,
    maxHp: cc.hp,
    constructionEndsAt: null,
    queue: [],
  };
  world.units = new Map();
  world.buildings.set(b1.id, b1);
  world.buildings.set(b2.id, b2);
  return world;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type OrderResult = { ok: true } | { ok: false; reason: string };

/**
 * Queues construction of a new building for `role` at (x, y). Deducts the
 * cost immediately (refunded nowhere — matching classic RTS convention: a
 * cancelled build is a sunk cost, kept simple for v1). The building exists
 * in the world right away in "under construction" state so it visibly
 * occupies space and can be targeted/destroyed while building, but cannot
 * produce anything until `constructionEndsAt` passes.
 */
export function placeBuilding(
  world: RtsWorld,
  role: PlayerRole,
  kind: BuildingKind,
  x: number,
  y: number,
  now: number,
): OrderResult {
  const def = BUILDING_DEFS[kind];
  if (!def || def.cost <= 0) return { ok: false, reason: 'not buildable' };
  if (world.resources[role] < def.cost) return { ok: false, reason: 'not enough resource' };
  if (x < 0 || x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return { ok: false, reason: 'out of bounds' };

  let nearOwnBuilding = false;
  for (const b of world.buildings.values()) {
    if (b.ownerId !== role) continue;
    if (dist(b, { x, y }) <= BUILD_RANGE_FROM_OWN_BUILDING) nearOwnBuilding = true;
  }
  if (!nearOwnBuilding) return { ok: false, reason: 'too far from your base' };

  for (const b of world.buildings.values()) {
    const minGap = def.radius + BUILDING_DEFS[b.kind].radius + BUILDING_MIN_GAP;
    if (dist(b, { x, y }) < minGap) {
      return { ok: false, reason: 'overlaps another building' };
    }
  }

  world.resources[role] -= def.cost;
  const building: BuildingInstance = {
    id: nextId(world, 'b'),
    ownerId: role,
    kind,
    x,
    y,
    hp: Math.max(1, Math.round(def.hp * 0.2)), // buildings start weak, hp ramps up as they finish (see tick())
    maxHp: def.hp,
    constructionEndsAt: now + def.buildTimeMs,
    queue: [],
  };
  world.buildings.set(building.id, building);
  return { ok: true };
}

/** Queues training of a unit at an owned, completed building that can produce it. */
export function queueUnit(
  world: RtsWorld,
  role: PlayerRole,
  buildingId: string,
  kind: UnitKind,
  now: number,
): OrderResult {
  const building = world.buildings.get(buildingId);
  if (!building || building.ownerId !== role) return { ok: false, reason: 'not your building' };
  if (building.constructionEndsAt !== null) return { ok: false, reason: 'still under construction' };
  const buildingDef = BUILDING_DEFS[building.kind];
  if (!buildingDef.canProduce.includes(kind)) return { ok: false, reason: 'cannot produce this unit' };
  if (building.queue.length >= MAX_QUEUE_LENGTH) return { ok: false, reason: 'queue full' };

  const unitDef = UNIT_DEFS[kind];
  if (world.resources[role] < unitDef.cost) return { ok: false, reason: 'not enough resource' };

  world.resources[role] -= unitDef.cost;
  const prevOrder = building.queue[building.queue.length - 1];
  const startAt = prevOrder ? prevOrder.readyAt : now;
  building.queue.push({
    id: nextId(world, 'o'),
    kind,
    queuedAt: now,
    readyAt: startAt + unitDef.trainTimeMs,
  });
  return { ok: true };
}

/** Sets a move order for a batch of the caller's own, currently-alive units. */
export function issueMoveOrder(
  world: RtsWorld,
  role: PlayerRole,
  unitIds: string[],
  x: number,
  y: number,
): void {
  const tx = Math.max(0, Math.min(MAP_WIDTH, x));
  const ty = Math.max(0, Math.min(MAP_HEIGHT, y));
  for (const id of unitIds) {
    const unit = world.units.get(id);
    if (!unit || unit.ownerId !== role) continue;
    unit.moveTarget = { x: tx, y: ty };
    // A fresh move order always takes priority over whatever the unit was
    // shooting at — otherwise units could get "stuck" fighting forever and
    // never actually reach a rally point the player picked.
    unit.attackTargetId = null;
  }
}

interface Combatant {
  id: string;
  ownerId: PlayerRole;
  x: number;
  y: number;
  hp: number;
}

function findNearestEnemy(
  world: RtsWorld,
  self: Combatant,
  range: number,
): { id: string; kind: 'unit' | 'building' } | null {
  let best: { id: string; kind: 'unit' | 'building'; d: number } | null = null;
  for (const u of world.units.values()) {
    if (u.ownerId === self.ownerId) continue;
    const d = dist(self, u);
    if (d <= range && (!best || d < best.d)) best = { id: u.id, kind: 'unit', d };
  }
  for (const b of world.buildings.values()) {
    if (b.ownerId === self.ownerId) continue;
    const d = dist(self, b);
    if (d <= range && (!best || d < best.d)) best = { id: b.id, kind: 'building', d };
  }
  return best ? { id: best.id, kind: best.kind } : null;
}

export type TickResult =
  | { ended: false }
  | { ended: true; winner: PlayerRole; reason: 'destroyed' | 'timeout' };

/**
 * Advances the world by `dtMs` milliseconds: resource income, construction
 * progress, production queues, unit movement, and simple auto-combat
 * ("walk toward your move order; if an enemy comes within range along the
 * way, stop and fight it until it dies or moves out of range").
 */
export function tick(world: RtsWorld, now: number, dtMs: number): TickResult {
  const dt = dtMs / 1000;

  // ── Economy ──────────────────────────────────────────────────────────
  if (now - world.lastResourceTickAt >= RESOURCE_INTERVAL_MS) {
    world.lastResourceTickAt = now;
    for (const b of world.buildings.values()) {
      if (b.kind === 'commandCenter' && b.constructionEndsAt === null) {
        world.resources[b.ownerId] += RESOURCE_PER_INTERVAL;
      }
    }
  }

  // ── Construction & production ───────────────────────────────────────
  for (const b of world.buildings.values()) {
    if (b.constructionEndsAt !== null) {
      const def = BUILDING_DEFS[b.kind];
      const totalMs = def.buildTimeMs || 1;
      const startHp = Math.max(1, Math.round(def.hp * 0.2));
      const elapsed = totalMs - Math.max(0, b.constructionEndsAt - now);
      const progress = Math.max(0, Math.min(1, elapsed / totalMs));
      b.hp = Math.round(startHp + (def.hp - startHp) * progress);
      if (now >= b.constructionEndsAt) {
        b.constructionEndsAt = null;
        b.hp = def.hp;
      }
      continue; // a building under construction doesn't produce units yet
    }

    while (b.queue.length > 0 && b.queue[0].readyAt <= now) {
      const order = b.queue.shift() as ProductionOrder;
      const unitDef = UNIT_DEFS[order.kind];
      // Spawn just outside the building's footprint, in a random direction,
      // so units don't all stack exactly on the building's center point.
      const angle = Math.random() * Math.PI * 2;
      const spawnR = BUILDING_DEFS[b.kind].radius + unitDef.radius + 8;
      const unit: UnitInstance = {
        id: nextId(world, 'u'),
        ownerId: b.ownerId,
        kind: order.kind,
        x: Math.max(0, Math.min(MAP_WIDTH, b.x + Math.cos(angle) * spawnR)),
        y: Math.max(0, Math.min(MAP_HEIGHT, b.y + Math.sin(angle) * spawnR)),
        hp: unitDef.hp,
        maxHp: unitDef.hp,
        moveTarget: null,
        attackTargetId: null,
        lastAttackAt: 0,
      };
      world.units.set(unit.id, unit);
    }
  }

  // ── Units: acquire targets, fight, or move ──────────────────────────
  for (const unit of world.units.values()) {
    const def = UNIT_DEFS[unit.kind];

    let target: Combatant | null = null;
    if (unit.attackTargetId) {
      target =
        world.units.get(unit.attackTargetId) ?? world.buildings.get(unit.attackTargetId) ?? null;
      if (target && dist(unit, target) > def.attackRange) target = null; // walked/was pushed out of range
    }
    if (!target) {
      const found = findNearestEnemy(world, unit, def.attackRange);
      if (found) {
        target = (found.kind === 'unit' ? world.units.get(found.id) : world.buildings.get(found.id)) ?? null;
        unit.attackTargetId = found.id;
      } else {
        unit.attackTargetId = null;
      }
    }

    if (target) {
      if (now - unit.lastAttackAt >= def.attackCooldownMs) {
        unit.lastAttackAt = now;
        target.hp -= def.damage;
      }
      continue; // engaged — doesn't advance toward its move order this tick
    }

    if (unit.moveTarget) {
      const dx = unit.moveTarget.x - unit.x;
      const dy = unit.moveTarget.y - unit.y;
      const d = Math.hypot(dx, dy);
      const step = def.speed * dt;
      if (d <= step) {
        unit.x = unit.moveTarget.x;
        unit.y = unit.moveTarget.y;
        unit.moveTarget = null;
      } else {
        unit.x += (dx / d) * step;
        unit.y += (dy / d) * step;
      }
    }
  }

  // ── Cleanup: remove the dead ─────────────────────────────────────────
  for (const [id, u] of world.units) {
    if (u.hp <= 0) world.units.delete(id);
  }
  for (const [id, b] of world.buildings) {
    if (b.hp <= 0) world.buildings.delete(id);
  }
  // A unit's attack/move target may have just died — drop stale references
  // so next tick's target-acquisition runs clean instead of re-checking a
  // dead id every tick until a new order arrives.
  for (const unit of world.units.values()) {
    if (unit.attackTargetId && !world.units.has(unit.attackTargetId) && !world.buildings.has(unit.attackTargetId)) {
      unit.attackTargetId = null;
    }
  }

  // ── Win condition: a player with zero Command Centers has lost ──────
  const hasCC: Record<PlayerRole, boolean> = { player1: false, player2: false };
  for (const b of world.buildings.values()) {
    if (b.kind === 'commandCenter') hasCC[b.ownerId] = true;
  }
  if (!hasCC.player1 && !hasCC.player2) {
    // Simultaneous destruction (rare edge case) — no winner, just end flagged
    // by the caller checking both false; treat as player1 loses ties go to
    // whoever the caller prefers. Caller (socketHandlers) treats this as a
    // draw by declaring neither side — see usage.
    return { ended: true, winner: 'player1', reason: 'destroyed' };
  }
  if (!hasCC.player1) return { ended: true, winner: 'player2', reason: 'destroyed' };
  if (!hasCC.player2) return { ended: true, winner: 'player1', reason: 'destroyed' };

  if (now - world.startedAt >= MATCH_TIME_LIMIT_MS) {
    const score = (role: PlayerRole) => {
      let v = 0;
      for (const u of world.units.values()) if (u.ownerId === role) v += u.hp;
      for (const b of world.buildings.values()) if (b.ownerId === role) v += b.hp;
      return v;
    };
    const s1 = score('player1');
    const s2 = score('player2');
    return { ended: true, winner: s1 >= s2 ? 'player1' : 'player2', reason: 'timeout' };
  }

  return { ended: false };
}

export function scoreOf(world: RtsWorld, role: PlayerRole): { units: number; buildings: number; resource: number } {
  let units = 0;
  let buildings = 0;
  for (const u of world.units.values()) if (u.ownerId === role) units += 1;
  for (const b of world.buildings.values()) if (b.ownerId === role) buildings += 1;
  return { units, buildings, resource: world.resources[role] };
}
