import { CommandContext, Context, InlineKeyboard } from 'grammy';
import { listActiveGames } from '../../services/gameService';

/**
 * /guruh — Shows active games list with inline keyboard in group chats.
 *
 * Works with Telegram Privacy Mode ENABLED (this command always reaches
 * the bot because it begins with '/').
 */
export async function handleGuruh(ctx: CommandContext<Context>): Promise<void> {
  const chatType = ctx.chat?.type;

  if (chatType === 'private') {
    await ctx.reply(
      '⚠️ Bu buyruq faqat guruh chatlarida ishlaydi.\n\n' +
        'Botni guruhingizga qo\'shing va u yerda /guruh deb yozing.',
    );
    return;
  }

  // chatType is 'group' or 'supergroup' — show game list
  let games;
  try {
    games = await listActiveGames();
  } catch (err) {
    console.error('[guruh] Failed to fetch active games:', err);
    await ctx.reply(
      '❌ O\'yinlar ro\'yxatini yuklashda xatolik yuz berdi.\n' +
        'Iltimos, keyinroq urinib ko\'ring.',
    );
    return;
  }

  if (games.length === 0) {
    await ctx.reply(
      '😔 Hozircha hech qanday o\'yin qo\'shilmagan.\n\n' +
        'Admin /yangi buyrug\'i orqali o\'yin qo\'sha oladi.',
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const game of games) {
    kb.text(`🎮 ${game.name}`, `game:select:${game.id}`).row();
  }

  await ctx.reply('🎮 *O\'ynash uchun o\'yin tanlang:*', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}
