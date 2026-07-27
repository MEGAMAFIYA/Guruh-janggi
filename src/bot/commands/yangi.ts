import { CommandContext, Context, InlineKeyboard } from 'grammy';
import { canManageGames } from '../middleware/adminCheck';
import { createGame, createGameSchema } from '../../services/gameService';

// ─── Conversation state ───────────────────────────────────────────────────────

// In-memory session store for the /yangi multi-step dialog.
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

// ─── /yangi command ───────────────────────────────────────────────────────────

/**
 * /yangi — Multi-step game creation dialog.
 *
 * Allowed for:
 *   • Global admins (ADMIN_TELEGRAM_IDS) in any chat (private DM or group).
 *   • Telegram admin/creator of the current group/supergroup.
 *
 * PRIVACY MODE NOTE:
 *   Steps 1 (game name) and 2 (Web App URL) require the bot to receive plain
 *   text messages from the user. In Telegram groups with Privacy Mode ENABLED
 *   the bot only receives commands (starting with '/'), so those steps will not
 *   work. Privacy Mode must be DISABLED in BotFather for the full /yangi wizard
 *   to function inside a group chat.
 *   In private (DM) chats Privacy Mode has no effect — all messages are always
 *   delivered to the bot.
 */
export async function handleYangi(ctx: CommandContext<Context>): Promise<void> {
  const userId = ctx.from?.id;
  const chatType = ctx.chat?.type;

  console.log(
    `[yangi] /yangi from user=${userId} in ${chatType ?? 'unknown'}`,
  );

  let allowed: boolean;
  try {
    allowed = await canManageGames(ctx);
  } catch (err) {
    console.error('[yangi] canManageGames error:', err);
    await ctx.reply('❌ Ruxsatni tekshirishda xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
    return;
  }

  if (!allowed) {
    if (chatType === 'private') {
      await ctx.reply(
        '⛔ Bu buyruq faqat global bot adminlari uchun.\n\n' +
          'Agar siz guruh admini bo\'lsangiz, guruhga kiring va u yerda /yangi deb yozing.',
      );
    } else {
      await ctx.reply('⛔ Bu buyruq faqat guruh administratorlari yoki global bot adminlari uchun.');
    }
    return;
  }

  const chatId = ctx.chat!.id;
  sessions.set(sessionKey(chatId, userId!), { step: 1 });

  const privacyNote =
    (chatType === 'group' || chatType === 'supergroup')
      ? '\n\n⚠️ _Eslatma: Guruhda matn kiritish uchun bot "Privacy Mode" o\'chirilgan bo\'lishi kerak (BotFather → Bot Settings → Group Privacy → Turn off)._'
      : '';

  await ctx.reply(
    `🎮 *Yangi o\'yin qo\'shish*\n\n*1-qadam:* O\'yin nomini kiriting:\n\n_(Bekor qilish uchun /bekor deb yozing)_${privacyNote}`,
    { parse_mode: 'Markdown' },
  );
}

// ─── Multi-step text handler ──────────────────────────────────────────────────

/**
 * Handles incoming text messages that are part of an active /yangi conversation.
 * Returns true if the message was consumed by this handler.
 *
 * Called from bot.on('message:text', ...). In groups with Privacy Mode ENABLED
 * this handler never fires for plain text — only for messages that start with '/'.
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

  // Allow cancellation at any step (works in groups because /bekor is a command)
  if (text === '/bekor' || text.startsWith('/bekor@')) {
    sessions.delete(key);
    await ctx.reply('❌ O\'yin qo\'shish bekor qilindi.');
    return true;
  }

  switch (state.step) {
    case 1:
      return handleStepName(ctx, state, key, text);
    case 2:
      return handleStepUrl(ctx, state, key, chatId, userId, text);
    // Steps 3 (team choice), inline keyboard callbacks only.
    // Steps 4 / 5 also have inline keyboards but accept typed numbers as fallback.
    case 4:
      return handleStepMinPlayers(ctx, state, key, text);
    case 5:
      return handleStepMaxPlayers(ctx, state, key, text);
    default:
      return false;
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleStepName(
  ctx: Context,
  state: YangiState,
  key: string,
  text: string,
): Promise<boolean> {
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

async function handleStepUrl(
  ctx: Context,
  state: YangiState,
  key: string,
  chatId: number,
  userId: number,
  text: string,
): Promise<boolean> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(text);
  } catch {
    await ctx.reply('⚠️ Noto\'g\'ri URL. Iltimos, to\'liq URL manzilini kiriting (https:// bilan):');
    return true;
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    await ctx.reply('⚠️ Faqat https:// yoki http:// URL qabul qilinadi.');
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

async function handleStepMinPlayers(
  ctx: Context,
  state: YangiState,
  key: string,
  text: string,
): Promise<boolean> {
  const n = parseInt(text, 10);
  if (isNaN(n)) {
    await ctx.reply('⚠️ Iltimos, son kiriting (masalan: 2)');
    return true;
  }
  const allowed = state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6];
  if (!allowed.includes(n)) {
    await ctx.reply(`⚠️ Noto'g'ri son. Ruxsat etilgan qiymatlar: ${allowed.join(', ')}`);
    return true;
  }
  state.minPlayers = n;
  state.step = 5;
  await sendMaxPlayersKeyboard(ctx, state, extractChatId(ctx), extractUserId(ctx));
  return true;
}

async function handleStepMaxPlayers(
  ctx: Context,
  state: YangiState,
  key: string,
  text: string,
): Promise<boolean> {
  const n = parseInt(text, 10);
  if (isNaN(n)) {
    await ctx.reply('⚠️ Iltimos, son kiriting (masalan: 4)');
    return true;
  }
  const allowed = state.isTeamGame ? [2, 4, 6] : [2, 3, 4, 5, 6];
  if (!allowed.includes(n) || n < (state.minPlayers ?? 2)) {
    await ctx.reply(
      `⚠️ Maksimum minimum (${state.minPlayers})dan kichik bo'lmasligi va ${allowed.join(', ')} ichida bo'lishi kerak.`,
    );
    return true;
  }
  state.maxPlayers = n;
  state.step = 6;
  await sendConfirmation(ctx, state, extractChatId(ctx), extractUserId(ctx));
  return true;
}

// ─── Callback handler ─────────────────────────────────────────────────────────

/**
 * Handles all yangi:* callback query data routed from the central callback handler.
 * Callback queries always reach the bot regardless of Telegram Privacy Mode.
 */
export async function handleYangiCallback(ctx: Context, data: string): Promise<void> {
  // Callback data formats:
  //   yangi:team:yes|no:<chatId>:<userId>
  //   yangi:min:<value>:<chatId>:<userId>
  //   yangi:max:<value>:<chatId>:<userId>
  //   yangi:confirm:<chatId>:<userId>
  //   yangi:cancel:<chatId>:<userId>

  const parts = data.split(':');
  const action = parts[1];

  if (action === 'team') {
    const isTeam = parts[2] === 'yes';
    const chatId = parseInt(parts[3], 10);
    const userId = parseInt(parts[4], 10);
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
    await sendMinPlayersKeyboard(ctx, state, chatId, userId);
    return;
  }

  if (action === 'min') {
    const value = parseInt(parts[2], 10);
    const chatId = parseInt(parts[3], 10);
    const userId = parseInt(parts[4], 10);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);

    if (!state || state.step !== 4) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi.');
      return;
    }
    state.minPlayers = value;
    state.step = 5;
    await ctx.answerCallbackQuery();
    await sendMaxPlayersKeyboard(ctx, state, chatId, userId);
    return;
  }

  if (action === 'max') {
    const value = parseInt(parts[2], 10);
    const chatId = parseInt(parts[3], 10);
    const userId = parseInt(parts[4], 10);
    const key = sessionKey(chatId, userId);
    const state = sessions.get(key);

    if (!state || state.step !== 5) {
      await ctx.answerCallbackQuery('⚠️ Session topilmadi.');
      return;
    }
    if (value < (state.minPlayers ?? 2)) {
      await ctx.answerCallbackQuery(
        `⚠️ Maksimum minimumdan (${state.minPlayers}) kichik bo'lishi mumkin emas.`,
      );
      return;
    }
    state.maxPlayers = value;
    state.step = 6;
    await ctx.answerCallbackQuery();
    await sendConfirmation(ctx, state, chatId, userId);
    return;
  }

  if (action === 'confirm') {
    const chatId = parseInt(parts[2], 10);
    const userId = parseInt(parts[3], 10);
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
      const msg = parsed.error.errors[0]?.message ?? 'Noma\'lum xatolik';
      await ctx.answerCallbackQuery(`⚠️ ${msg}`);
      sessions.delete(key);
      return;
    }

    try {
      const game = await createGame(parsed.data);
      sessions.delete(key);
      await ctx.answerCallbackQuery('✅ O\'yin qo\'shildi!');
      await ctx.editMessageText(
        [
          `✅ *${game.name}* o'yini muvaffaqiyatli qo'shildi!`,
          ``,
          `🆔 ID: \`${game.id}\``,
          `🌐 URL: ${game.webAppUrl}`,
          `👥 Jamoaviy: ${game.isTeamGame ? 'Ha' : 'Yo\'q'}`,
          `🔢 O'yinchilar: ${game.minPlayers}–${game.maxPlayers}`,
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      console.log(`[yangi] Game created: id=${game.id} name="${game.name}" by user=${userId}`);
    } catch (err: any) {
      console.error('[yangi] createGame error:', err);
      await ctx.answerCallbackQuery('❌ Xatolik yuz berdi.');
      await ctx.reply(`❌ O'yin qo'shishda xatolik: ${err.message}`);
    }
    return;
  }

  if (action === 'cancel') {
    const chatId = parseInt(parts[2], 10);
    const userId = parseInt(parts[3], 10);
    sessions.delete(sessionKey(chatId, userId));
    await ctx.answerCallbackQuery('Bekor qilindi');
    await ctx.editMessageText('❌ O\'yin qo\'shish bekor qilindi.');
    return;
  }
}

// ─── Keyboard builders ────────────────────────────────────────────────────────

async function sendMinPlayersKeyboard(
  ctx: Context,
  state: YangiState,
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
  chatId: number,
  userId: number,
): Promise<void> {
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

async function sendConfirmation(
  ctx: Context,
  state: YangiState,
  chatId: number,
  userId: number,
): Promise<void> {
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

// ─── Context extractors ───────────────────────────────────────────────────────

function extractChatId(ctx: Context): number {
  return ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id ?? 0;
}

function extractUserId(ctx: Context): number {
  return ctx.from?.id ?? 0;
}
