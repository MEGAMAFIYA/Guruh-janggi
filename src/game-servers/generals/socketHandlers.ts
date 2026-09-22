import { Server as SocketIOServer, Socket } from 'socket.io';
import { MatchWithPlayers, finishMatch } from '../../services/matchService';
import { applyMove, Coord, scoreOf } from './board';
import {
  DISCONNECT_FORFEIT_MS,
  FAST_TICK_MS,
  MATCH_TIME_LIMIT_MS,
  MOVE_COOLDOWN_MS,
  REMATCH_TIMEOUT_MS,
  SLOW_TICK_EVERY_N_FAST_TICKS,
} from './constants';
import {
  GeneralsMatchState,
  PlayerRole,
  cancelCleanup,
  getOrCreateMatchState,
  opponentRole,
  resetMatchState,
  roleForUser,
  scheduleCleanup,
  serializeBoard,
  serializePublicState,
} from './state';

function endGame(
  io: SocketIOServer,
  room: string,
  matchId: string,
  state: GeneralsMatchState,
  winner: PlayerRole | null,
  reason: 'capture' | 'timeout' | 'forfeit',
): void {
  if (state.status !== 'playing') return;
  state.status = 'finished';
  state.winner = winner;
  state.winReason = reason;
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  io.to(room).emit('generals:gameOver', { winner, reason });
  finishMatch(matchId).catch((err) => {
    console.error('[generals] finishMatch failed:', err);
  });
  scheduleCleanup(matchId);
}

function startTickLoop(io: SocketIOServer, room: string, matchId: string, state: GeneralsMatchState): void {
  if (state.tickTimer) return; // already running
  state.startedAt = Date.now();
  state.fastTicksSinceSlow = 0;

  state.tickTimer = setInterval(() => {
    if (state.status !== 'playing') return;

    const isSlowTick = state.fastTicksSinceSlow >= SLOW_TICK_EVERY_N_FAST_TICKS;
    if (isSlowTick) state.fastTicksSinceSlow = 0;
    else state.fastTicksSinceSlow += 1;

    for (const tile of state.board) {
      if (!tile.owner) continue;
      if (tile.type === 'general' || tile.type === 'city') {
        tile.army += 1;
      } else if (isSlowTick) {
        tile.army += 1;
      }
    }

    io.to(room).emit('generals:boardUpdate', { board: serializeBoard(state) });

    if (state.startedAt && Date.now() - state.startedAt >= MATCH_TIME_LIMIT_MS) {
      const s1 = scoreOf(state.board, 'player1');
      const s2 = scoreOf(state.board, 'player2');
      let winner: PlayerRole | null;
      if (s1.army !== s2.army) winner = s1.army > s2.army ? 'player1' : 'player2';
      else if (s1.tiles !== s2.tiles) winner = s1.tiles > s2.tiles ? 'player1' : 'player2';
      else winner = 'player1'; // fully tied — arbitrary but deterministic
      endGame(io, room, matchId, state, winner, 'timeout');
    }
  }, FAST_TICK_MS);
}

/**
 * Wires up all `generals:*` events for one authenticated socket connection.
 * Must only be called when `match.game.slug === 'generals'`.
 * The socket has already joined room `match:<matchId>` in server.ts.
 */
export function registerGeneralsHandlers(
  io: SocketIOServer,
  socket: Socket,
  match: MatchWithPlayers,
): void {
  const matchId = match.id;
  const room = `match:${matchId}`;
  const userId = socket.data.userId as string;

  const dbPlayers = match.players.map((p) => ({
    userId: p.userId,
    telegramId: p.user.telegramId.toString(),
    firstName: p.user.firstName,
  }));

  if (dbPlayers.length < 2) {
    socket.emit('generals:error', 'Match hali 2 o\'yinchiga to\'lmagan');
    return;
  }

  const state = getOrCreateMatchState(matchId, dbPlayers);
  cancelCleanup(state);

  const role = roleForUser(state, userId);
  if (!role) {
    socket.emit('generals:error', 'Siz bu matchning ishtirokchisi emassiz');
    return;
  }

  const me = state.players[role];
  me.connected = true;
  me.socketId = socket.id;

  const pendingForfeit = state.disconnectTimers[role];
  if (pendingForfeit) {
    clearTimeout(pendingForfeit);
    state.disconnectTimers[role] = null;
  }

  const opp = opponentRole(role);
  const oppState = state.players[opp];

  socket.emit('generals:youAre', {
    role,
    opponentName: oppState.firstName,
    opponentPresent: oppState.present,
    state: serializePublicState(state),
  });

  if (state.status === 'playing') {
    socket.emit('generals:stateSync', { state: serializePublicState(state) });
    io.to(room).emit('generals:opponentReconnected', { role });
  }

  socket.on('generals:imHere', () => {
    if (me.present) return;
    me.present = true;
    socket.to(room).emit('generals:opponentHere', { role });

    if (state.status === 'waiting' && me.present && oppState.present) {
      state.status = 'playing';
      startTickLoop(io, room, matchId, state);
      io.to(room).emit('generals:bothReady', { state: serializePublicState(state) });
    }
  });

  // ── Moves ───────────────────────────────────────────────────────────────
  socket.on(
    'generals:move',
    (payload: { fromRow: number; fromCol: number; toRow: number; toCol: number }) => {
      if (state.status !== 'playing') return;

      const now = Date.now();
      if (now - me.lastMoveAt < MOVE_COOLDOWN_MS) return;

      const from: Coord = { row: Number(payload?.fromRow), col: Number(payload?.fromCol) };
      const to: Coord = { row: Number(payload?.toRow), col: Number(payload?.toCol) };
      if (
        !Number.isInteger(from.row) || !Number.isInteger(from.col) ||
        !Number.isInteger(to.row) || !Number.isInteger(to.col)
      ) {
        return;
      }

      const result = applyMove(state.board, role, from, to);
      if (!result.ok) return; // invalid move — silently ignored, client re-syncs on next tick

      me.lastMoveAt = now;
      io.to(room).emit('generals:boardUpdate', { board: serializeBoard(state) });

      if (result.capturedGeneralOf) {
        endGame(io, room, matchId, state, role, 'capture');
      }
    },
  );

  // ── Rematch ─────────────────────────────────────────────────────────────
  socket.on('generals:rematchRequest', () => {
    if (state.status !== 'finished') return;
    me.rematchReady = true;

    io.to(room).emit('generals:rematchStatus', {
      player1: state.players.player1.rematchReady,
      player2: state.players.player2.rematchReady,
    });

    const bothReady = state.players.player1.rematchReady && state.players.player2.rematchReady;

    if (bothReady) {
      if (state.rematchTimer) {
        clearTimeout(state.rematchTimer);
        state.rematchTimer = null;
      }
      resetMatchState(state);
      startTickLoop(io, room, matchId, state);
      io.to(room).emit('generals:rematchStart', { state: serializePublicState(state) });
      return;
    }

    if (!state.rematchTimer) {
      state.rematchTimer = setTimeout(() => {
        state.rematchTimer = null;
        if (state.status !== 'finished') return;
        const stillWaiting = !(
          state.players.player1.rematchReady && state.players.player2.rematchReady
        );
        if (stillWaiting) {
          state.players.player1.rematchReady = false;
          state.players.player2.rematchReady = false;
          io.to(room).emit('generals:rematchTimeout');
        }
      }, REMATCH_TIMEOUT_MS);
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (me.socketId !== socket.id) return;

    me.connected = false;
    me.socketId = null;
    io.to(room).emit('generals:opponentDisconnected', { role });

    if (state.status === 'finished') {
      scheduleCleanup(matchId);
      return;
    }

    if (state.status === 'playing' && !state.disconnectTimers[role]) {
      state.disconnectTimers[role] = setTimeout(() => {
        state.disconnectTimers[role] = null;
        if (state.status === 'playing' && !me.connected) {
          endGame(io, room, matchId, state, opp, 'forfeit');
        }
      }, DISCONNECT_FORFEIT_MS);
    }
  });
}
