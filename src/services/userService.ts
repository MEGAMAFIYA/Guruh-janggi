import { User } from '@prisma/client';
import { prisma } from '../database/prisma';

export interface TelegramUserData {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

export async function upsertUser(data: TelegramUserData): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId: BigInt(data.id) },
    update: {
      username: data.username ?? null,
      firstName: data.first_name,
      lastName: data.last_name ?? null,
    },
    create: {
      telegramId: BigInt(data.id),
      username: data.username ?? null,
      firstName: data.first_name,
      lastName: data.last_name ?? null,
    },
  });
}

export async function findUserByTelegramId(
  telegramId: number,
): Promise<User | null> {
  return prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
}

export function formatUserName(user: User): string {
  const name = user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.firstName;
  return user.username ? `${name} (@${user.username})` : name;
}
