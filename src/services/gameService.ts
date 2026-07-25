import { Game } from '@prisma/client';
import { prisma } from '../database/prisma';
import { z } from 'zod';

export const createGameSchema = z.object({
  name: z.string().min(1).max(100),
  webAppUrl: z.string().url(),
  isTeamGame: z.boolean(),
  minPlayers: z.number().int().min(2).max(6),
  maxPlayers: z.number().int().min(2).max(6),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 50);
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
    data: { ...data, slug },
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

export function validateTeamPlayerCount(game: Game, count: number): boolean {
  if (!game.isTeamGame) return true;
  return count % 2 === 0;
}
