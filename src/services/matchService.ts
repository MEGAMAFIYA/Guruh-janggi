import { Match, MatchPlayer } from '@prisma/client';
import { prisma } from '../database/prisma';
import { assignTeams } from '../matchmaking/teamAssigner';

export type MatchWithPlayers = Match & {
  players: (MatchPlayer & {
    user: {
      id: string;
      telegramId: bigint;
      firstName: string;
      lastName: string | null;
      username: string | null;
    };
  })[];
  game: {
    id: string;
    name: string;
    webAppUrl: string;
    isTeamGame: boolean;
    minPlayers: number;
    maxPlayers: number;
    slug: string;
  };
};

const PLAYER_INCLUDE = {
  players: {
    include: {
      user: {
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' as const },
  },
  game: {
    select: {
      id: true,
      name: true,
      webAppUrl: true,
      isTeamGame: true,
      minPlayers: true,
      maxPlayers: true,
      slug: true,
    },
  },
};

export async function createMatch(
  gameId: string,
  chatId: bigint,
  minPlayers: number,
  maxPlayers: number,
): Promise<Match> {
  return prisma.match.create({
    data: { gameId, chatId, status: 'WAITING', requiredPlayers: minPlayers, maxPlayers },
  });
}

export async function getMatchWithPlayers(matchId: string): Promise<MatchWithPlayers | null> {
  return prisma.match.findUnique({
    where: { id: matchId },
    include: PLAYER_INCLUDE,
  }) as Promise<MatchWithPlayers | null>;
}

export async function joinMatch(matchId: string, userId: string): Promise<MatchPlayer> {
  return prisma.matchPlayer.create({
    data: { matchId, userId },
  });
}

export async function isUserInMatch(matchId: string, userId: string): Promise<boolean> {
  const player = await prisma.matchPlayer.findUnique({
    where: { matchId_userId: { matchId, userId } },
  });
  return !!player;
}

export async function startMatch(matchId: string): Promise<MatchWithPlayers> {
  const match = await getMatchWithPlayers(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'WAITING') throw new Error('Match is not in WAITING state');

  const playerCount = match.players.length;

  // Server-side guard: enforce minimum player count
  if (playerCount < match.requiredPlayers) {
    throw new Error(
      `Need at least ${match.requiredPlayers} players to start, have ${playerCount}`,
    );
  }

  // Team assignment if applicable
  if (match.game.isTeamGame) {
    if (playerCount % 2 !== 0) {
      throw new Error('Team game requires an even number of players');
    }
    await assignTeams(matchId, match.players.map((p) => p.userId));
  }

  await prisma.match.update({
    where: { id: matchId },
    data: { status: 'STARTED', startedAt: new Date() },
  });

  return getMatchWithPlayers(matchId) as Promise<MatchWithPlayers>;
}

export async function finishMatch(matchId: string): Promise<Match> {
  return prisma.match.update({
    where: { id: matchId },
    data: { status: 'FINISHED', finishedAt: new Date() },
  });
}

export async function cancelMatch(matchId: string): Promise<Match> {
  return prisma.match.update({
    where: { id: matchId },
    data: { status: 'CANCELLED' },
  });
}

export async function findWaitingMatchInChat(
  chatId: bigint,
  gameId: string,
): Promise<MatchWithPlayers | null> {
  return prisma.match.findFirst({
    where: { chatId, gameId, status: 'WAITING' },
    include: PLAYER_INCLUDE,
  }) as Promise<MatchWithPlayers | null>;
}

/**
 * Finds a match this user is currently a participant of, in this chat/game,
 * that has already been started but not yet finished. Used to prevent
 * `game:select` from spawning a duplicate second match (and a duplicate
 * "start game" button) when a user double-taps the button right after the
 * first tap already filled and auto-started a match — without this check,
 * `findWaitingMatchInChat` finds nothing (the first match is no longer
 * WAITING) and a brand new, independent match gets created instead.
 */
export async function findActiveStartedMatchForUser(
  chatId: bigint,
  gameId: string,
  userId: string,
): Promise<MatchWithPlayers | null> {
  return prisma.match.findFirst({
    where: {
      chatId,
      gameId,
      status: 'STARTED',
      players: { some: { userId } },
    },
    include: PLAYER_INCLUDE,
    orderBy: { startedAt: 'desc' },
  }) as Promise<MatchWithPlayers | null>;
}

/**
 * Finds a match this user currently participates in, in this chat, that is
 * either still WAITING for players or already STARTED (i.e. cancellable).
 * Used by /bekor to cancel "the game in progress" without the user having
 * to specify a match ID.
 */
export async function findActiveMatchForUserInChat(
  chatId: bigint,
  userId: string,
): Promise<MatchWithPlayers | null> {
  return prisma.match.findFirst({
    where: {
      chatId,
      status: { in: ['WAITING', 'STARTED'] },
      players: { some: { userId } },
    },
    include: PLAYER_INCLUDE,
    orderBy: { createdAt: 'desc' },
  }) as Promise<MatchWithPlayers | null>;
}

export async function updateMatchMessageId(matchId: string, messageId: number): Promise<void> {
  await prisma.match.update({ where: { id: matchId }, data: { messageId } });
}
