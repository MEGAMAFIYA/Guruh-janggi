import { Bot } from 'grammy';
import { config } from '../config';
import { userSyncMiddleware } from './middleware/userSync';
import { handleStart } from './commands/start';
import { handleGuruh } from './commands/guruh';
import { handleYangi, handleYangiStep } from './commands/yangi';
import { handleCallbackQuery } from './handlers/callbackQuery';
import { setBotInstance } from '../services/notificationService';

export function createBot(): Bot {
  const bot = new Bot(config.bot.token);

  // Make bot available to notification service
  setBotInstance(bot);

  // ── Structured logging middleware ─────────────────────────────────────────
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type ?? 'unknown';
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const display = ctx.from?.username
      ? `@${ctx.from.username}`
      : (ctx.from?.first_name ?? 'unknown');

    if (ctx.message?.text) {
      const preview = ctx.message.text.slice(0, 120);
      console.log(
        `[Bot] update=${ctx.update.update_id} type=${chatType} chat=${chatId} ` +
          `user=${userId}(${display}) text="${preview}"`,
      );
    } else if (ctx.callbackQuery?.data) {
      const preview = ctx.callbackQuery.data.slice(0, 80);
      console.log(
        `[Bot] update=${ctx.update.update_id} callback user=${userId}(${display}) data="${preview}"`,
      );
    }

    await next();
  });

  // ── Middlewares ────────────────────────────────────────────────────────────
  bot.use(userSyncMiddleware);

  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command('start', handleStart);
  bot.command('guruh', handleGuruh);
  bot.command('yangi', handleYangi);

  // ── Callback queries ──────────────────────────────────────────────────────
  bot.on('callback_query:data', handleCallbackQuery);

  // ── Multi-step text messages (/yangi dialog) ──────────────────────────────
  // NOTE: In Telegram groups with Privacy Mode ENABLED, the bot only receives
  // messages that begin with '/' (commands) or are direct replies to the bot.
  // Plain text messages (e.g. game name / URL in /yangi steps 1-2) are blocked.
  // Privacy Mode must be DISABLED in BotFather for the /yangi wizard to work
  // inside groups. Private chat messages are always received regardless of
  // privacy mode. See README for BotFather setup instructions.
  bot.on('message:text', async (ctx, next) => {
    const consumed = await handleYangiStep(ctx);
    if (!consumed) await next();
  });

  // ── Global error handler ──────────────────────────────────────────────────
  // Catches any unhandled error from middleware or command handlers.
  // Always sends a user-facing reply so the user is never left with no feedback.
  bot.catch(async (err) => {
    const { ctx, error } = err;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    console.error(
      `[Bot] Unhandled error update=${ctx.update.update_id} ` +
        `user=${userId} chat=${chatId}:`,
      error,
    );
    try {
      await ctx.reply('❌ Ichki xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
    } catch (replyErr) {
      console.error('[Bot] Failed to send error reply to user:', replyErr);
    }
  });

  return bot;
}
