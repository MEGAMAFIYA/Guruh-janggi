import { Server as SocketIOServer, Socket } from 'socket.io';
import { MatchWithPlayers, finishMatch } from '../../services/matchService';
import {
  AmmoType,
  COOLDOWN_MS,
  DISCONNECT_FORFEIT_MS,
  HITS_PER_SHOT,
  MAX_PENDING_HITS,
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

/**
 * Ends the match for anti-cheat / disconnect-forfeit / normal-KO reasons
 * alike, so all three paths stay in sync (status transition, DB write,
 * cleanup scheduling, client notification).
 */
function endGame(
  io: SocketIOServer,
  room: string,
  matchId: string,
  state: KatapultaMatchState,
  winner: PlayerRole,
  reason: 'ko' | 'forfeit',
): void {
  if (state.status !== 'playing') return;
  state.status = 'finished';
  state.winner = winner;
  io.to(room).emit('katapulta:gameOver', { winner, reason });
  finishMatch(matchId).catch((err) => {
    console.error('[katapulta] finishMatch failed:', err);
  });
  scheduleCleanup(matchId);
}

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

  // A (re)connect cancels any pending forfeit-by-disconnect for this
  // player — they came back in time.
  const pendingForfeit = state.disconnectTimers[role];
  if (pendingForfeit) {
    clearTimeout(pendingForfeit);
    state.disconnectTimers[role] = null;
  }

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
    io.to(room).emit('katapulta:opponentReconnected', { role });
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
  let moveLogCount = 0;
  socket.on('katapulta:move', (payload: { dir: number }) => {
    if (state.status !== 'playing') {
      // Logged (throttled) so we can tell "client sent it but we're not
      // in 'playing' yet" apart from "client never sent it at all".
      if (moveLogCount < 5) {
        moveLogCount += 1;
        console.log(
          `[katapulta] move IGNORED (status=${state.status}) matchId=${matchId} from=${role}`,
        );
      }
      return;
    }
    const dir = payload?.dir;
    if (dir !== -1 && dir !== 0 && dir !== 1) return;
    if (moveLogCount < 20) {
      moveLogCount += 1;
      console.log(`[katapulta] move matchId=${matchId} from=${role} dir=${dir} -> relaying to opponent`);
    }
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

      // Anti-cheat: grant this shot's hit credit so a later katapulta:damage
      // report from this same player is accepted. Capped so a long run of
      // unanswered shots can't bank unlimited future "damage" reports.
      me.pendingHits = Math.min(MAX_PENDING_HITS, me.pendingHits + HITS_PER_SHOT[type]);

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
  // responsible for only calling this when `pr.ownerId === self`. This is
  // still a trust-the-client compromise (full server-side physics is out of
  // scope for this in-memory relay), but a report is now only honored if it
  // corresponds to a shot this player actually fired (me.pendingHits),
  // rate-limited by the shot cooldown itself — a modified client can no
  // longer report unlimited damage with zero shots fired.
  socket.on('katapulta:damage', (payload: { amount: number }) => {
    if (state.status !== 'playing') return;
    if (me.pendingHits <= 0) {
      console.warn(
        `[katapulta] damage REJECTED (no pending hit credit) matchId=${matchId} from=${role}`,
      );
      return;
    }
    me.pendingHits -= 1;

    const amount = Math.max(1, Math.min(5, Math.floor(Number(payload?.amount) || 1)));
    const target = state.players[opp];
    target.health = Math.max(0, target.health - amount);

    console.log(
      `[katapulta] damage matchId=${matchId} from=${role} to=${opp} amount=${amount} ` +
        `-> player1.health=${state.players.player1.health} player2.health=${state.players.player2.health}`,
    );

    io.to(room).emit('katapulta:healthUpdate', {
      player1: state.players.player1.health,
      player2: state.players.player2.health,
    });

    if (target.health <= 0) {
      endGame(io, room, matchId, state, role, 'ko');
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

    if (bothReady) {
      if (state.rematchTimer) {
        clearTimeout(state.rematchTimer);
        state.rematchTimer = null;
      }
      resetMatchState(state);
      io.to(room).emit('katapulta:rematchStart', { state: serializePublicState(state) });
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
          io.to(room).emit('katapulta:rematchTimeout');
        }
      }, REMATCH_TIMEOUT_MS);
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Ignore a disconnect event from a stale/replaced socket (e.g. the
    // player opened a second tab — the old socket's 'disconnect' firing
    // shouldn't mark the player offline if a newer socket already took over).
    if (me.socketId !== socket.id) return;

    me.connected = false;
    me.socketId = null;
    io.to(room).emit('katapulta:opponentDisconnected', { role });

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
