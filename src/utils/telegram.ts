/**
 * Utility helpers for Telegram-specific formatting and logic.
 */

/**
 * Escapes special characters for Telegram MarkdownV2 parse mode.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (ch) => `\\${ch}`);
}

/**
 * Escapes special characters for legacy Telegram Markdown ("Markdown" /
 * parse_mode: 'Markdown', NOT MarkdownV2) parse mode — the mode this bot
 * actually uses everywhere.
 *
 * Legacy Markdown only treats `_ * \` [` as special. Escaping the larger
 * MarkdownV2 character set (as escapeMarkdownV2 does) against legacy
 * Markdown is WRONG here: characters like `.` or `-` aren't special in V1,
 * so a backslash inserted before them shows up as a literal backslash to
 * the user instead of being consumed as an escape.
 *
 * Without this, any user-controlled text interpolated into a Markdown
 * message (a Telegram first/last name, username, or an admin-entered game
 * name) that happens to contain `_`, `*`, `` ` `` or `[` breaks Telegram's
 * entity parser and the whole `sendMessage`/`editMessageText` call fails
 * with a 400 error — e.g. a player named "Ali_dev" would break every join
 * panel and notification that mentions them.
 */
export function escapeMarkdownV1(text: string): string {
  return text.replace(/[_*`[]/g, (ch) => `\\${ch}`);
}

/**
 * Formats a player name from first + last name.
 */
export function formatName(firstName: string, lastName?: string | null): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

/**
 * Formats a Telegram mention.
 */
export function mention(firstName: string, telegramId: number): string {
  return `[${firstName}](tg://user?id=${telegramId})`;
}

/**
 * Returns true if the chat type is a group or supergroup.
 */
export function isGroupChat(chatType: string): boolean {
  return chatType === 'group' || chatType === 'supergroup';
}
