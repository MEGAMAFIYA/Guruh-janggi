import { CommandContext, Context, InlineKeyboard } from 'grammy';
import { listActiveGames } from '../../services/gameService';

/**
 * /guruh — Shows active games list with inline keyboard in group chats.
 */
export async function handleGuruh(ctx: CommandContext<Context>): Promise<void> {
  const chatType = ctx.chat?.type;

  if (chatType === 'private') {
    await ctx.reply(
      '⚠️ Bu buyruq faqat guruh chatlarida ishlaydi.\n\nBotni guruhingizga qo\'shing va u yerda /guruh deb yozing.',
    );
    return;
  }

  const games = await listActiveGames();

  if (games.length === 0) {
    await ctx.reply(
      '😔 Hozircha hech qanday o\'yin qo\'shilmagan.\n\nAdmin /yangi buyrug\'i orqali o\'yin qo\'sha oladi.',
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
