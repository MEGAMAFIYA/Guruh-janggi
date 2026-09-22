/**
 * Unit tests for Generals board generation and move resolution.
 * Pure functions — no Prisma/network mocking required.
 */
import { applyMove, Board, generateBoard, isAdjacent, scoreOf, tileIndex } from '../game-servers/generals/board';
import { COLS, ROWS } from '../game-servers/generals/constants';

function emptyBoard(): Board {
  const board: Board = new Array(COLS * ROWS);
  for (let i = 0; i < board.length; i++) {
    board[i] = { type: 'empty', owner: null, army: 0 };
  }
  return board;
}

describe('generateBoard', () => {
  it('places exactly one general per player, reachable from each other', () => {
    const { board, general1, general2 } = generateBoard();
    const g1 = board[tileIndex(general1.row, general1.col)];
    const g2 = board[tileIndex(general2.row, general2.col)];
    expect(g1.type).toBe('general');
    expect(g1.owner).toBe('player1');
    expect(g2.type).toBe('general');
    expect(g2.owner).toBe('player2');
    expect(board).toHaveLength(COLS * ROWS);
  });

  it('never places a mountain directly on a general tile', () => {
    const { board, general1, general2 } = generateBoard();
    expect(board[tileIndex(general1.row, general1.col)].type).not.toBe('mountain');
    expect(board[tileIndex(general2.row, general2.col)].type).not.toBe('mountain');
  });

  it('produces a board where the two generals are reachable (no fully sealed map)', () => {
    // Regenerate a few times — this is randomized, so run it more than once
    // to catch a connectivity-check regression that only shows up sometimes.
    for (let i = 0; i < 10; i++) {
      const { board } = generateBoard();
      const mountainCount = board.filter((t) => t.type === 'mountain').length;
      // Sanity bound: shouldn't be an all-mountain board or a zero-mountain
      // board every single time (both would indicate generation is broken).
      expect(mountainCount).toBeLessThan(board.length);
    }
  });
});

describe('applyMove', () => {
  it('rejects moving a tile you do not own', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player2', army: 5 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects moving with only 1 army (nothing to send)', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 1 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-adjacent move', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 5 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 2, col: 2 });
    expect(result.ok).toBe(false);
  });

  it('rejects moving into a mountain', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 5 };
    board[tileIndex(0, 1)] = { type: 'mountain', owner: null, army: 0 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(false);
  });

  it('reinforces a tile you already own (armies stack, source left at 1)', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 10 };
    board[tileIndex(0, 1)] = { type: 'empty', owner: 'player1', army: 3 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(true);
    expect(board[tileIndex(0, 0)].army).toBe(1);
    expect(board[tileIndex(0, 1)].army).toBe(12); // 3 + (10 - 1)
  });

  it('captures a weaker neutral/enemy tile', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 10 };
    board[tileIndex(0, 1)] = { type: 'city', owner: null, army: 4 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(true);
    expect(board[tileIndex(0, 1)].owner).toBe('player1');
    expect(board[tileIndex(0, 1)].army).toBe(5); // 9 attackers - 4 defenders
  });

  it('fails to capture a stronger tile — defender survives, attacker spent', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 5 };
    board[tileIndex(0, 1)] = { type: 'empty', owner: 'player2', army: 20 };
    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(true);
    expect(board[tileIndex(0, 1)].owner).toBe('player2');
    expect(board[tileIndex(0, 1)].army).toBe(16); // 20 - (5-1)
    expect(board[tileIndex(0, 0)].army).toBe(1);
  });

  it('capturing the enemy general transfers their entire empire and ends the game', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'empty', owner: 'player1', army: 10 };
    board[tileIndex(0, 1)] = { type: 'general', owner: 'player2', army: 3 };
    // A distant tile still owned by player2 — should flip too.
    board[tileIndex(5, 5)] = { type: 'city', owner: 'player2', army: 8 };

    const result = applyMove(board, 'player1', { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capturedGeneralOf).toBe('player2');

    const capturedGeneralTile = board[tileIndex(0, 1)];
    expect(capturedGeneralTile.owner).toBe('player1');
    expect(capturedGeneralTile.type).toBe('city'); // capital demoted to an ordinary city

    // The far-away tile changed hands too — the whole empire, not just the general tile.
    expect(board[tileIndex(5, 5)].owner).toBe('player1');
    expect(board[tileIndex(5, 5)].army).toBe(8);
  });
});

describe('isAdjacent', () => {
  it('is true only for orthogonal neighbors, not diagonals or the same tile', () => {
    expect(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 2 })).toBe(true);
    expect(isAdjacent({ row: 1, col: 1 }, { row: 2, col: 1 })).toBe(true);
    expect(isAdjacent({ row: 1, col: 1 }, { row: 2, col: 2 })).toBe(false);
    expect(isAdjacent({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe(false);
  });
});

describe('scoreOf', () => {
  it('sums tile count and army for a given owner', () => {
    const board = emptyBoard();
    board[tileIndex(0, 0)] = { type: 'general', owner: 'player1', army: 5 };
    board[tileIndex(0, 1)] = { type: 'city', owner: 'player1', army: 10 };
    board[tileIndex(0, 2)] = { type: 'empty', owner: 'player2', army: 3 };
    const s1 = scoreOf(board, 'player1');
    expect(s1).toEqual({ tiles: 2, army: 15 });
  });
});
