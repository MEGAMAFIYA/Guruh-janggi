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
