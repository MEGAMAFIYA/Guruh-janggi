/**
 * Unit tests for game service — schema validation and business rules.
 * No database required: these only test pure logic.
 */

// Block the config→process.exit(1) chain that fires when env vars are missing
jest.mock('../config', () => ({
  config: {
    bot: { token: 'test', webhookUrl: null, webhookSecret: 'secret' },
    db: { url: 'postgresql://localhost/test' },
    server: { port: 3000, nodeEnv: 'test', isProduction: false, sessionSecret: 'secret' },
    admin: { telegramIds: [] },
    webApp: { baseUrl: 'https://example.com' },
  },
}));

// Prisma is imported by gameService but not called by the functions under test
jest.mock('../database/prisma', () => ({
  prisma: {
    game: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));

import { createGameSchema, validateTeamPlayerCount } from '../services/gameService';
import type { Game } from '@prisma/client';

// ─── createGameSchema ─────────────────────────────────────────────────────────

describe('createGameSchema', () => {
  const base = {
    name: 'Katapulta',
    webAppUrl: 'https://katapulta.example.com',
    isTeamGame: false,
    minPlayers: 2,
    maxPlayers: 4,
  };

  // ── Valid inputs ────────────────────────────────────────────────────────────

  it('accepts a valid non-team game', () => {
    expect(createGameSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a valid team game with even player counts', () => {
    expect(createGameSchema.safeParse({ ...base, isTeamGame: true, minPlayers: 2, maxPlayers: 4 }).success).toBe(true);
  });

  it('accepts minPlayers equal to maxPlayers', () => {
    expect(createGameSchema.safeParse({ ...base, minPlayers: 2, maxPlayers: 2 }).success).toBe(true);
  });

  it('accepts http:// URLs', () => {
    expect(createGameSchema.safeParse({ ...base, webAppUrl: 'http://example.com/game' }).success).toBe(true);
  });

  // ── Player count ────────────────────────────────────────────────────────────

  it('rejects maxPlayers < minPlayers', () => {
    const r = createGameSchema.safeParse({ ...base, minPlayers: 4, maxPlayers: 2 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.maxPlayers).toBeDefined();
  });

  it('rejects minPlayers below 2', () => {
    expect(createGameSchema.safeParse({ ...base, minPlayers: 1 }).success).toBe(false);
  });

  it('rejects maxPlayers above 6', () => {
    expect(createGameSchema.safeParse({ ...base, maxPlayers: 7 }).success).toBe(false);
  });

  // ── Team game constraints ───────────────────────────────────────────────────

  it('rejects odd minPlayers for team games', () => {
    expect(createGameSchema.safeParse({ ...base, isTeamGame: true, minPlayers: 3, maxPlayers: 4 }).success).toBe(false);
  });

  it('rejects odd maxPlayers for team games', () => {
    expect(createGameSchema.safeParse({ ...base, isTeamGame: true, minPlayers: 2, maxPlayers: 3 }).success).toBe(false);
  });

  it('allows odd player counts for non-team games', () => {
    expect(createGameSchema.safeParse({ ...base, isTeamGame: false, minPlayers: 3, maxPlayers: 5 }).success).toBe(true);
  });

  it('allows team game with min=max=2', () => {
    expect(createGameSchema.safeParse({ ...base, isTeamGame: true, minPlayers: 2, maxPlayers: 2 }).success).toBe(true);
  });

  // ── URL validation ──────────────────────────────────────────────────────────

  it('rejects javascript: protocol', () => {
    expect(createGameSchema.safeParse({ ...base, webAppUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rejects ftp:// URLs', () => {
    expect(createGameSchema.safeParse({ ...base, webAppUrl: 'ftp://files.example.com' }).success).toBe(false);
  });

  it('rejects bare domain (no protocol)', () => {
    expect(createGameSchema.safeParse({ ...base, webAppUrl: 'example.com/game' }).success).toBe(false);
  });

  it('rejects data: URIs', () => {
    expect(createGameSchema.safeParse({ ...base, webAppUrl: 'data:text/html,<h1>xss</h1>' }).success).toBe(false);
  });

  // ── Name validation ─────────────────────────────────────────────────────────

  it('rejects empty name', () => {
    expect(createGameSchema.safeParse({ ...base, name: '' }).success).toBe(false);
  });

  it('rejects name longer than 100 chars', () => {
    expect(createGameSchema.safeParse({ ...base, name: 'a'.repeat(101) }).success).toBe(false);
  });

  it('accepts name of exactly 100 chars', () => {
    expect(createGameSchema.safeParse({ ...base, name: 'a'.repeat(100) }).success).toBe(true);
  });
});

// ─── validateTeamPlayerCount ─────────────────────────────────────────────────

describe('validateTeamPlayerCount', () => {
  function game(isTeamGame: boolean): Game {
    return {
      id: 'g1', name: 'Test', slug: 'test',
      webAppUrl: 'https://x.com', isTeamGame,
      minPlayers: 2, maxPlayers: 6,
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    };
  }

  it('always returns true for non-team games regardless of count', () => {
    expect(validateTeamPlayerCount(game(false), 1)).toBe(true);
    expect(validateTeamPlayerCount(game(false), 3)).toBe(true);
    expect(validateTeamPlayerCount(game(false), 5)).toBe(true);
  });

  it('returns true for even player count in team games', () => {
    expect(validateTeamPlayerCount(game(true), 2)).toBe(true);
    expect(validateTeamPlayerCount(game(true), 4)).toBe(true);
    expect(validateTeamPlayerCount(game(true), 6)).toBe(true);
  });

  it('returns false for odd player count in team games', () => {
    expect(validateTeamPlayerCount(game(true), 1)).toBe(false);
    expect(validateTeamPlayerCount(game(true), 3)).toBe(false);
    expect(validateTeamPlayerCount(game(true), 5)).toBe(false);
  });
});
