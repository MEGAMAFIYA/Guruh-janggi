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

  // Tell this client who they are and whether the opponent has already
  // confirmed presence (so a late joiner can immediately be prompted with
  // "opponent is already here, tap the button").
  socket.emit('katapulta:youAre', {
    role,
    opponentName: oppState.firstName,
    opponentPresent: oppState.present,
    state: serializePublicState(state),
  });

  // Reconnect mid-game: bring this client straight back into the live match.
  if (state.status === 'playing') {
    socket.emit('katapulta:stateSync', { state: serializePublicState(state) });
  }

  // ── Explicit "Men shu yerdaman" confirmation ──────────────────────────
  // A raw socket connection is NOT enough to start the match — the player
  // must tap the in-app button first. This lets a player open the mini app,
  // warm up alone (move their own catapult) without revealing themselves to
  // an opponent who hasn't shown up yet, and only go live once BOTH players
  // have explicitly confirmed they're there.
  socket.on('katapulta:imHere', () => {
    if (me.present) return; // idempotent — ignore duplicate taps
    me.present = true;

    // Let the other side know a player just confirmed presence. If the
    // opponent is already connected but hasn't tapped their own button yet,
    // this nudges their UI ("raqib keldi, siz ham bosing"). If the opponent
    // isn't connected at all yet, this is a harmless no-op (empty room).
    socket.to(room).emit('katapulta:opponentHere', { role });

    if (state.status === 'waiting' && me.present && oppState.present) {
      state.status = 'playing';
      io.to(room).emit('katapulta:bothReady', { state: serializePublicState(state) });
    }
  });

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
