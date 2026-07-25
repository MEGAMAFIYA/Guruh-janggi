import { z } from 'zod';

export function validateWebAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function sanitizeString(input: string): string {
  return input.trim().replace(/[<>"'&]/g, '');
}

export const telegramIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .describe('Telegram user ID');

export const matchIdSchema = z.string().cuid().describe('Match ID (CUID)');

export const gameIdSchema = z.string().cuid().describe('Game ID (CUID)');
