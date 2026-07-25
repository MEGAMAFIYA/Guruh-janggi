import { CommandContext, Context, InlineKeyboard } from 'grammy';
import { canManageGames } from '../middleware/adminCheck';
import { createGame, createGameSchema } from '../../services/gameService';

// In-memory conversation state for /yangi multi-step dialog
// Key: `${chatId}:${userId}`
interface YangiState {
  step: number;
  name?: string;
  webAppUrl?: string;
  isTeamGame?: boolean;
  minPlayers?: number;
  maxPlayers?: number;
}

const sessions = new Map<string, YangiState>();

function sessionKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function getYangiSession(chatId: number, userId: number): YangiState | undefined {
  return sessions.get(sessionKey(chatId, userId));
}

export function clearYangiSession(chatId: number, userId: number): void {
  sessions.delete(sessionKey(chatId, userId));
}

/**
 * /yangi — Multi-step game creation dialog (admin only).
 */
export async function handleYangi(ctx: CommandContext<Context>): Promise<void> {
  const allowed = await canManageGames(ctx);
  if (!allowed) {
    await ctx.reply('⛔ Bu buyruq faqat guruh administratorlari yoki bot adminlari uchun.');
    return;
  }

  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;
  const key = sessionKey(chatId, userId);

  sessions.set(key, { step: 1 });

  await ctx.reply(
    '🎮 *Yangi o\'yin qo\'shish*\n\n*1-qadam:* O\'yin nomini kiriting:\n\n_(Bekor qilish uchun /bekor deb yozing)_',
    { parse_mode: 'Markdown' },
  );
}

/**
 * Handles incoming text messages that are part of an active /yangi conversation.
 * Returns true if the message was consumed by this handler.
 */
export async function handleYangiStep(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return false;

  const key = sessionKey(chatId, userId);
  const state = sessions.get(key);
  if (!state) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  // Allow cancellation at any step
  if (text === '/bekor' || text.startsWith('/bekor@')) {
    sessions.delete(key);
    await ctx.reply('❌ O\'yin qo\'shish bekor qilindi.');
    return true;
  }

  if (state.step === 1) {
    // Step 1: game name
    if (text.length < 1 || text.length > 100) {
      await ctx.reply('⚠️ O\'yin nomi 1-100 belgi orasida bo\'lishi kerak. Qayta kiriting:');
      return true;
    }
    state.name = text;
    state.step = 2;
    await ctx.reply(
      '*2-qadam:* O\'yinning Web App / Mini App URL manzilini kiriting:\n\nMasalan: `https://example-game.com`',
      { parse_mode: 'Markdown' },
    );
    return true;
  }

  if (state.step === 2) {
    // Step 2: web app URL
    try {
      new URL(text);
    } catch {
      await ctx.reply('⚠️ Noto\'g\'ri URL. Iltimos, to\'liq URL manzilini kiriting (https:// bilan):');
      return true;
    }
    state.webAppUrl = text;
    state.step = 3;

    const kb = new InlineKeyboard()
      .text('👤 Yo\'q, jamoaviy emas', `yangi:team:no:${chatId}:${userId}`)
      .text('👥 Ha, jamoaviy', `yangi:team:yes:${chatId}:${userId}`);

    await ctx.reply('*3-qadam:* O\'yin jamoaviymi?', {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
    return true;
  }

  if (state.step === 4) {
    // Step 4: min players (as text fallback; normally handled via callback)
    return handleMinPlayers(ctx, state, key, text);
  }

  if (state.step === 5) {
    return handleMaxPlayers(ctx, state, key, text);
  }

  return false;
}

async function handleMinPlayers(ctx: Context, state: YangiState, key: string, text: string): Promise<boolean> {
  const n = parseInt(text, 10);
  if (isNaN(n)) return false;
  const allowed = state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6];
  if (!allowed.includes(n)) {
    await ctx.reply(`⚠️ Noto'g'ri son. Ruxsat etilgan: ${allowed.join(', ')}`);
    return true;
  }
  state.minPlayers = n;
  state.step = 5;
  await sendMaxPlayersKeyboard(ctx, state, key);
  return true;
}

async function handleMaxPlayers(ctx: Context, state: YangiState, key: string, text: string): Promise<boolean> {
  const n = parseInt(text, 10);
  if (isNaN(n)) return false;
  const allowed = state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6];
  if (!allowed.includes(n) || n < (state.minPlayers ?? 2)) {
    await ctx.reply(`⚠️ Maksimum minimum (${state.minPlayers})dan kichik bo'lmasligi va ${allowed.join(', ')} ichida bo'lishi kerak.`);
    return true;
  }
  state.maxPlayers = n;
  state.step = 6;
  await sendConfirmation(ctx, state, key);
  return true;
}

export async function handleYangiCallback(ctx: Context, data: string): Promise<void> {
  // data formats:
  //   yangi:team:yes|no:<chatId>:<userId>
  //   yangi:min:<value>:<chatId>:<userId>
  //   yangi:max:<value>:<chatId>:<userId>
  //   yangi:confirm:<chatId>:<userId>
  //   yangi:cancel:<chatId>:<userId>

  const parts = data.split(':');
  const action = parts[1];

  if (action === 'team') {
    const isTeam = parts[2] === 'yes';
    const chatId = parseInt(parts[3]);
    const userId = parseInt(parts[4]);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);
    if (!state || state.step !== 3) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi. /yangi dan qayta boshlang.');
      return;
    }
    state.isTeamGame = isTeam;
    state.step = 4;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `*3-qadam:* O'yin jamoaviy: *${isTeam ? 'Ha' : 'Yo\'q'}*`,
      { parse_mode: 'Markdown' },
    );
    await sendMinPlayersKeyboard(ctx, state, key, chatId, userId);
    return;
  }

  if (action === 'min') {
    const value = parseInt(parts[2]);
    const chatId = parseInt(parts[3]);
    const userId = parseInt(parts[4]);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);
    if (!state || state.step !== 4) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi.');
      return;
    }
    state.minPlayers = value;
    state.step = 5;
    await ctx.answerCallbackQuery();
    await sendMaxPlayersKeyboard(ctx, state, key);
    return;
  }

  if (action === 'max') {
    const value = parseInt(parts[2]);
    const chatId = parseInt(parts[3]);
    const userId = parseInt(parts[4]);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);
    if (!state || state.step !== 5) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi.');
      return;
    }
    if (value < (state.minPlayers ?? 2)) {
      await ctx.answerCallbackQuery(`⚠️ Maksimum minimumdan (${state.minPlayers}) kichik bo'lishi mumkin emas.`);
      return;
    }
    state.maxPlayers = value;
    state.step = 6;
    await ctx.answerCallbackQuery();
    await sendConfirmation(ctx, state, key);
    return;
  }

  if (action === 'confirm') {
    const chatId = parseInt(parts[2]);
    const userId = parseInt(parts[3]);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);
    if (!state || state.step !== 6) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi.');
      return;
    }

    const parsed = createGameSchema.safeParse({
      name: state.name,
      webAppUrl: state.webAppUrl,
      isTeamGame: state.isTeamGame,
      minPlayers: state.minPlayers,
      maxPlayers: state.maxPlayers,
    });

    if (!parsed.success) {
      await ctx.answerCallbackQuery('⚠️ Ma\'lumotlar noto\'g\'ri. /yangi dan qayta boshlang.');
      sessions.delete(key);
      return;
    }

    try {
      const game = await createGame(parsed.data);
      sessions.delete(key);
      await ctx.answerCallbackQuery('✅ O\'yin qo\'shildi!');
      await ctx.editMessageText(
        `✅ *${game.name}* o'yini muvaffaqiyatli qo'shildi!\n\n🆔 ID: \`${game.id}\`\n🌐 URL: ${game.webAppUrl}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err: any) {
      await ctx.answerCallbackQuery('❌ Xatolik yuz berdi.');
      await ctx.reply(`❌ O'yin qo'shishda xatolik: ${err.message}`);
    }
    return;
  }

  if (action === 'cancel') {
    const chatId = parseInt(parts[2]);
    const userId = parseInt(parts[3]);
    sessions.delete(sessionKey(chatId, userId));
    await ctx.answerCallbackQuery('Bekor qilindi');
    await ctx.editMessageText('❌ O\'yin qo\'shish bekor qilindi.');
    return;
  }
}

async function sendMinPlayersKeyboard(
  ctx: Context,
  state: YangiState,
  key: string,
  chatId: number,
  userId: number,
): Promise<void> {
  const options = state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6];
  const kb = new InlineKeyboard();
  for (const n of options) {
    kb.text(`${n}`, `yangi:min:${n}:${chatId}:${userId}`);
  }

  await ctx.reply('*4-qadam:* Minimal nechta o\'yinchi kerak?', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

async function sendMaxPlayersKeyboard(
  ctx: Context,
  state: YangiState,
  key: string,
): Promise<void> {
  const chatId = extractChatId(ctx);
  const userId = extractUserId(ctx);
  const options = (state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6]).filter(
    (n) => n >= (state.minPlayers ?? 2),
  );
  const kb = new InlineKeyboard();
  for (const n of options) {
    kb.text(`${n}`, `yangi:max:${n}:${chatId}:${userId}`);
  }

  await ctx.reply('*5-qadam:* Maksimal nechta o\'yinchi bo\'lishi mumkin?', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

async function sendConfirmation(ctx: Context, state: YangiState, key: string): Promise<void> {
  const chatId = extractChatId(ctx);
  const userId = extractUserId(ctx);

  const kb = new InlineKeyboard()
    .text('✅ Tasdiqlash', `yangi:confirm:${chatId}:${userId}`)
    .text('❌ Bekor qilish', `yangi:cancel:${chatId}:${userId}`);

  await ctx.reply(
    [
      '*6-qadam:* Ma\'lumotlarni tekshiring:',
      '',
      `🎮 *O\'yin:* ${state.name}`,
      `🌐 *URL:* ${state.webAppUrl}`,
      `👥 *Jamoaviy:* ${state.isTeamGame ? 'Ha' : 'Yo\'q'}`,
      `🔢 *Minimum:* ${state.minPlayers}`,
      `🔢 *Maksimum:* ${state.maxPlayers}`,
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: kb },
  );
}

function extractChatId(ctx: Context): number {
  return ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id ?? 0;
}

function extractUserId(ctx: Context): number {
  return ctx.from?.id ?? 0;
}
