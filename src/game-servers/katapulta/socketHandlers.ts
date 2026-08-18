import { Server as SocketIOServer, Socket } from 'socket.io';
import { MatchWithPlayers, finishMatch } from '../../services/matchService';
import {
  AmmoType,
  COOLDOWN_MS,
  P1_RANGE,
  P2_RANGE,
  REMATCH_TIMEOUT_MS,
  clamp,
} from './constants';
import {
  KatapultaMatchState,
  PlayerRole,
  cancelCleanup,
  getOrCreateMatchState,
  opponentRole,
  resetMatchState,
  roleForUser,
  scheduleCleanup,
  serializePublicState,
} from './state';

const rematchTimers = new Map<string, NodeJS.Timeout>();

/**
 * Wires up all `katapulta:*` events for one authenticated socket connection.
 * Must only be called when `match.game.slug === 'katapulta'`.
 * The socket has already joined room `match:<matchId>` in server.ts.
 */
export function registerKatapultaHandlers(
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
    socket.emit('katapulta:error', 'Match hali 2 o\'yinchiga to\'lmagan');
    return;
  }

  const state = getOrCreateMatchState(matchId, dbPlayers);
  cancelCleanup(state);

  const role = roleForUser(state, userId);
  if (!role) {
    socket.emit('katapulta:error', 'Siz bu matchning ishtirokchisi emassiz');
    return;
  }

  const me = state.players[role];
  me.connected = true;
  me.socketId = socket.id;

  const opp = opponentRole(role);
  const oppState = state.players[opp];

  socket.emit('katapulta:youAre', {
    role,
    opponentName: oppState.firstName,
    state: serializePublicState(state),
  });

  if (oppState.connected) {
    io.to(room).emit('katapulta:opponentConnected', { role });
  }

  // Both connected at least once and match not yet finished -> go live.
  if (me.connected && oppState.connected && state.status === 'waiting') {
    state.status = 'playing';
    io.to(room).emit('katapulta:bothReady', { state: serializePublicState(state) });
  } else if (state.status === 'playing') {
    // Reconnect mid-game: bring this client up to date immediately.
    socket.emit('katapulta:stateSync', { state: serializePublicState(state) });
  }

  // ── Movement ────────────────────────────────────────────────────────────
  socket.on('katapulta:move', (payload: { dir: number }) => {
    if (state.status !== 'playing') return;
    const dir = payload?.dir;
    if (dir !== -1 && dir !== 0 && dir !== 1) return;
    // Position itself is simulated locally on both clients for smoothness;
    // we just relay the intent so the opponent's client can mirror it, and
    // keep a coarse authoritative copy for players who join mid-match.
    socket.to(room).emit('katapulta:opponentMove', { role, dir });
  });

  socket.on('katapulta:positionSync', (payload: { x: number }) => {
    if (state.status !== 'playing') return;
    const range = role === 'player1' ? P1_RANGE : P2_RANGE;
    me.x = clamp(Number(payload?.x) || me.x, range[0], range[1]);
  });

  // ── Shooting ────────────────────────────────────────────────────────────
  socket.on(
    'katapulta:shoot',
    (payload: { vx: number; vy: number; type: AmmoType }) => {
      if (state.status !== 'playing') return;
      const now = Date.now();
      if (now < me.cooldownUntil) return;

      const type = payload?.type;
      if (type !== 'stone' && type !== 'triple' && type !== 'explosive') return;

      const ammoLeft = me.ammo[type];
      if (ammoLeft !== Infinity) {
        if (ammoLeft <= 0) return;
        me.ammo[type] -= 1;
      }
      me.currentAmmoType = type;
      me.cooldownUntil = now + COOLDOWN_MS;

      io.to(room).emit('katapulta:shotFired', {
        role,
        vx: payload.vx,
        vy: payload.vy,
        type,
      });
    },
  );

  // ── Damage reporting ───────────────────────────────────────────────────
  // Only the client that OWNS a projectile reports a hit — the frontend is
  // responsible for only calling this when `pr.ownerId === self`. This is a
  // trust-the-client compromise (full server-side physics is out of scope
  // for this in-memory relay), but it avoids double-counted damage from
  // both clients independently simulating the same projectile.
  socket.on('katapulta:damage', (payload: { amount: number }) => {
    if (state.status !== 'playing') return;
    const amount = Math.max(1, Math.min(5, Math.floor(Number(payload?.amount) || 1)));
    const target = state.players[opp];
    target.health = Math.max(0, target.health - amount);

    io.to(room).emit('katapulta:healthUpdate', {
      player1: state.players.player1.health,
      player2: state.players.player2.health,
    });

    if (target.health <= 0 && state.status === 'playing') {
      state.status = 'finished';
      state.winner = role;
      io.to(room).emit('katapulta:gameOver', { winner: role });
      finishMatch(matchId).catch((err) => {
        console.error('[katapulta] finishMatch failed:', err);
      });
      scheduleCleanup(matchId);
    }
  });

  // ── Rematch ─────────────────────────────────────────────────────────────
  socket.on('katapulta:rematchRequest', () => {
    if (state.status !== 'finished') return;
    me.rematchReady = true;

    io.to(room).emit('katapulta:rematchStatus', {
      player1: state.players.player1.rematchReady,
      player2: state.players.player2.rematchReady,
    });

    const bothReady = state.players.player1.rematchReady && state.players.player2.rematchReady;
    const existingTimer = rematchTimers.get(matchId);

    if (bothReady) {
      if (existingTimer) {
        clearTimeout(existingTimer);
        rematchTimers.delete(matchId);
      }
      resetMatchState(state);
      io.to(room).emit('katapulta:rematchStart', { state: serializePublicState(state) });
      return;
    }

    if (!existingTimer) {
      const timer = setTimeout(() => {
        rematchTimers.delete(matchId);
        if (state.status !== 'finished') return;
        const stillWaiting = !(
          state.players.player1.rematchReady && state.players.player2.rematchReady
        );
        if (stillWaiting) {
          state.players.player1.rematchReady = false;
          state.players.player2.rematchReady = false;
          io.to(room).emit('katapulta:rematchTimeout');
        }
      }, REMATCH_TIMEOUT_MS);
      rematchTimers.set(matchId, timer);
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    me.connected = false;
    me.socketId = null;
    io.to(room).emit('katapulta:opponentDisconnected', { role });
    if (state.status === 'finished') {
      scheduleCleanup(matchId);
    }
  });
}
