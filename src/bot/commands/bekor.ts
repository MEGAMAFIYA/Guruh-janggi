import { CommandContext, Context } from 'grammy';
import { getYangiSession, clearYangiSession } from './yangi';
import {
  cancelMatch,
  findActiveMatchForUserInChat,
  findActiveMatchInChat,
  MatchWithPlayers,
} from '../../services/matchService';
import { findUserByTelegramId } from '../../services/userService';
import { deleteMatchState as deleteKatapultaMatchState } from '../../game-servers/katapulta/state';
import { deleteMatchState as deleteGeneralsMatchState } from '../../game-servers/generals/state';
import { notifyMatchCancelled } from '../../services/realtimeService';
import { isGlobalAdmin, isGroupAdmin } from '../middleware/adminCheck';
import { escapeMarkdownV1 } from '../../utils/telegram';

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

  // ── 2) Cancel the active match in this chat ─────────────────────────────
  // Try "a match this user is playing in" first. If that finds nothing but
  // the caller is an admin, fall back to "any active match in the chat" —
  // otherwise an admin who isn't personally playing could never use /bekor
  // to clear a stuck/abandoned match (findActiveMatchForUserInChat would
  // always come back empty for them, and there was no admin-only fallback
  // lookup here before).
  let match = await findActiveMatchForUserInChat(BigInt(chatId), dbUser.id);
  const groupAdmin = await isGroupAdmin(ctx, chatId, userId);
  const globalAdmin = isGlobalAdmin(userId);

  if (!match && (groupAdmin || globalAdmin)) {
    match = await findActiveMatchInChat(BigInt(chatId));
  }

  if (!match) {
    await ctx.reply('ℹ️ Bekor qilinadigan faol o\'yin topilmadi.');
    return;
  }

  await cancelMatch(match.id);

  // Clean up any live in-memory game state / connected sockets for this match.
  // Harmless no-op for whichever game slug this match ISN'T (deleting a
  // matchId that was never in that game's state map does nothing).
  notifyMatchCancelled(match.id);
  deleteKatapultaMatchState(match.id);
  deleteGeneralsMatchState(match.id);

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
      `❌ *${escapeMarkdownV1(match.game.name)}* bekor qilindi.`,
      '',
      'Yangi o\'yin boshlash uchun /guruh buyrug\'ini yuboring.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

function buildCancelledPanel(match: MatchWithPlayers): string {
  return [`🎮 *${escapeMarkdownV1(match.game.name)}*`, '❌ Bekor qilindi'].join('\n');
}
