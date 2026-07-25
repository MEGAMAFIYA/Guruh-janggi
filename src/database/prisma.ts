import { PrismaClient } from '@prisma/client';
import { config } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse client across hot-reloads in development
export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: config.server.isProduction ? ['error'] : ['warn', 'error'],
  });

if (!config.server.isProduction) {
  global.__prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  console.log('✅ Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 Database disconnected');
}
