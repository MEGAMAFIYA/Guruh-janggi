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

// If a player disconnects mid-game and doesn't come back within this window,
// they forfeit and the opponent is declared the winner. Without this, a
// player who closes the tab mid-match leaves their opponent's client sitting
// in "playing" state forever, waiting for someone who is never coming back —
// and the in-memory match state itself is never scheduled for cleanup since
// nothing ever transitions it to 'finished'.
export const DISCONNECT_FORFEIT_MS = 45_000;

// Anti-cheat bound: how many outstanding "I hit you" credits a shot can
// grant its shooter. A single stone/explosive shot can land at most one
// hit; 'triple' fires several projectiles per shot, so it's allowed a
// little more credit. This is intentionally generous rather than exact —
// the goal is only to stop a client from reporting unlimited damage with
// zero corresponding shots fired, not to simulate physics server-side.
export const HITS_PER_SHOT: Record<AmmoType, number> = {
  stone: 1,
  explosive: 1,
  triple: 3,
};
export const MAX_PENDING_HITS = 6;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
