/**
 * Unit tests for bot command handlers and permission logic.
 * All Telegram API calls and database operations are mocked.
 */

// ── Module mocks (hoisted before imports) ────────────────────────────────────

jest.mock('../config', () => ({
  config: {
    bot: { token: 'test_token', webhookUrl: null, webhookSecret: 'secret' },
    db: { url: 'postgresql://localhost/test' },
    server: { port: 3000, nodeEnv: 'test', isProduction: false, sessionSecret: 'secret' },
    // User 999999 is the global admin in all tests.
    admin: { telegramIds: [999999] },
    webApp: { baseUrl: 'https://example.com' },
  },
}));

jest.mock('../database/prisma', () => ({
  prisma: {
    user: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
    game: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Keep real createGameSchema; mock only DB-bound functions.
jest.mock('../services/gameService', () => {
  const actual = jest.requireActual('../services/gameService') as Record<string, unknown>;
  return {
    ...actual,
    listActiveGames: jest.fn(),
    createGame: jest.fn(),
  };
});

jest.mock('../services/notificationService', () => ({
  setBotInstance: jest.fn(),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { handleStart } from '../bot/commands/start';
import { handleGuruh } from '../bot/commands/guruh';
import {
  handleYangi,
  handleYangiStep,
  clearYangiSession,
  getYangiSession,
} from '../bot/commands/yangi';
import { isGlobalAdmin, isGroupAdmin, canManageGames } from '../bot/middleware/adminCheck';
import { listActiveGames } from '../services/gameService';

// ── Context factory ───────────────────────────────────────────────────────────

type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

interface MakeCtxOpts {
  userId?: number;
  chatId?: number;
  chatType?: ChatType;
  text?: string;
  getChatMemberStatus?: string;
}

function makeCtx(opts: MakeCtxOpts = {}) {
  const {
    userId = 100,
    chatType = 'group',
    text = '',
    getChatMemberStatus = 'member',
  } = opts;
  // In private chats the chat ID equals the user ID (Telegram convention).
  const chatId = opts.chatId ?? (chatType === 'private' ? userId : -1001234567890);

  const reply = jest.fn().mockResolvedValue({ message_id: 1 });
  const answerCallbackQuery = jest.fn().mockResolvedValue(undefined);
  const editMessageText = jest.fn().mockResolvedValue(undefined);
  const getChatMember = jest.fn().mockResolvedValue({ status: getChatMemberStatus });

  return {
    from: { id: userId, first_name: 'Test', last_name: null, username: null, is_bot: false },
    chat: { id: chatId, type: chatType },
    message: { text, message_id: 1 },
    update: { update_id: 1 },
    reply,
    answerCallbackQuery,
    editMessageText,
    api: { getChatMember },
    // Expose mocks for assertions
    _mocks: { reply, answerCallbackQuery, editMessageText, getChatMember },
  } as any;
}

// Shared IDs used across tests
const GLOBAL_ADMIN = 999999;
const GROUP_ADMIN = 111111;
const REGULAR_USER = 222222;
const GROUP_CHAT_ID = -1001234567890;

// ── /start ────────────────────────────────────────────────────────────────────

describe('/start command', () => {
  it('sends a welcome message in private chat', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain('Salom');
    expect(text).toContain('Telegram Game Platform');
  });

  it('includes the user name in the greeting', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    ctx.from.first_name = 'Ali';
    ctx.from.last_name = 'Valiyev';
    await handleStart(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain('Ali Valiyev');
  });

  it('returns without replying when ctx.from is missing', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    ctx.from = undefined;
    await handleStart(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

// ── /guruh ────────────────────────────────────────────────────────────────────

describe('/guruh command — private chat', () => {
  it('tells the user to use the command inside a group', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    await handleGuruh(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain('guruh');
  });

  it('does not call listActiveGames', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    await handleGuruh(ctx);
    expect(listActiveGames).not.toHaveBeenCalled();
  });
});

describe('/guruh command — group chat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows game list with inline keyboard when games exist', async () => {
    (listActiveGames as jest.Mock).mockResolvedValue([
      { id: 'g1', name: 'Chess', isActive: true },
      { id: 'g2', name: 'Checkers', isActive: true },
    ]);
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'group' });
    await handleGuruh(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(text).toContain('tanlang');
    expect(opts?.reply_markup).toBeDefined();
  });

  it('shows "no games" message when database is empty', async () => {
    (listActiveGames as jest.Mock).mockResolvedValue([]);
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'group' });
    await handleGuruh(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('o\'yin qo\'shilmagan');
  });

  it('shows error message (not silent) when database throws', async () => {
    (listActiveGames as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'group' });
    await handleGuruh(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('xatolik');
  });

  it('works in a supergroup (type=supergroup)', async () => {
    (listActiveGames as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'Chess', isActive: true }]);
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'supergroup' });
    await handleGuruh(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [, opts] = ctx.reply.mock.calls[0];
    expect(opts?.reply_markup).toBeDefined();
  });
});

// ── /yangi — permission checks ────────────────────────────────────────────────

describe('/yangi command — permission checks', () => {
  afterEach(() => {
    clearYangiSession(GLOBAL_ADMIN, GLOBAL_ADMIN); // private: chatId === userId
    clearYangiSession(GROUP_CHAT_ID, GROUP_ADMIN);
    clearYangiSession(GROUP_CHAT_ID, REGULAR_USER);
  });

  it('starts wizard for global admin in private chat', async () => {
    const ctx = makeCtx({ userId: GLOBAL_ADMIN, chatType: 'private' });
    await handleYangi(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('1-qadam');
    // Session should be created at step 1
    expect(getYangiSession(GLOBAL_ADMIN, GLOBAL_ADMIN)?.step).toBe(1);
  });

  it('shows permission error for non-admin in private chat', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    await handleYangi(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('⛔');
    expect(getYangiSession(REGULAR_USER, REGULAR_USER)).toBeUndefined();
  });

  it('starts wizard for group admin in group chat', async () => {
    const ctx = makeCtx({
      userId: GROUP_ADMIN,
      chatId: GROUP_CHAT_ID,
      chatType: 'group',
      getChatMemberStatus: 'administrator',
    });
    await handleYangi(ctx);
    expect(ctx.api.getChatMember).toHaveBeenCalledWith(GROUP_CHAT_ID, GROUP_ADMIN);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('1-qadam');
    expect(getYangiSession(GROUP_CHAT_ID, GROUP_ADMIN)?.step).toBe(1);
  });

  it('starts wizard for group creator in group chat', async () => {
    const ctx = makeCtx({
      userId: GROUP_ADMIN,
      chatId: GROUP_CHAT_ID,
      chatType: 'group',
      getChatMemberStatus: 'creator',
    });
    await handleYangi(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain('1-qadam');
  });

  it('shows permission error for regular user in group', async () => {
    const ctx = makeCtx({
      userId: REGULAR_USER,
      chatId: GROUP_CHAT_ID,
      chatType: 'group',
      getChatMemberStatus: 'member',
    });
    await handleYangi(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('⛔');
    expect(getYangiSession(GROUP_CHAT_ID, REGULAR_USER)).toBeUndefined();
  });
});

// ── Group admin permission verification ───────────────────────────────────────

describe('group admin permission verification (isGroupAdmin)', () => {
  it('returns true when getChatMember returns "administrator"', async () => {
    const ctx = makeCtx({ getChatMemberStatus: 'administrator' });
    expect(await isGroupAdmin(ctx, GROUP_CHAT_ID, GROUP_ADMIN)).toBe(true);
  });

  it('returns true when getChatMember returns "creator"', async () => {
    const ctx = makeCtx({ getChatMemberStatus: 'creator' });
    expect(await isGroupAdmin(ctx, GROUP_CHAT_ID, GROUP_ADMIN)).toBe(true);
  });

  it('returns false for "member" status', async () => {
    const ctx = makeCtx({ getChatMemberStatus: 'member' });
    expect(await isGroupAdmin(ctx, GROUP_CHAT_ID, GROUP_ADMIN)).toBe(false);
  });

  it('returns false for "left" status', async () => {
    const ctx = makeCtx({ getChatMemberStatus: 'left' });
    expect(await isGroupAdmin(ctx, GROUP_CHAT_ID, GROUP_ADMIN)).toBe(false);
  });

  it('returns false (not throws) when Telegram API throws', async () => {
    const ctx = makeCtx();
    ctx.api.getChatMember = jest.fn().mockRejectedValue(new Error('API error'));
    expect(await isGroupAdmin(ctx, GROUP_CHAT_ID, GROUP_ADMIN)).toBe(false);
  });
});

describe('isGlobalAdmin', () => {
  it('returns true for a configured global admin ID', () => {
    expect(isGlobalAdmin(GLOBAL_ADMIN)).toBe(true);
  });

  it('returns false for an unknown user ID', () => {
    expect(isGlobalAdmin(REGULAR_USER)).toBe(false);
  });
});

describe('canManageGames', () => {
  it('returns true for global admin in private chat without API call', async () => {
    const ctx = makeCtx({ userId: GLOBAL_ADMIN, chatType: 'private' });
    expect(await canManageGames(ctx)).toBe(true);
    expect(ctx.api.getChatMember).not.toHaveBeenCalled();
  });

  it('returns false for non-admin in private chat without API call', async () => {
    const ctx = makeCtx({ userId: REGULAR_USER, chatType: 'private' });
    expect(await canManageGames(ctx)).toBe(false);
    expect(ctx.api.getChatMember).not.toHaveBeenCalled();
  });

  it('returns false when ctx.from is missing', async () => {
    const ctx = makeCtx();
    ctx.from = undefined;
    expect(await canManageGames(ctx)).toBe(false);
  });
});

// ── /yangi conversation flow ──────────────────────────────────────────────────

describe('/yangi conversation flow — non-team game', () => {
  const chatId = GLOBAL_ADMIN; // private chat: chatId === userId
  const userId = GLOBAL_ADMIN;

  beforeEach(async () => {
    // Start a fresh /yangi wizard for each test
    const ctx = makeCtx({ userId, chatType: 'private' });
    await handleYangi(ctx);
  });

  afterEach(() => clearYangiSession(chatId, userId));

  it('step 1: accepts a valid game name and advances to step 2', async () => {
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: 'My Awesome Game' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(2);
    expect(ctx.reply.mock.calls[0][0]).toContain('2-qadam');
  });

  it('step 1: rejects a name longer than 100 characters and stays at step 1', async () => {
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: 'x'.repeat(101) });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 1: rejects a name longer than 100 characters', async () => {
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: 'x'.repeat(101) });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(1);
    expect(ctx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 2: accepts a valid https URL and advances to step 3', async () => {
    // First advance to step 2
    const nameCtx = makeCtx({ userId, chatId, chatType: 'private', text: 'Test Game' });
    await handleYangiStep(nameCtx);

    const urlCtx = makeCtx({
      userId,
      chatId,
      chatType: 'private',
      text: 'https://game.example.com',
    });
    const consumed = await handleYangiStep(urlCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(3);
    // Should show team/solo keyboard
    expect(urlCtx.reply.mock.calls[0][1]?.reply_markup).toBeDefined();
  });

  it('step 2: accepts a valid http URL', async () => {
    const nameCtx = makeCtx({ userId, chatId, chatType: 'private', text: 'Test Game' });
    await handleYangiStep(nameCtx);

    const urlCtx = makeCtx({
      userId,
      chatId,
      chatType: 'private',
      text: 'http://game.example.com',
    });
    const consumed = await handleYangiStep(urlCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(3);
  });

  it('step 2: rejects a bare domain without protocol', async () => {
    const nameCtx = makeCtx({ userId, chatId, chatType: 'private', text: 'Test Game' });
    await handleYangiStep(nameCtx);

    const urlCtx = makeCtx({ userId, chatId, chatType: 'private', text: 'example.com/game' });
    const consumed = await handleYangiStep(urlCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(2);
    expect(urlCtx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 2: rejects a javascript: URL', async () => {
    const nameCtx = makeCtx({ userId, chatId, chatType: 'private', text: 'Test Game' });
    await handleYangiStep(nameCtx);

    const urlCtx = makeCtx({
      userId,
      chatId,
      chatType: 'private',
      text: 'javascript:alert(1)',
    });
    const consumed = await handleYangiStep(urlCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(2);
    expect(urlCtx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('cancel: /bekor clears the session at any step', async () => {
    const cancelCtx = makeCtx({ userId, chatId, chatType: 'private', text: '/bekor' });
    const consumed = await handleYangiStep(cancelCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)).toBeUndefined();
    expect(cancelCtx.reply.mock.calls[0][0]).toContain('bekor');
  });

  it('unknown step returns false (not consumed)', async () => {
    // Manually force a step the handler doesn't handle
    const session = getYangiSession(chatId, userId)!;
    session.step = 99;

    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: 'hello' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(false);
  });
});

// ─── /yangi flow — non-team game: min/max player steps ────────────────────────

describe('/yangi conversation flow — min/max players (non-team game, text input)', () => {
  const chatId = GLOBAL_ADMIN;
  const userId = GLOBAL_ADMIN;

  // Helper: advance wizard to step 4 (min players), non-team game
  async function advanceToStep4(): Promise<void> {
    const start = makeCtx({ userId, chatId, chatType: 'private' });
    await handleYangi(start);

    const name = makeCtx({ userId, chatId, chatType: 'private', text: 'Test Game' });
    await handleYangiStep(name);

    const url = makeCtx({
      userId,
      chatId,
      chatType: 'private',
      text: 'https://game.example.com',
    });
    await handleYangiStep(url);

    // Simulate the inline callback for "non-team"
    const state = getYangiSession(chatId, userId)!;
    state.isTeamGame = false;
    state.step = 4;
  }

  afterEach(() => clearYangiSession(chatId, userId));

  it('step 4: accepts a valid min player count (2) and advances to step 5', async () => {
    await advanceToStep4();
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: '2' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.minPlayers).toBe(2);
    expect(getYangiSession(chatId, userId)?.step).toBe(5);
  });

  it('step 4: rejects a non-numeric input', async () => {
    await advanceToStep4();
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: 'abc' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(4);
    expect(ctx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 5: rejects max < min', async () => {
    await advanceToStep4();

    // Set min to 4
    const minCtx = makeCtx({ userId, chatId, chatType: 'private', text: '4' });
    await handleYangiStep(minCtx);

    // Attempt max = 2 (< min)
    const maxCtx = makeCtx({ userId, chatId, chatType: 'private', text: '2' });
    const consumed = await handleYangiStep(maxCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.maxPlayers).toBeUndefined();
    expect(maxCtx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 5: accepts valid max >= min', async () => {
    await advanceToStep4();

    const minCtx = makeCtx({ userId, chatId, chatType: 'private', text: '2' });
    await handleYangiStep(minCtx);

    const maxCtx = makeCtx({ userId, chatId, chatType: 'private', text: '4' });
    const consumed = await handleYangiStep(maxCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.maxPlayers).toBe(4);
    expect(getYangiSession(chatId, userId)?.step).toBe(6);
  });
});

// ─── /yangi flow — team game: only even numbers ────────────────────────────────

describe('/yangi conversation flow — team game validation', () => {
  const chatId = GLOBAL_ADMIN;
  const userId = GLOBAL_ADMIN;

  async function advanceToStep4Team(): Promise<void> {
    const start = makeCtx({ userId, chatId, chatType: 'private' });
    await handleYangi(start);
    const name = makeCtx({ userId, chatId, chatType: 'private', text: 'Team Battle' });
    await handleYangiStep(name);
    const url = makeCtx({
      userId,
      chatId,
      chatType: 'private',
      text: 'https://game.example.com',
    });
    await handleYangiStep(url);
    // Force step 4 with isTeamGame=true
    const state = getYangiSession(chatId, userId)!;
    state.isTeamGame = true;
    state.step = 4;
  }

  afterEach(() => clearYangiSession(chatId, userId));

  it('step 4: rejects odd min player count for team game (3)', async () => {
    await advanceToStep4Team();
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: '3' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(4);
    expect(ctx.reply.mock.calls[0][0]).toContain('⚠️');
  });

  it('step 4: accepts even min player count for team game (2)', async () => {
    await advanceToStep4Team();
    const ctx = makeCtx({ userId, chatId, chatType: 'private', text: '2' });
    const consumed = await handleYangiStep(ctx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(5);
  });

  it('step 5: rejects odd max player count for team game (3)', async () => {
    await advanceToStep4Team();
    const minCtx = makeCtx({ userId, chatId, chatType: 'private', text: '2' });
    await handleYangiStep(minCtx);

    const maxCtx = makeCtx({ userId, chatId, chatType: 'private', text: '3' });
    const consumed = await handleYangiStep(maxCtx);
    expect(consumed).toBe(true);
    expect(getYangiSession(chatId, userId)?.step).toBe(5);
    expect(maxCtx.reply.mock.calls[0][0]).toContain('⚠️');
  });
});

// ─── database game creation ────────────────────────────────────────────────────

describe('database game creation (createGame called on confirm)', () => {
  const chatId = 77777;
  const userId = 77777;

  afterEach(() => clearYangiSession(chatId, userId));

  it('handleYangiCallback confirm: calls createGame with correct data', async () => {
    const { createGame } = jest.requireMock('../services/gameService');
    const fakeGame = {
      id: 'g_new',
      name: 'Chess',
      webAppUrl: 'https://chess.example.com',
      isTeamGame: false,
      minPlayers: 2,
      maxPlayers: 4,
      slug: 'chess',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    createGame.mockResolvedValue(fakeGame);

    // Pre-populate session at step 6 (ready to confirm)
    // Import sessions indirectly via handleYangi to build a full session
    const startCtx = makeCtx({ userId, chatId, chatType: 'private' });
    // We'll use the real GLOBAL_ADMIN to bypass permission check
    startCtx.from.id = GLOBAL_ADMIN;
    startCtx.chat.id = GLOBAL_ADMIN;
    await handleYangi(startCtx);

    const state = getYangiSession(GLOBAL_ADMIN, GLOBAL_ADMIN)!;
    state.name = 'Chess';
    state.webAppUrl = 'https://chess.example.com';
    state.isTeamGame = false;
    state.minPlayers = 2;
    state.maxPlayers = 4;
    state.step = 6;

    const { handleYangiCallback } = await import('../bot/commands/yangi');
    const callbackCtx = makeCtx({ userId: GLOBAL_ADMIN, chatId: GLOBAL_ADMIN });
    callbackCtx.answerCallbackQuery = jest.fn().mockResolvedValue(undefined);
    callbackCtx.editMessageText = jest.fn().mockResolvedValue(undefined);

    await handleYangiCallback(callbackCtx, `yangi:confirm:${GLOBAL_ADMIN}:${GLOBAL_ADMIN}`);

    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chess',
        webAppUrl: 'https://chess.example.com',
        isTeamGame: false,
        minPlayers: 2,
        maxPlayers: 4,
      }),
    );
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('muvaffaqiyatli'),
      expect.any(Object),
    );
  });

  it('handleYangiCallback confirm: shows error message when createGame throws', async () => {
    const { createGame } = jest.requireMock('../services/gameService');
    createGame.mockRejectedValue(new Error('Duplicate slug'));

    const startCtx = makeCtx({ userId: GLOBAL_ADMIN, chatId: GLOBAL_ADMIN, chatType: 'private' });
    startCtx.from.id = GLOBAL_ADMIN;
    startCtx.chat.id = GLOBAL_ADMIN;
    await handleYangi(startCtx);

    const state = getYangiSession(GLOBAL_ADMIN, GLOBAL_ADMIN)!;
    state.name = 'Dup';
    state.webAppUrl = 'https://dup.example.com';
    state.isTeamGame = false;
    state.minPlayers = 2;
    state.maxPlayers = 4;
    state.step = 6;

    const { handleYangiCallback } = await import('../bot/commands/yangi');
    const callbackCtx = makeCtx({ userId: GLOBAL_ADMIN, chatId: GLOBAL_ADMIN });
    callbackCtx.answerCallbackQuery = jest.fn().mockResolvedValue(undefined);
    callbackCtx.editMessageText = jest.fn().mockResolvedValue(undefined);
    callbackCtx.reply = jest.fn().mockResolvedValue({ message_id: 1 });

    await handleYangiCallback(callbackCtx, `yangi:confirm:${GLOBAL_ADMIN}:${GLOBAL_ADMIN}`);

    expect(callbackCtx.reply).toHaveBeenCalledWith(expect.stringContaining('xatolik'));
  });
});
