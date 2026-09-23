import { createWorld, RtsWorld } from './sim';
import { FINISHED_STATE_TTL_MS } from './constants';
import { PlayerRole } from './state-types';

export type { PlayerRole } from './state-types';

export interface RtsPlayerState {
  userId: string;
  telegramId: string;
  firstName: string;
  connected: boolean;
  socketId: string | null;
  present: boolean;
  rematchReady: boolean;
}

export interface RtsMatchState {
  matchId: string;
  status: 'waiting' | 'playing' | 'finished';
  winner: PlayerRole | null;
  winReason: 'destroyed' | 'timeout' | 'forfeit' | null;
  world: RtsWorld;
  players: Record<PlayerRole, RtsPlayerState>;
  tickTimer: NodeJS.Timeout | null;
  gcTimer: NodeJS.Timeout | null;
  rematchTimer: NodeJS.Timeout | null;
  disconnectTimers: Record<PlayerRole, NodeJS.Timeout | null>;
}

const matchStates = new Map<string, RtsMatchState>();

function freshPlayer(userId: string, telegramId: string, firstName: string): RtsPlayerState {
  return {
    userId,
    telegramId,
    firstName,
    connected: false,
    socketId: null,
    present: false,
    rematchReady: false,
  };
}

export function getOrCreateMatchState(
  matchId: string,
  dbPlayers: { userId: string; telegramId: string; firstName: string }[],
): RtsMatchState {
  let state = matchStates.get(matchId);
  if (state) return state;

  const [p1, p2] = dbPlayers;
  state = {
    matchId,
    status: 'waiting',
    winner: null,
    winReason: null,
    world: createWorld(Date.now()),
    players: {
      player1: freshPlayer(p1.userId, p1.telegramId, p1.firstName),
      player2: freshPlayer(p2.userId, p2.telegramId, p2.firstName),
    },
    tickTimer: null,
    gcTimer: null,
    rematchTimer: null,
    disconnectTimers: { player1: null, player2: null },
  };
  matchStates.set(matchId, state);
  return state;
}

export function getMatchState(matchId: string): RtsMatchState | undefined {
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

export function roleForUser(state: RtsMatchState, userId: string): PlayerRole | null {
  if (state.players.player1.userId === userId) return 'player1';
  if (state.players.player2.userId === userId) return 'player2';
  return null;
}

export function opponentRole(role: PlayerRole): PlayerRole {
  return role === 'player1' ? 'player2' : 'player1';
}

export function resetMatchState(state: RtsMatchState): void {
  state.world = createWorld(Date.now());
  state.status = 'playing';
  state.winner = null;
  state.winReason = null;
  for (const role of ['player1', 'player2'] as PlayerRole[]) {
    state.players[role].rematchReady = false;
  }
}

export function scheduleCleanup(matchId: string): void {
  const state = matchStates.get(matchId);
  if (!state) return;
  if (state.gcTimer) clearTimeout(state.gcTimer);
  state.gcTimer = setTimeout(() => {
    matchStates.delete(matchId);
  }, FINISHED_STATE_TTL_MS);
}

export function cancelCleanup(state: RtsMatchState): void {
  if (state.gcTimer) {
    clearTimeout(state.gcTimer);
    state.gcTimer = null;
  }
}

/** Public snapshot of the world — safe to send to clients (no fog of war). */
export function serializeWorld(world: RtsWorld) {
  return {
    resources: world.resources,
    units: Array.from(world.units.values()).map((u) => ({
      id: u.id,
      ownerId: u.ownerId,
      kind: u.kind,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      moving: u.moveTarget !== null,
      fighting: u.attackTargetId !== null,
    })),
    buildings: Array.from(world.buildings.values()).map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      kind: b.kind,
      x: b.x,
      y: b.y,
      hp: b.hp,
      maxHp: b.maxHp,
      constructing: b.constructionEndsAt !== null,
      constructionEndsAt: b.constructionEndsAt,
      queueLength: b.queue.length,
      queueReadyAt: b.queue.length > 0 ? b.queue[0].readyAt : null,
    })),
  };
}

export function serializePublicState(state: RtsMatchState) {
  return {
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    world: serializeWorld(state.world),
    player1: { connected: state.players.player1.connected, present: state.players.player1.present },
    player2: { connected: state.players.player2.connected, present: state.players.player2.present },
  };
}
