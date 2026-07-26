/**
 * Unit tests for match service business rules.
 * Prisma is mocked — no real database connection required.
 */

jest.mock('../database/prisma', () => ({
  prisma: {
    match: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    matchPlayer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

jest.mock('../matchmaking/teamAssigner', () => ({
  assignTeams: jest.fn().mockResolvedValue(undefined),
  getTeamLabel: jest.fn().mockReturnValue(''),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../database/prisma');
import { assignTeams } from '../matchmaking/teamAssigner';

import {
  createMatch,
  isUserInMatch,
  startMatch,
  cancelMatch,
  finishMatch,
} from '../services/matchService';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'match1',
    gameId: 'game1',
    chatId: BigInt(-100123456789),
    messageId: null,
    status: 'WAITING',
    requiredPlayers: 2,
    maxPlayers: 4,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    players: [],
    game: {
      id: 'game1',
      name: 'Katapulta',
      webAppUrl: 'https://example.com',
      isTeamGame: false,
      minPlayers: 2,
      maxPlayers: 4,
      slug: 'katapulta',
    },
    ...overrides,
  };
}

function makePlayer(userId: string): Record<string, unknown> {
  return {
    id: `p_${userId}`,
    matchId: 'match1',
    userId,
    team: null,
    joinedAt: new Date(),
    user: { id: userId, telegramId: BigInt(123), firstName: 'Test', lastName: null, username: null },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  prisma.matchPlayer.update.mockResolvedValue({});
});

// ─── createMatch ─────────────────────────────────────────────────────────────

describe('createMatch', () => {
  it('creates a WAITING match with the correct fields', async () => {
    prisma.match.create.mockResolvedValue(makeMatch());
    await createMatch('game1', BigInt(-100123456789), 2, 4);

    expect(prisma.match.create).toHaveBeenCalledWith({
      data: {
        gameId: 'game1',
        chatId: BigInt(-100123456789),
        status: 'WAITING',
        requiredPlayers: 2,
        maxPlayers: 4,
      },
    });
  });
});

// ─── isUserInMatch ────────────────────────────────────────────────────────────

describe('isUserInMatch', () => {
  it('returns true when the matchPlayer record exists', async () => {
    prisma.matchPlayer.findUnique.mockResolvedValue({ id: 'p1' });
    expect(await isUserInMatch('match1', 'user1')).toBe(true);
  });

  it('returns false when the matchPlayer record does not exist', async () => {
    prisma.matchPlayer.findUnique.mockResolvedValue(null);
    expect(await isUserInMatch('match1', 'user1')).toBe(false);
  });
});

// ─── startMatch ───────────────────────────────────────────────────────────────

describe('startMatch', () => {
  it('throws "Match not found" when match does not exist', async () => {
    prisma.match.findUnique.mockResolvedValue(null);
    await expect(startMatch('nonexistent')).rejects.toThrow('Match not found');
  });

  it('throws when match is already STARTED', async () => {
    prisma.match.findUnique.mockResolvedValue(
      makeMatch({ status: 'STARTED', players: [makePlayer('u1'), makePlayer('u2')] }),
    );
    await expect(startMatch('match1')).rejects.toThrow('not in WAITING state');
  });

  it('throws when player count is below requiredPlayers', async () => {
    prisma.match.findUnique.mockResolvedValue(
      makeMatch({ players: [makePlayer('u1')] }), // only 1 player, need 2
    );
    await expect(startMatch('match1')).rejects.toThrow('at least 2 players');
  });

  it('starts a non-team match successfully', async () => {
    const withPlayers = makeMatch({ players: [makePlayer('u1'), makePlayer('u2')] });
    const started = makeMatch({ status: 'STARTED', players: [makePlayer('u1'), makePlayer('u2')] });

    prisma.match.findUnique
      .mockResolvedValueOnce(withPlayers)  // inside startMatch → getMatchWithPlayers
      .mockResolvedValueOnce(started);     // final getMatchWithPlayers call after update
    prisma.match.update.mockResolvedValue(started);

    const result = await startMatch('match1') as any;
    expect(result.status).toBe('STARTED');
    expect(assignTeams).not.toHaveBeenCalled();
  });

  it('updates match with status=STARTED and a startedAt timestamp', async () => {
    const withPlayers = makeMatch({ players: [makePlayer('u1'), makePlayer('u2')] });
    const started = makeMatch({ status: 'STARTED', players: [makePlayer('u1'), makePlayer('u2')] });

    prisma.match.findUnique.mockResolvedValueOnce(withPlayers).mockResolvedValueOnce(started);
    prisma.match.update.mockResolvedValue(started);

    await startMatch('match1');
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match1' },
      data: expect.objectContaining({ status: 'STARTED', startedAt: expect.any(Date) }),
    });
  });

  it('calls assignTeams for a team game with even players', async () => {
    const teamMatch = makeMatch({
      players: [makePlayer('u1'), makePlayer('u2')],
      game: { id: 'game1', name: 'Generals', webAppUrl: 'https://x.com', isTeamGame: true, minPlayers: 2, maxPlayers: 4, slug: 'generals' },
    });
    const started = { ...teamMatch, status: 'STARTED' };

    prisma.match.findUnique.mockResolvedValueOnce(teamMatch).mockResolvedValueOnce(started);
    prisma.match.update.mockResolvedValue(started);

    await startMatch('match1');
    expect(assignTeams).toHaveBeenCalledWith('match1', ['u1', 'u2']);
  });

  it('throws for a team match with odd player count', async () => {
    const teamMatch = makeMatch({
      players: [makePlayer('u1'), makePlayer('u2'), makePlayer('u3')], // 3 — must be even
      game: { id: 'game1', name: 'Generals', webAppUrl: 'https://x.com', isTeamGame: true, minPlayers: 2, maxPlayers: 4, slug: 'generals' },
    });
    prisma.match.findUnique.mockResolvedValueOnce(teamMatch);
    await expect(startMatch('match1')).rejects.toThrow('even number of players');
  });

  it('blocks joining after match is started (status guard)', async () => {
    // Simulate a match that was started between the status check and join attempt
    prisma.match.findUnique.mockResolvedValue(
      makeMatch({ status: 'STARTED', players: [makePlayer('u1'), makePlayer('u2')] }),
    );
    await expect(startMatch('match1')).rejects.toThrow('not in WAITING state');
  });
});

// ─── finishMatch ──────────────────────────────────────────────────────────────

describe('finishMatch', () => {
  it('sets status to FINISHED with finishedAt timestamp', async () => {
    prisma.match.update.mockResolvedValue({ status: 'FINISHED' });
    await finishMatch('match1');
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match1' },
      data: expect.objectContaining({ status: 'FINISHED', finishedAt: expect.any(Date) }),
    });
  });
});

// ─── cancelMatch ─────────────────────────────────────────────────────────────

describe('cancelMatch', () => {
  it('sets status to CANCELLED', async () => {
    prisma.match.update.mockResolvedValue({ status: 'CANCELLED' });
    await cancelMatch('match1');
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match1' },
      data: { status: 'CANCELLED' },
    });
  });
});
