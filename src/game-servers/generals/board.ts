import {
  COLS,
  GENERAL_START_ARMY,
  MOUNTAIN_RATIO,
  NEUTRAL_CITY_ARMY_MAX,
  NEUTRAL_CITY_ARMY_MIN,
  NEUTRAL_CITY_COUNT,
  ROWS,
} from './constants';
import { PlayerRole } from './state-types';

export type TileType = 'empty' | 'mountain' | 'city' | 'general';

export interface Tile {
  type: TileType;
  owner: PlayerRole | null;
  army: number;
}

export interface Coord {
  row: number;
  col: number;
}

/** Row-major flat array, length COLS*ROWS. Index via `tileIndex`. */
export type Board = Tile[];

export function tileIndex(row: number, col: number): number {
  return row * COLS + col;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

export function isAdjacent(a: Coord, b: Coord): boolean {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function bfsConnected(board: Board, from: Coord, to: Coord): boolean {
  const visited = new Set<number>();
  const queue: Coord[] = [from];
  visited.add(tileIndex(from.row, from.col));

  while (queue.length > 0) {
    const cur = queue.shift() as Coord;
    if (cur.row === to.row && cur.col === to.col) return true;
    const neighbors: Coord[] = [
      { row: cur.row - 1, col: cur.col },
      { row: cur.row + 1, col: cur.col },
      { row: cur.row, col: cur.col - 1 },
      { row: cur.row, col: cur.col + 1 },
    ];
    for (const n of neighbors) {
      if (!inBounds(n.row, n.col)) continue;
      const i = tileIndex(n.row, n.col);
      if (visited.has(i)) continue;
      if (board[i].type === 'mountain') continue;
      visited.add(i);
      queue.push(n);
    }
  }
  return false;
}

/**
 * Generates a fresh board: mountains, neutral cities, and each player's
 * starting general — retrying mountain placement (up to 25 times) until
 * the two generals are guaranteed reachable from each other, so a match
 * never spawns into an unwinnable, walled-off map.
 */
export function generateBoard(): { board: Board; general1: Coord; general2: Coord } {
  const general1: Coord = { row: 1, col: 1 };
  const general2: Coord = { row: ROWS - 2, col: COLS - 2 };

  for (let attempt = 0; attempt < 25; attempt++) {
    const board: Board = new Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        board[tileIndex(row, col)] = { type: 'empty', owner: null, army: 0 };
      }
    }

    const isReserved = (row: number, col: number): boolean => {
      const nearG1 = Math.abs(row - general1.row) <= 1 && Math.abs(col - general1.col) <= 1;
      const nearG2 = Math.abs(row - general2.row) <= 1 && Math.abs(col - general2.col) <= 1;
      return nearG1 || nearG2;
    };

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (isReserved(row, col)) continue;
        if (Math.random() < MOUNTAIN_RATIO) {
          board[tileIndex(row, col)] = { type: 'mountain', owner: null, army: 0 };
        }
      }
    }

    if (!bfsConnected(board, general1, general2)) continue; // retry with fresh mountains

    // Neutral cities: random empty, non-reserved tiles.
    let placed = 0;
    let cityAttempts = 0;
    while (placed < NEUTRAL_CITY_COUNT && cityAttempts < 200) {
      cityAttempts += 1;
      const row = randInt(0, ROWS - 1);
      const col = randInt(0, COLS - 1);
      if (isReserved(row, col)) continue;
      const tile = board[tileIndex(row, col)];
      if (tile.type !== 'empty') continue;
      tile.type = 'city';
      tile.army = randInt(NEUTRAL_CITY_ARMY_MIN, NEUTRAL_CITY_ARMY_MAX);
      placed += 1;
    }

    board[tileIndex(general1.row, general1.col)] = {
      type: 'general',
      owner: 'player1',
      army: GENERAL_START_ARMY,
    };
    board[tileIndex(general2.row, general2.col)] = {
      type: 'general',
      owner: 'player2',
      army: GENERAL_START_ARMY,
    };

    return { board, general1, general2 };
  }

  // Extremely unlucky fallback: no mountains at all, so connectivity is
  // trivially guaranteed. (In practice the loop above succeeds almost
  // immediately — this is just a safety net.)
  const board: Board = new Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      board[tileIndex(row, col)] = { type: 'empty', owner: null, army: 0 };
    }
  }
  board[tileIndex(general1.row, general1.col)] = {
    type: 'general',
    owner: 'player1',
    army: GENERAL_START_ARMY,
  };
  board[tileIndex(general2.row, general2.col)] = {
    type: 'general',
    owner: 'player2',
    army: GENERAL_START_ARMY,
  };
  return { board, general1, general2 };
}

export type MoveResult =
  | { ok: false; reason: string }
  | { ok: true; capturedGeneralOf: PlayerRole | null };

/**
 * Resolves one move: `mover` sends all-but-one of the army stacked on
 * `from` into the adjacent tile `to`. Mirrors generals.io's core combat
 * rule: attacker wins if their moving army exceeds the defender's, and
 * capturing an enemy general instantly transfers that entire empire
 * (every tile they owned) to the winner.
 */
export function applyMove(board: Board, mover: PlayerRole, from: Coord, to: Coord): MoveResult {
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col)) {
    return { ok: false, reason: 'out of bounds' };
  }
  if (!isAdjacent(from, to)) return { ok: false, reason: 'not adjacent' };

  const src = board[tileIndex(from.row, from.col)];
  const dst = board[tileIndex(to.row, to.col)];

  if (src.owner !== mover) return { ok: false, reason: 'not your tile' };
  if (src.army <= 1) return { ok: false, reason: 'not enough army' };
  if (dst.type === 'mountain') return { ok: false, reason: 'mountain' };

  const moving = src.army - 1;
  src.army = 1;

  if (dst.owner === mover) {
    dst.army += moving;
    return { ok: true, capturedGeneralOf: null };
  }

  if (moving > dst.army) {
    const defenderOwner = dst.owner;
    const wasGeneral = dst.type === 'general' && defenderOwner !== null;
    dst.army = moving - dst.army;
    dst.owner = mover;

    if (wasGeneral) {
      dst.type = 'city'; // captured capital becomes an ordinary city
      transferEmpire(board, defenderOwner as PlayerRole, mover);
      return { ok: true, capturedGeneralOf: defenderOwner };
    }
    return { ok: true, capturedGeneralOf: null };
  }

  // Defender holds: attacker's committed army is absorbed into the defense.
  dst.army -= moving;
  return { ok: true, capturedGeneralOf: null };
}

/** Every tile owned by `from` changes hands to `to` (army counts kept as-is). */
function transferEmpire(board: Board, from: PlayerRole, to: PlayerRole): void {
  for (const tile of board) {
    if (tile.owner === from) tile.owner = to;
  }
}

export function scoreOf(board: Board, role: PlayerRole): { tiles: number; army: number } {
  let tiles = 0;
  let army = 0;
  for (const tile of board) {
    if (tile.owner === role) {
      tiles += 1;
      army += tile.army;
    }
  }
  return { tiles, army };
}
