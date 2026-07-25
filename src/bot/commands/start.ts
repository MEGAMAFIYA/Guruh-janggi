import { CommandContext, Context } from 'grammy';

/**
 * /start — Greets the user and confirms registration.
 * User sync (upsertUser) is already handled by userSyncMiddleware,
 * so here we just send a welcome message.
 */
export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const name = from.last_name
    ? `${from.first_name} ${from.last_name}`
    : from.first_name;

  await ctx.reply(
    [
      `👋 Salom, *${name}*!`,
      '',
      '🎮 *Telegram Game Platform*ga xush kelibsiz!',
      '',
      'Bu bot orqali siz guruh chatlarida turli multiplayer o\'yinlarni o\'ynashingiz mumkin.',
      '',
      '📌 *Qanday ishlatish:*',
      '1. Botni o\'z guruhingizga qo\'shing.',
      '2. Guruhda /guruh buyrug\'ini yuboring.',
      '3. O\'yin tanlang va do\'stlaringizni kutib turing!',
      '',
      '✅ Sizning akkauntingiz muvaffaqiyatli ro\'yxatdan o\'tdi.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}
