import { Server as SocketIOServer, Socket } from 'socket.io';
import { MatchWithPlayers, finishMatch } from '../../services/matchService';
import {
  BuildingKind,
  DISCONNECT_FORFEIT_MS,
  REMATCH_TIMEOUT_MS,
  SIM_TICK_MS,
  UnitKind,
} from './constants';
import { issueMoveOrder, placeBuilding, queueUnit, tick } from './sim';
import {
  RtsMatchState,
  PlayerRole,
  cancelCleanup,
  getOrCreateMatchState,
  opponentRole,
  resetMatchState,
  roleForUser,
  scheduleCleanup,
  serializeWorld,
  serializePublicState,
} from './state';

// A client can't reasonably issue more than this many orders per second by
// legitimate tapping — beyond that it's either a bug or a flood, not
// gameplay, so extra orders are just dropped rather than queued.
const MIN_ORDER_INTERVAL_MS = 60;

function endGame(
  io: SocketIOServer,
  room: string,
  matchId: string,
  state: RtsMatchState,
  winner: PlayerRole,
  reason: 'destroyed' | 'timeout' | 'forfeit',
): void {
  if (state.status !== 'playing') return;
  state.status = 'finished';
  state.winner = winner;
  state.winReason = reason;
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  io.to(room).emit('rts:gameOver', { winner, reason });
  finishMatch(matchId).catch((err: unknown) => {
    console.error('[generals] finishMatch failed:', err);
  });
  scheduleCleanup(matchId);
}

function startSimLoop(io: SocketIOServer, room: string, matchId: string, state: RtsMatchState): void {
  if (state.tickTimer) return;
  let lastTickAt = Date.now();

  state.tickTimer = setInterval(() => {
    if (state.status !== 'playing') return;
    const now = Date.now();
    const dtMs = now - lastTickAt;
    lastTickAt = now;

    const result = tick(state.world, now, dtMs);
    io.to(room).emit('rts:worldUpdate', { world: serializeWorld(state.world) });

    if (result.ended) {
      endGame(io, room, matchId, state, result.winner, result.reason);
    }
  }, SIM_TICK_MS);
}

/**
 * Wires up all `rts:*` events for one authenticated socket connection.
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
    socket.emit('rts:error', 'Match hali 2 o\'yinchiga to\'lmagan');
    return;
  }

  const state = getOrCreateMatchState(matchId, dbPlayers);
  cancelCleanup(state);

  const role = roleForUser(state, userId);
  if (!role) {
    socket.emit('rts:error', 'Siz bu matchning ishtirokchisi emassiz');
    return;
  }

  const me = state.players[role];
  me.connected = true;
  me.socketId = socket.id;
  let lastOrderAt = 0;

  const pendingForfeit = state.disconnectTimers[role];
  if (pendingForfeit) {
    clearTimeout(pendingForfeit);
    state.disconnectTimers[role] = null;
  }

  const opp = opponentRole(role);
  const oppState = state.players[opp];

  socket.emit('rts:youAre', {
    role,
    opponentName: oppState.firstName,
    opponentPresent: oppState.present,
    state: serializePublicState(state),
  });

  if (state.status === 'playing') {
    socket.emit('rts:stateSync', { state: serializePublicState(state) });
    io.to(room).emit('rts:opponentReconnected', { role });
  }

  socket.on('rts:imHere', () => {
    if (me.present) return;
    me.present = true;
    socket.to(room).emit('rts:opponentHere', { role });

    if (state.status === 'waiting' && me.present && oppState.present) {
      state.status = 'playing';
      startSimLoop(io, room, matchId, state);
      io.to(room).emit('rts:bothReady', { state: serializePublicState(state) });
    }
  });

  function throttled(): boolean {
    const now = Date.now();
    if (now - lastOrderAt < MIN_ORDER_INTERVAL_MS) return true;
    lastOrderAt = now;
    return false;
  }

  // ── Build a building ────────────────────────────────────────────────────
  socket.on('rts:build', (payload: { kind: BuildingKind; x: number; y: number }) => {
    if (state.status !== 'playing' || throttled()) return;
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    const kind = payload?.kind;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (kind !== 'barracks') return; // only buildable kind in v1

    const result = placeBuilding(state.world, role, kind, x, y, Date.now());
    if (!result.ok) {
      socket.emit('rts:actionError', { action: 'build', reason: result.reason });
      return;
    }
    io.to(room).emit('rts:worldUpdate', { world: serializeWorld(state.world) });
  });

  // ── Train a unit ────────────────────────────────────────────────────────
  socket.on('rts:trainUnit', (payload: { buildingId: string; kind: UnitKind }) => {
    if (state.status !== 'playing' || throttled()) return;
    const buildingId = String(payload?.buildingId ?? '');
    const kind = payload?.kind;
    if (!buildingId || kind !== 'soldier') return;

    const result = queueUnit(state.world, role, buildingId, kind, Date.now());
    if (!result.ok) {
      socket.emit('rts:actionError', { action: 'train', reason: result.reason });
      return;
    }
    io.to(room).emit('rts:worldUpdate', { world: serializeWorld(state.world) });
  });

  // ── Move / attack-move a group of units ────────────────────────────────
  socket.on('rts:move', (payload: { unitIds: string[]; x: number; y: number }) => {
    if (state.status !== 'playing' || throttled()) return;
    const unitIds = Array.isArray(payload?.unitIds)
      ? payload.unitIds.filter((id) => typeof id === 'string')
      : [];
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (unitIds.length === 0 || unitIds.length > 200 || !Number.isFinite(x) || !Number.isFinite(y)) return;

    issueMoveOrder(state.world, role, unitIds, x, y);
    io.to(room).emit('rts:worldUpdate', { world: serializeWorld(state.world) });
  });

  // ── Rematch ─────────────────────────────────────────────────────────────
  socket.on('rts:rematchRequest', () => {
    if (state.status !== 'finished') return;
    me.rematchReady = true;

    io.to(room).emit('rts:rematchStatus', {
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
      startSimLoop(io, room, matchId, state);
      io.to(room).emit('rts:rematchStart', { state: serializePublicState(state) });
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
          io.to(room).emit('rts:rematchTimeout');
        }
      }, REMATCH_TIMEOUT_MS);
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (me.socketId !== socket.id) return;

    me.connected = false;
    me.socketId = null;
    io.to(room).emit('rts:opponentDisconnected', { role });

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
