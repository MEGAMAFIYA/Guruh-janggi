import { prisma } from '../database/prisma';

/**
 * Assigns players to two equal teams for a team-based match.
 * Players are assigned in join order: first half → team 1, second half → team 2.
 */
export async function assignTeams(matchId: string, playerIds: string[]): Promise<void> {
  const half = playerIds.length / 2;

  const updates = playerIds.map((userId, index) =>
    prisma.matchPlayer.update({
      where: { matchId_userId: { matchId, userId } },
      data: { team: index < half ? 1 : 2 },
    }),
  );

  await prisma.$transaction(updates);
}

export function getTeamLabel(team: number | null): string {
  if (team === 1) return '🔵 Jamoa 1';
  if (team === 2) return '🔴 Jamoa 2';
  return '';
}
