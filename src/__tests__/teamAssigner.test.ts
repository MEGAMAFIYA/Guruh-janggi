/**
 * Unit tests for team assignment logic.
 */

// jest.mock is hoisted by ts-jest before imports
jest.mock('../database/prisma', () => ({
  prisma: {
    matchPlayer: {
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../database/prisma');

import { assignTeams, getTeamLabel } from '../matchmaking/teamAssigner';

beforeEach(() => {
  jest.clearAllMocks();
  prisma.matchPlayer.update.mockResolvedValue({});
  prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

// ─── assignTeams ──────────────────────────────────────────────────────────────

describe('assignTeams', () => {
  it('assigns first half to team 1, second half to team 2 (2 players)', async () => {
    await assignTeams('match1', ['userA', 'userB']);

    expect(prisma.matchPlayer.update).toHaveBeenCalledTimes(2);
    const calls = prisma.matchPlayer.update.mock.calls;
    expect(calls[0][0]).toEqual({
      where: { matchId_userId: { matchId: 'match1', userId: 'userA' } },
      data: { team: 1 },
    });
    expect(calls[1][0]).toEqual({
      where: { matchId_userId: { matchId: 'match1', userId: 'userB' } },
      data: { team: 2 },
    });
  });

  it('splits 4 players: 2 per team in join order', async () => {
    await assignTeams('match1', ['u1', 'u2', 'u3', 'u4']);

    const teams = prisma.matchPlayer.update.mock.calls.map((c: any) => c[0].data.team);
    expect(teams).toEqual([1, 1, 2, 2]);
  });

  it('splits 6 players: 3 per team', async () => {
    await assignTeams('match1', ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);

    const teams = prisma.matchPlayer.update.mock.calls.map((c: any) => c[0].data.team);
    expect(teams).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('wraps all updates in a single $transaction', async () => {
    await assignTeams('match1', ['u1', 'u2']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ─── getTeamLabel ─────────────────────────────────────────────────────────────

describe('getTeamLabel', () => {
  it('returns blue label for team 1', () => {
    expect(getTeamLabel(1)).toBe('🔵 Jamoa 1');
  });

  it('returns red label for team 2', () => {
    expect(getTeamLabel(2)).toBe('🔴 Jamoa 2');
  });

  it('returns empty string for null (non-team game player)', () => {
    expect(getTeamLabel(null)).toBe('');
  });

  it('returns empty string for unknown team number', () => {
    expect(getTeamLabel(99 as any)).toBe('');
  });
});
