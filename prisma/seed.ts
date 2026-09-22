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

  // NOTE: `update` intentionally does NOT set `isActive: true`. This script
  // reruns on every deploy (see render.yaml startCommand) — if it forced
  // isActive back to true every time, an admin's `/yangi`-deactivated (or
  // manually deactivated) built-in game would silently reappear on the next
  // deploy. Only `webAppUrl` is refreshed, so changing WEBAPP_BASE_URL still
  // takes effect for existing rows.
  const builtInGames = [
    {
      slug: 'katapulta',
      name: 'Katapulta',
      isTeamGame: false,
      minPlayers: 2,
      maxPlayers: 2,
    },
    {
      slug: 'generals',
      name: 'Generals',
      isTeamGame: false,
      minPlayers: 2,
      maxPlayers: 2,
    },
  ];

  for (const g of builtInGames) {
    const webAppUrl = `${baseUrl}/games/${g.slug}/index.html`;
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      update: { webAppUrl },
      create: {
        name: g.name,
        slug: g.slug,
        webAppUrl,
        isTeamGame: g.isTeamGame,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        isActive: true,
      },
    });
    console.log(`✅ Seeded game "${game.name}" (${game.slug}) -> ${game.webAppUrl}`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
