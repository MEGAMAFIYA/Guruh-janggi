/**
 * Unit tests for Telegram Web App initData validation.
 * Security-critical: these guard against unauthorized match/user access.
 */

import crypto from 'crypto';

// Must be called before the module is imported
jest.mock('../config', () => ({
  config: { bot: { token: 'test_bot_token_12345' } },
}));

import { validateTelegramInitData } from '../api/middleware/validateInitData';

const BOT_TOKEN = 'test_bot_token_12345';

/** Generates a correctly-signed initData string for testing. */
function buildInitData(opts: {
  userId?: number;
  authDate?: number;
  overrideHash?: string;
  signingToken?: string;
  withUser?: boolean;
} = {}): string {
  const {
    userId = 111222333,
    authDate = Math.floor(Date.now() / 1000) - 10,
    signingToken = BOT_TOKEN,
    withUser = true,
  } = opts;

  const params = new URLSearchParams();
  if (withUser) {
    params.set('user', JSON.stringify({
      id: userId,
      first_name: 'Ali',
      last_name: 'Valiyev',
      username: 'alivaliyev',
    }));
  }
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAHdF6IQAAAAbF6IQOrctest');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(signingToken).digest();
  const realHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', opts.overrideHash ?? realHash);
  return params.toString();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validateTelegramInitData — valid data', () => {
  it('returns parsed result for a correctly-signed initData', () => {
    const result = validateTelegramInitData(buildInitData());
    expect(result).not.toBeNull();
    expect(result?.user?.id).toBe(111222333);
    expect(result?.user?.username).toBe('alivaliyev');
  });

  it('returns correct auth_date', () => {
    const authDate = Math.floor(Date.now() / 1000) - 300;
    const result = validateTelegramInitData(buildInitData({ authDate }));
    expect(result?.auth_date).toBe(authDate);
  });

  it('accepts initData signed just before the 24h expiry window', () => {
    const authDate = Math.floor(Date.now() / 1000) - 86399;
    expect(validateTelegramInitData(buildInitData({ authDate }))).not.toBeNull();
  });
});

describe('validateTelegramInitData — invalid hash', () => {
  it('returns null for a tampered hash', () => {
    const d = buildInitData({ overrideHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(validateTelegramInitData(d)).toBeNull();
  });

  it('returns null when hash is missing entirely', () => {
    const params = new URLSearchParams({ user: '{}', auth_date: String(Date.now()) });
    expect(validateTelegramInitData(params.toString())).toBeNull();
  });

  it('returns null when signed with a different bot token', () => {
    const d = buildInitData({ signingToken: 'wrong_token_9999999' });
    expect(validateTelegramInitData(d)).toBeNull();
  });
});

describe('validateTelegramInitData — expired auth_date', () => {
  it('returns null for data older than 24 hours', () => {
    const authDate = Math.floor(Date.now() / 1000) - 86401;
    expect(validateTelegramInitData(buildInitData({ authDate }))).toBeNull();
  });
});

describe('validateTelegramInitData — malformed input', () => {
  it('returns null for an empty string', () => {
    expect(validateTelegramInitData('')).toBeNull();
  });

  it('returns null for random garbage', () => {
    expect(validateTelegramInitData('not!!valid&&data')).toBeNull();
  });

  it('returns null when user JSON is invalid', () => {
    // Build valid params but with broken user JSON
    const authDate = Math.floor(Date.now() / 1000) - 10;
    const params = new URLSearchParams({ user: '{bad_json', auth_date: String(authDate), query_id: 'test' });
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);
    expect(validateTelegramInitData(params.toString())).toBeNull();
  });
});

describe('validateTelegramInitData — user field', () => {
  it('returns non-null even without a user field (validator allows it; middleware rejects)', () => {
    const result = validateTelegramInitData(buildInitData({ withUser: false }));
    expect(result).not.toBeNull();
    expect(result?.user).toBeUndefined();
  });
});
