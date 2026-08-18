/**
 * Prisma seed script.
 * Run: npm run db:seed
 *
 * Registers the built-in games that ship with this repo (currently just
 * "Katapulta"). Safe to re-run — uses upsert on the unique `slug`.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const baseUrl = (process.env.WEBAPP_BASE_URL || 'https://example.com').replace(/\/+$/, '');
  const katapultaUrl = `${baseUrl}/games/katapulta/index.html`;

  const game = await prisma.game.upsert({
    where: { slug: 'katapulta' },
    update: {
      webAppUrl: katapultaUrl,
      isActive: true,
    },
    create: {
      name: 'Katapulta',
      slug: 'katapulta',
      webAppUrl: katapultaUrl,
      isTeamGame: false,
      minPlayers: 2,
      maxPlayers: 2,
      isActive: true,
    },
  });

  console.log(`✅ Seeded game "${game.name}" (${game.slug}) -> ${game.webAppUrl}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
