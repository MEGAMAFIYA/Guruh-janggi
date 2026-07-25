import { connectDatabase, disconnectDatabase } from './database/prisma';
import { createBot } from './bot/bot';
import { createServer } from './api/server';
import { config } from './config';

async function main(): Promise<void> {
  console.log('🚀 Starting Telegram Game Platform...');

  // 1. Connect to database
  await connectDatabase();

  // 2. Create the bot instance first so it can be passed to the HTTP server
  //    for webhook mounting in production.
  const bot = createBot();

  // 3. Create Express server + Socket.IO.
  //    In production (webhook mode) the bot is passed so the webhook route
  //    POST /webhook/<secret> is mounted on the same server.
  const { httpServer } = createServer(bot);

  // 4. Start HTTP server
  await new Promise<void>((resolve) => {
    httpServer.listen(config.server.port, () => {
      console.log(`✅ HTTP server listening on port ${config.server.port}`);
      resolve();
    });
  });

  // 5. Start bot — webhook in production, long-polling in development
  if (config.bot.webhookUrl && config.server.isProduction) {
    // Production: register webhook with Telegram, then let Express handle
    // incoming updates via the mounted /webhook/<secret> route.
    // Do NOT call bot.start() here — that would start polling and conflict
    // with webhook delivery.
    const webhookPath = `/webhook/${config.bot.webhookSecret}`;
    const fullWebhookUrl = `${config.bot.webhookUrl}${webhookPath}`;

    await bot.api.setWebhook(fullWebhookUrl, {
      secret_token: config.bot.webhookSecret,
    });
    console.log(`✅ Webhook registered: ${fullWebhookUrl}`);
    console.log('✅ Bot ready — updates received via webhook');
  } else {
    // Development: long-polling (no webhook needed, blocks until stopped)
    await bot.start({
      onStart: (info) => {
        console.log(`✅ Bot @${info.username} running in long-polling mode`);
      },
    });
  }

  // 6. Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    if (config.bot.webhookUrl && config.server.isProduction) {
      await bot.api.deleteWebhook().catch(() => {});
    } else {
      await bot.stop();
    }

    await disconnectDatabase();
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
