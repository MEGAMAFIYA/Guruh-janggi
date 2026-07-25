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

  // ── Middlewares ──────────────────────────────────────────────────────────────
  bot.use(userSyncMiddleware);

  // ── Commands ─────────────────────────────────────────────────────────────────
  bot.command('start', handleStart);
  bot.command('guruh', handleGuruh);
  bot.command('yangi', handleYangi);

  // ── Callback queries ─────────────────────────────────────────────────────────
  bot.on('callback_query:data', handleCallbackQuery);

  // ── Multi-step text messages (/yangi dialog) ─────────────────────────────────
  bot.on('message:text', async (ctx, next) => {
    const consumed = await handleYangiStep(ctx);
    if (!consumed) await next();
  });

  // ── Error handler ────────────────────────────────────────────────────────────
  bot.catch((err) => {
    const { ctx, error } = err;
    console.error(`[Bot] Error for update ${ctx.update.update_id}:`, error);
  });

  return bot;
}
