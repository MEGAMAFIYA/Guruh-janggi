import { Context } from 'grammy';
import { config } from '../../config';

/**
 * Returns true if the Telegram user is a global bot admin
 * (listed in ADMIN_TELEGRAM_IDS env var).
 */
export function isGlobalAdmin(telegramId: number): boolean {
  return config.admin.telegramIds.includes(telegramId);
}

/**
 * Returns true if the user is an administrator of the given group chat.
 * Falls back to false on API errors (e.g. bot not in group).
 */
export async function isGroupAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === 'administrator' || member.status === 'creator';
  } catch {
    return false;
  }
}

/**
 * Returns true if the user is allowed to use /yangi in the current context:
 * - global bot admin, OR
 * - group admin of the current chat
 */
export async function canManageGames(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  if (isGlobalAdmin(userId)) return true;

  const chatId = ctx.chat?.id;
  if (!chatId) return false;
  const chatType = ctx.chat?.type;
  if (chatType === 'private') return isGlobalAdmin(userId);

  return isGroupAdmin(ctx, chatId, userId);
}
