import { Board, Coord, generateBoard } from './board';
import { COLS, FINISHED_STATE_TTL_MS, ROWS } from './constants';
import { PlayerRole } from './state-types';

export type { PlayerRole } from './state-types';

export interface GeneralsPlayerState {
  userId: string;
  telegramId: string;
  firstName: string;
  connected: boolean;
  socketId: string | null;
  present: boolean;
  rematchReady: boolean;
  lastMoveAt: number;
}

export interface GeneralsMatchState {
  matchId: string;
  status: 'waiting' | 'playing' | 'finished';
  winner: PlayerRole | null;
  winReason: 'capture' | 'timeout' | 'forfeit' | null;
  board: Board;
  general1: Coord;
  general2: Coord;
  players: Record<PlayerRole, GeneralsPlayerState>;
  startedAt: number | null;
  fastTicksSinceSlow: number;
  tickTimer: NodeJS.Timeout | null;
  gcTimer: NodeJS.Timeout | null;
  rematchTimer: NodeJS.Timeout | null;
  disconnectTimers: Record<PlayerRole, NodeJS.Timeout | null>;
}

const matchStates = new Map<string, GeneralsMatchState>();

function freshPlayer(userId: string, telegramId: string, firstName: string): GeneralsPlayerState {
  return {
    userId,
    telegramId,
    firstName,
    connected: false,
    socketId: null,
    present: false,
    rematchReady: false,
    lastMoveAt: 0,
  };
}

export function getOrCreateMatchState(
  matchId: string,
  dbPlayers: { userId: string; telegramId: string; firstName: string }[],
): GeneralsMatchState {
  let state = matchStates.get(matchId);
  if (state) return state;

  const [p1, p2] = dbPlayers;
  const { board, general1, general2 } = generateBoard();
  state = {
    matchId,
    status: 'waiting',
    winner: null,
    winReason: null,
    board,
    general1,
    general2,
    players: {
      player1: freshPlayer(p1.userId, p1.telegramId, p1.firstName),
      player2: freshPlayer(p2.userId, p2.telegramId, p2.firstName),
    },
    startedAt: null,
    fastTicksSinceSlow: 0,
    tickTimer: null,
    gcTimer: null,
    rematchTimer: null,
    disconnectTimers: { player1: null, player2: null },
  };
  matchStates.set(matchId, state);
  return state;
}

export function getMatchState(matchId: string): GeneralsMatchState | undefined {
  return matchStates.get(matchId);
}

export function deleteMatchState(matchId: string): void {
  const state = matchStates.get(matchId);
  if (state) {
    if (state.gcTimer) clearTimeout(state.gcTimer);
    if (state.rematchTimer) clearTimeout(state.rematchTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    for (const role of ['player1', 'player2'] as PlayerRole[]) {
      const t = state.disconnectTimers[role];
      if (t) clearTimeout(t);
    }
  }
  matchStates.delete(matchId);
}

export function roleForUser(state: GeneralsMatchState, userId: string): PlayerRole | null {
  if (state.players.player1.userId === userId) return 'player1';
  if (state.players.player2.userId === userId) return 'player2';
  return null;
}

export function opponentRole(role: PlayerRole): PlayerRole {
  return role === 'player1' ? 'player2' : 'player1';
}

export function resetMatchState(state: GeneralsMatchState): void {
  const { board, general1, general2 } = generateBoard();
  state.board = board;
  state.general1 = general1;
  state.general2 = general2;
  state.status = 'playing';
  state.winner = null;
  state.winReason = null;
  state.startedAt = Date.now();
  state.fastTicksSinceSlow = 0;
  for (const role of ['player1', 'player2'] as PlayerRole[]) {
    state.players[role].rematchReady = false;
    state.players[role].lastMoveAt = 0;
  }
}

/** Schedule cleanup of the in-memory state a while after the match ends. */
export function scheduleCleanup(matchId: string): void {
  const state = matchStates.get(matchId);
  if (!state) return;
  if (state.gcTimer) clearTimeout(state.gcTimer);
  state.gcTimer = setTimeout(() => {
    matchStates.delete(matchId);
  }, FINISHED_STATE_TTL_MS);
}

export function cancelCleanup(state: GeneralsMatchState): void {
  if (state.gcTimer) {
    clearTimeout(state.gcTimer);
    state.gcTimer = null;
  }
}

/** Public board snapshot — safe to send to clients (no fog of war: full visibility). */
export function serializeBoard(state: GeneralsMatchState) {
  return {
    cols: COLS,
    rows: ROWS,
    tiles: state.board.map((t) => ({ type: t.type, owner: t.owner, army: t.army })),
  };
}

export function serializePublicState(state: GeneralsMatchState) {
  return {
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    board: serializeBoard(state),
    player1: { connected: state.players.player1.connected, present: state.players.player1.present },
    player2: { connected: state.players.player2.connected, present: state.players.player2.present },
  };
}
