import { Game } from '@prisma/client';
import { prisma } from '../database/prisma';
import { z } from 'zod';

export const createGameSchema = z
  .object({
    name: z.string().min(1, 'O\'yin nomi bo\'sh bo\'lishi mumkin emas').max(100),
    webAppUrl: z
      .string()
      .url('To\'g\'ri URL kiriting')
      .refine(
        (url) => {
          try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:';
          } catch {
            return false;
          }
        },
        { message: 'URL https:// yoki http:// bilan boshlanishi kerak' },
      ),
    isTeamGame: z.boolean(),
    minPlayers: z.number().int().min(2).max(6),
    maxPlayers: z.number().int().min(2).max(6),
  })
  .refine((data) => data.maxPlayers >= data.minPlayers, {
    message: 'Maksimum o\'yinchilar minimumdan kam bo\'lishi mumkin emas',
    path: ['maxPlayers'],
  })
  .refine(
    (data) => {
      if (!data.isTeamGame) return true;
      // Team games: both min and max must be even (2, 4, or 6)
      return data.minPlayers % 2 === 0 && data.maxPlayers % 2 === 0;
    },
    {
      message: 'Jamoaviy o\'yinlarda minimal va maksimal o\'yinchilar juft son bo\'lishi kerak',
      path: ['minPlayers'],
    },
  );

export type CreateGameInput = z.infer<typeof createGameSchema>;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 50)
    || 'game'; // fallback if slug would be empty (e.g., all special chars)
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let counter = 1;
  while (await prisma.game.findUnique({ where: { slug } })) {
    slug = `${base}-${counter++}`;
  }
  return slug;
}

export async function createGame(data: CreateGameInput): Promise<Game> {
  const slug = await uniqueSlug(generateSlug(data.name));
  return prisma.game.create({
    data: {
      name: data.name,
      webAppUrl: data.webAppUrl,
      isTeamGame: data.isTeamGame,
      minPlayers: data.minPlayers,
      maxPlayers: data.maxPlayers,
      slug,
    },
  });
}

export async function listActiveGames(): Promise<Game[]> {
  return prisma.game.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findGameById(id: string): Promise<Game | null> {
  return prisma.game.findUnique({ where: { id } });
}

export async function findGameBySlug(slug: string): Promise<Game | null> {
  return prisma.game.findUnique({ where: { slug } });
}

export async function deactivateGame(id: string): Promise<Game> {
  return prisma.game.update({ where: { id }, data: { isActive: false } });
}

/**
 * Validates that the player count is valid for the given game type.
 * For team games, the count must be even.
 */
export function validateTeamPlayerCount(game: Game, count: number): boolean {
  if (!game.isTeamGame) return true;
  return count % 2 === 0;
}
