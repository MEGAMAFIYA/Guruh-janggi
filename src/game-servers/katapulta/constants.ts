/**
 * Katapulta — shared constants.
 *
 * These MUST stay in sync with the values used inside
 * `public/games/katapulta/index.html` (the frontend keeps its own copy
 * since it's a plain static file with no build step / bundler access to
 * this module). If you change a number here, change it there too.
 */

export const MAP_WIDTH = 3200;
export const HEART_MAX = 5;
export const COOLDOWN_MS = 5000;
export const MOVE_SPEED = 52; // px/s

export const P1_RANGE: [number, number] = [110, MAP_WIDTH * 0.42];
// Player 2's movement range mirrors player 1's, on the opposite side of the map.
export const P2_RANGE: [number, number] = [
  MAP_WIDTH - P1_RANGE[1],
  MAP_WIDTH - P1_RANGE[0],
];

export const P1_START_X = 300;
export const P2_START_X = MAP_WIDTH - 300;

export type AmmoType = 'stone' | 'triple' | 'explosive';

export const DEFAULT_AMMO: Record<AmmoType, number> = {
  stone: Infinity,
  triple: 4,
  explosive: 2,
};

export const REMATCH_TIMEOUT_MS = 60_000;
// How long a finished match's in-memory state is kept around in case both
// players want a rematch, before it's garbage collected.
export const FINISHED_STATE_TTL_MS = 30 * 60_000;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
