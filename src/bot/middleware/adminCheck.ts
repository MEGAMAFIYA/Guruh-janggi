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
 * Returns true if the user is an administrator or creator of the given group chat.
 *
 * Returns false (not throws) on API errors so that a temporary Telegram API
 * failure does not crash the command handler. Errors are logged for debugging.
 *
 * Requires the bot to be a member of the group. The bot does NOT need to be
 * an admin itself to call getChatMember.
 */
export async function isGroupAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === 'administrator' || member.status === 'creator';
  } catch (err) {
    console.warn(
      `[adminCheck] getChatMember failed for user=${userId} in chat=${chatId}:`,
      err,
    );
    return false;
  }
}

/**
 * Returns true if the user is allowed to use /yangi in the current context:
 *   - global bot admin (in any chat type), OR
 *   - Telegram admin/creator of the current group/supergroup chat
 *
 * Non-global-admins are NOT permitted in private chat (there is no group
 * context to verify their admin status against).
 */
export async function canManageGames(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  // Global admins may use /yangi anywhere (private DM or any group).
  if (isGlobalAdmin(userId)) return true;

  // Non-global-admin in a private chat: no group context to verify against.
  const chatType = ctx.chat?.type;
  if (!chatType || chatType === 'private') return false;

  // Group/supergroup: verify via Telegram API.
  const chatId = ctx.chat?.id;
  if (!chatId) return false;
  return isGroupAdmin(ctx, chatId, userId);
}
