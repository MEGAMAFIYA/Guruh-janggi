import {
  AmmoType,
  DEFAULT_AMMO,
  FINISHED_STATE_TTL_MS,
  HEART_MAX,
  P1_START_X,
  P2_START_X,
} from './constants';

export type PlayerRole = 'player1' | 'player2';

export interface KatapultaPlayerState {
  userId: string; // internal DB User.id
  telegramId: string;
  firstName: string;
  x: number;
  health: number;
  ammo: Record<AmmoType, number>;
  currentAmmoType: AmmoType;
  cooldownUntil: number;
  connected: boolean;
  socketId: string | null;
  rematchReady: boolean;
  /**
   * True once this player has explicitly tapped the "Men shu yerdaman"
   * button in the mini app — distinct from `connected` (raw socket link).
   * A player can be `connected` (socket open, page loaded) without being
   * `present` yet; the match only goes live once BOTH players are `present`.
   */
  present: boolean;
}

export interface KatapultaMatchState {
  matchId: string;
  status: 'waiting' | 'playing' | 'finished';
  winner: PlayerRole | null;
  players: Record<PlayerRole, KatapultaPlayerState>;
  gcTimer: NodeJS.Timeout | null;
}

const matchStates = new Map<string, KatapultaMatchState>();

function freshPlayer(
  userId: string,
  telegramId: string,
  firstName: string,
  startX: number,
): KatapultaPlayerState {
  return {
    userId,
    telegramId,
    firstName,
    x: startX,
    health: HEART_MAX,
    ammo: { ...DEFAULT_AMMO },
    currentAmmoType: 'stone',
    cooldownUntil: 0,
    connected: false,
    socketId: null,
    rematchReady: false,
    present: false,
  };
}

/**
 * Returns the existing state for a match, or creates it.
 * `dbPlayers` must be ordered by joinedAt ASC (matchService already does
 * this) so that role assignment (player1 = first to join the group panel)
 * is stable across reconnects/tab reloads.
 */
export function getOrCreateMatchState(
  matchId: string,
  dbPlayers: { userId: string; telegramId: string; firstName: string }[],
): KatapultaMatchState {
  let state = matchStates.get(matchId);
  if (state) return state;

  const [p1, p2] = dbPlayers;
  state = {
    matchId,
    status: 'waiting',
    winner: null,
    players: {
      player1: freshPlayer(p1.userId, p1.telegramId, p1.firstName, P1_START_X),
      player2: freshPlayer(p2.userId, p2.telegramId, p2.firstName, P2_START_X),
    },
    gcTimer: null,
  };
  matchStates.set(matchId, state);
  return state;
}

export function getMatchState(matchId: string): KatapultaMatchState | undefined {
  return matchStates.get(matchId);
}

/** Immediately drops the in-memory state for a match (used when a match is cancelled). */
export function deleteMatchState(matchId: string): void {
  const state = matchStates.get(matchId);
  if (state?.gcTimer) clearTimeout(state.gcTimer);
  matchStates.delete(matchId);
}

export function roleForUser(state: KatapultaMatchState, userId: string): PlayerRole | null {
  if (state.players.player1.userId === userId) return 'player1';
  if (state.players.player2.userId === userId) return 'player2';
  return null;
}

export function opponentRole(role: PlayerRole): PlayerRole {
  return role === 'player1' ? 'player2' : 'player1';
}

export function resetMatchState(state: KatapultaMatchState): void {
  for (const role of ['player1', 'player2'] as PlayerRole[]) {
    const p = state.players[role];
    p.health = HEART_MAX;
    p.x = role === 'player1' ? P1_START_X : P2_START_X;
    p.ammo = { ...DEFAULT_AMMO };
    p.currentAmmoType = 'stone';
    p.cooldownUntil = 0;
    p.rematchReady = false;
  }
  state.status = 'playing';
  state.winner = null;
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

export function cancelCleanup(state: KatapultaMatchState): void {
  if (state.gcTimer) {
    clearTimeout(state.gcTimer);
    state.gcTimer = null;
  }
}

export function serializePublicState(state: KatapultaMatchState) {
  const pub = (p: KatapultaPlayerState) => ({
    x: p.x,
    health: p.health,
    connected: p.connected,
    present: p.present,
  });
  return {
    status: state.status,
    winner: state.winner,
    player1: pub(state.players.player1),
    player2: pub(state.players.player2),
  };
}
