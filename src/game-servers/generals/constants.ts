/**
 * Generals — original, server-authoritative 1v1 base-building RTS.
 *
 * Not a port or clone of any specific commercial game — original numbers,
 * original naming, no borrowed art/assets. Genre mechanics (build a base,
 * train units, mass an army, destroy the enemy base) are generic to the
 * real-time-strategy genre and not tied to any one title.
 *
 * v1 scope (per product decision): one building type (Barracks) producing
 * one unit type (Soldier), passive base income, open field (no terrain).
 * More buildings/units/resource-gathering are meant to layer on top of
 * this same engine later — the sim is written so that's additive, not a
 * rewrite (see BUILDING_DEFS / UNIT_DEFS below).
 */

export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 1200;

// Player 1's Command Center sits near the top of the map, Player 2's near
// the bottom — a portrait phone screen shows the whole map at once (no
// camera pan/zoom in v1), so top/bottom reads more naturally than
// left/right on a tall screen.
export const P1_BASE = { x: MAP_WIDTH / 2, y: 130 };
export const P2_BASE = { x: MAP_WIDTH / 2, y: MAP_HEIGHT - 130 };

export const STARTING_RESOURCE = 200;
// Passive income per Command Center still standing, applied once per
// RESOURCE_INTERVAL_MS. (No harvester/resource-node economy yet — that's
// intentionally left for a later iteration, per product decision.)
export const RESOURCE_INTERVAL_MS = 1_500;
export const RESOURCE_PER_INTERVAL = 5;

export const SIM_TICK_MS = 150;
export const MATCH_TIME_LIMIT_MS = 12 * 60_000;

export const REMATCH_TIMEOUT_MS = 60_000;
export const FINISHED_STATE_TTL_MS = 30 * 60_000;
export const DISCONNECT_FORFEIT_MS = 45_000;

// How close a new building must be to one of the player's own buildings to
// be placeable — keeps bases coherent instead of buildings dropped at
// random anywhere on the map (which would also trivialize "rush the enemy
// base" since you could just plant a barracks next to it).
export const BUILD_RANGE_FROM_OWN_BUILDING = 260;
// Minimum gap kept between any two buildings so they never overlap.
export const BUILDING_MIN_GAP = 55;

export type BuildingKind = 'commandCenter' | 'barracks';
export type UnitKind = 'soldier';

export interface BuildingDef {
  kind: BuildingKind;
  hp: number;
  radius: number; // for placement/overlap + rendering
  cost: number; // 0 = not player-buildable (only spawned at match start)
  buildTimeMs: number;
  canProduce: UnitKind[]; // unit kinds this building type can train
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  commandCenter: {
    kind: 'commandCenter',
    hp: 1000,
    radius: 42,
    cost: 0,
    buildTimeMs: 0,
    canProduce: [],
  },
  barracks: {
    kind: 'barracks',
    hp: 400,
    radius: 28,
    cost: 150,
    buildTimeMs: 8_000,
    canProduce: ['soldier'],
  },
};

export interface UnitDef {
  kind: UnitKind;
  hp: number;
  radius: number;
  cost: number;
  trainTimeMs: number;
  damage: number;
  attackRange: number;
  attackCooldownMs: number;
  speed: number; // world units per second
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  soldier: {
    kind: 'soldier',
    hp: 50,
    radius: 10,
    cost: 25,
    trainTimeMs: 3_000,
    damage: 9,
    attackRange: 55,
    attackCooldownMs: 900,
    speed: 70,
  },
};

// A building's production queue can only hold this many orders at once —
// stops one player from queueing hundreds of units in a single burst and
// dominating the server's per-tick work.
export const MAX_QUEUE_LENGTH = 5;
