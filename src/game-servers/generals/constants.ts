/**
 * Generals — shared constants.
 *
 * A simplified, mobile-friendly, territory-capture strategy game in the
 * spirit of the well-known "generals.io" browser game (grid map, armies
 * that grow over time, capture the enemy general to win the whole board).
 * It is an original implementation — original board generation, original
 * combat numbers, no borrowed art or code — not a port of any specific
 * game's assets.
 *
 * Unlike Katapulta (client-simulated physics, server just relays), Generals
 * is fully server-authoritative: the server owns the only copy of the
 * board and resolves every move itself. This is both simpler to get right
 * and much harder to cheat at than trusting client-reported outcomes.
 */

export const COLS = 9;
export const ROWS = 11;

// Fraction of non-special tiles turned into impassable mountains.
export const MOUNTAIN_RATIO = 0.14;
export const NEUTRAL_CITY_COUNT = 5;
export const NEUTRAL_CITY_ARMY_MIN = 35;
export const NEUTRAL_CITY_ARMY_MAX = 50;

export const GENERAL_START_ARMY = 1;

// Every tile a player owns that is a 'general' or 'city' gains +1 army
// each FAST tick. Every tile a player owns (including plain captured
// tiles) gains +1 army each SLOW tick. This mirrors generals.io's growth
// model at a pace tuned for a short mobile match instead of its ~25s cycle.
export const FAST_TICK_MS = 1_500;
export const SLOW_TICK_EVERY_N_FAST_TICKS = 6; // → slow tick every 9s

// Minimum time between two moves accepted from the same player — prevents
// a modified client from spamming moves faster than the UI allows.
export const MOVE_COOLDOWN_MS = 150;

// If nobody has captured the other player's general by this point, the
// match ends in a score-based decision instead of running forever.
export const MATCH_TIME_LIMIT_MS = 8 * 60_000;

export const REMATCH_TIMEOUT_MS = 60_000;
export const FINISHED_STATE_TTL_MS = 30 * 60_000;
export const DISCONNECT_FORFEIT_MS = 45_000;
