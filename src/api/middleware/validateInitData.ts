import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../config';

export interface TelegramInitData {
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  auth_date: number;
  hash: string;
  query_id?: string;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
}

/**
 * Validates Telegram Web App initData signature.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function validateTelegramInitData(initDataRaw: string): TelegramInitData | null {
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build the data-check string
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256 with key = HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(config.bot.token)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    // Check auth_date freshness (allow up to 24h)
    const authDate = parseInt(params.get('auth_date') ?? '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return null;

    const result: TelegramInitData = {
      hash,
      auth_date: authDate,
    };

    const userRaw = params.get('user');
    if (userRaw) result.user = JSON.parse(userRaw);
    if (params.get('query_id')) result.query_id = params.get('query_id')!;

    return result;
  } catch {
    return null;
  }
}

/**
 * Express middleware: validates Telegram initData from Authorization header.
 * Sets req.telegramUser on success.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('tma ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const initDataRaw = authHeader.slice(4);
  const data = validateTelegramInitData(initDataRaw);

  if (!data || !data.user) {
    res.status(401).json({ error: 'Invalid Telegram initData' });
    return;
  }

  (req as any).telegramUser = data.user;
  next();
}
