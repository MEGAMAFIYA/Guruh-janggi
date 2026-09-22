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

    // IMPORTANT: allowed_updates is explicit here on purpose. Per Telegram's
    // Bot API, when this parameter is omitted, Telegram keeps using whatever
    // was set on a PREVIOUS setWebhook call for this bot token — it does
    // NOT reset to "all types". If this bot's webhook was ever registered
    // before (by an earlier version of this code, a different tool, or
    // manually) with a restricted list that excluded 'callback_query',
    // every inline-button tap would be silently dropped by Telegram itself
    // — it would never even reach this server, so nothing would show up in
    // our logs either. Listing every update type we actually handle removes
    // that ambiguity for good.
    await bot.api.setWebhook(fullWebhookUrl, {
      secret_token: config.bot.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });

    const info = await bot.api.getWebhookInfo();
    console.log(
      `✅ Webhook registered: ${fullWebhookUrl} ` +
        `(pending_update_count=${info.pending_update_count}, ` +
        `allowed_updates=${JSON.stringify(info.allowed_updates ?? 'all')})`,
    );
    if (info.last_error_message) {
      console.warn(
        `⚠️ Telegram reported a webhook delivery error at ` +
          `${info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : '?'}: ` +
          info.last_error_message,
      );
    }
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

    if (!(config.bot.webhookUrl && config.server.isProduction)) {
      // Long-polling mode: stop cleanly so Telegram doesn't see a dangling
      // getUpdates connection.
      await bot.stop();
    }
    // NOTE: in webhook mode we deliberately do NOT call bot.api.deleteWebhook()
    // here. On Render, SIGTERM fires on every deploy/restart — deleting the
    // webhook on shutdown races with the NEW instance registering it moments
    // later during startup, and can leave the bot with no webhook at all if
    // the old instance's deleteWebhook call lands after the new instance's
    // setWebhook call. The webhook registration is idempotent and re-runs on
    // every startup anyway, so there's nothing to clean up here.

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
