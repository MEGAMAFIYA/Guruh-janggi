import { CommandContext, Context } from 'grammy';
import { getYangiSession, clearYangiSession } from './yangi';
import {
  cancelMatch,
  findActiveMatchForUserInChat,
  MatchWithPlayers,
} from '../../services/matchService';
import { findUserByTelegramId } from '../../services/userService';
import { deleteMatchState } from '../../game-servers/katapulta/state';
import { notifyMatchCancelled } from '../../services/realtimeService';
import { isGlobalAdmin, isGroupAdmin } from '../middleware/adminCheck';

/**
 * /bekor — cancels whatever is currently "in flight" for this user:
 *   1. An open /yangi (add-game) wizard, if one is active — same behavior
 *      as before, just now also reachable as a standalone command.
 *   2. Otherwise, the user's active match in this chat (WAITING — still
 *      collecting players — or already STARTED). Cancellable by any
 *      participant, the group admin, or a global bot admin.
 *
 * Works in groups even with Telegram Privacy Mode enabled, since it's a
 * command (starts with '/').
 */
export async function handleBekor(ctx: CommandContext<Context>): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return;

  // ── 1) Cancel an in-progress /yangi wizard first, if any ──────────────────
  const yangiSession = getYangiSession(chatId, userId);
  if (yangiSession) {
    clearYangiSession(chatId, userId);
    await ctx.reply('❌ O\'yin qo\'shish bekor qilindi.');
    return;
  }

  if (ctx.chat?.type === 'private') {
    await ctx.reply('⚠️ Bekor qilinadigan narsa topilmadi.');
    return;
  }

  const dbUser = await findUserByTelegramId(userId);
  if (!dbUser) {
    await ctx.reply('⚠️ Avval /start buyrug\'ini yuboring');
    return;
  }

  // ── 2) Cancel the user's active match in this chat ─────────────────────
  const match = await findActiveMatchForUserInChat(BigInt(chatId), dbUser.id);
  if (!match) {
    await ctx.reply('ℹ️ Bekor qilinadigan faol o\'yin topilmadi.');
    return;
  }

  const isParticipant = match.players.some((p) => p.userId === dbUser.id);
  const groupAdmin = await isGroupAdmin(ctx, chatId, userId);
  const globalAdmin = isGlobalAdmin(userId);

  if (!isParticipant && !groupAdmin && !globalAdmin) {
    await ctx.reply('⛔ Faqat o\'yinchilar yoki adminlar bekor qila oladi');
    return;
  }

  await cancelMatch(match.id);

  // Clean up any live in-memory game state / connected sockets for this match.
  notifyMatchCancelled(match.id);
  deleteMatchState(match.id);

  // Remove the buttons from the old join panel so nobody can tap a dead match.
  if (match.messageId) {
    try {
      await ctx.api.editMessageText(chatId, match.messageId, buildCancelledPanel(match), {
        parse_mode: 'Markdown',
      });
    } catch {
      /* original panel message may have been deleted */
    }
  }

  await ctx.reply(
    [
      `❌ *${match.game.name}* bekor qilindi.`,
      '',
      'Yangi o\'yin boshlash uchun /guruh buyrug\'ini yuboring.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

function buildCancelledPanel(match: MatchWithPlayers): string {
  return [`🎮 *${match.game.name}*`, '❌ Bekor qilindi'].join('\n');
}
