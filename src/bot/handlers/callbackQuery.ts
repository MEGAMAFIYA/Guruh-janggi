import { Context, InlineKeyboard } from 'grammy';
import { findGameById } from '../../services/gameService';
import {
  createMatch,
  findWaitingMatchInChat,
  getMatchWithPlayers,
  isUserInMatch,
  joinMatch,
  startMatch,
  updateMatchMessageId,
  MatchWithPlayers,
} from '../../services/matchService';
import { findUserByTelegramId } from '../../services/userService';
import {
  notifyGroupMatchStarted,
  notifyPlayersMatchStarted,
} from '../../services/notificationService';
import { handleYangiCallback } from '../commands/yangi';
import { isGlobalAdmin, isGroupAdmin } from '../middleware/adminCheck';

/**
 * Central callback query router.
 */
export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    if (data.startsWith('game:select:')) {
      await handleGameSelect(ctx, data);
    } else if (data.startsWith('match:join:')) {
      await handleMatchJoin(ctx, data);
    } else if (data.startsWith('match:start:')) {
      await handleMatchStart(ctx, data);
    } else if (data.startsWith('yangi:')) {
      await handleYangiCallback(ctx, data);
    } else {
      await ctx.answerCallbackQuery('❓ Noma\'lum harakat');
    }
  } catch (err: any) {
    console.error('[callbackQuery] Error:', err);
    await ctx.answerCallbackQuery('❌ Xatolik yuz berdi').catch(() => {});
  }
}

// ─── Game Select ──────────────────────────────────────────────────────────────

async function handleGameSelect(ctx: Context, data: string): Promise<void> {
  // Answer immediately — Telegram has a 10s callback timeout
  await ctx.answerCallbackQuery();

  const gameId = data.replace('game:select:', '');
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return;

  const game = await findGameById(gameId);
  if (!game || !game.isActive) {
    await ctx.reply('❌ O\'yin topilmadi yoki o\'chirilgan');
    return;
  }

  const dbUser = await findUserByTelegramId(userId);
  if (!dbUser) {
    await ctx.reply('⚠️ Avval /start buyrug\'ini yuboring');
    return;
  }

  // Find existing waiting match or create a new one
  let match = await findWaitingMatchInChat(BigInt(chatId), gameId);
  const isNewMatch = !match;

  if (!match) {
    const created = await createMatch(gameId, BigInt(chatId), game.minPlayers, game.maxPlayers);
    match = await getMatchWithPlayers(created.id);
  }

  if (!match) {
    await ctx.reply('❌ Match yaratishda xatolik');
    return;
  }

  // Auto-join the selector if not already in match
  const alreadyIn = await isUserInMatch(match.id, dbUser.id);
  if (!alreadyIn) {
    await safeJoinMatch(match.id, dbUser.id);
    match = await getMatchWithPlayers(match.id);
    if (!match) return;
  }

  // ── Panel management ───────────────────────────────────────────────────────
  // If an existing match already has a panel message in the group, EDIT it
  // instead of sending a second one. Only send a new panel for brand new matches
  // or when the old message was deleted.
  if (!isNewMatch && match.messageId) {
    try {
      await ctx.api.editMessageText(
        chatId,
        match.messageId,
        buildJoinPanel(match),
        { parse_mode: 'Markdown', reply_markup: buildJoinKeyboard(match) },
      );
    } catch {
      // Original message deleted — send a fresh panel
      const sent = await ctx.reply(buildJoinPanel(match), {
        parse_mode: 'Markdown',
        reply_markup: buildJoinKeyboard(match),
      });
      await updateMatchMessageId(match.id, sent.message_id);
    }
  } else {
    const sent = await ctx.reply(buildJoinPanel(match), {
      parse_mode: 'Markdown',
      reply_markup: buildJoinKeyboard(match),
    });
    await updateMatchMessageId(match.id, sent.message_id);
  }

  // Auto-start when all slots filled (maxPlayers reached)
  if (match.players.length >= match.maxPlayers) {
    await doStartMatch(ctx, match.id);
  }
}

// ─── Match Join ───────────────────────────────────────────────────────────────

async function handleMatchJoin(ctx: Context, data: string): Promise<void> {
  const matchId = data.replace('match:join:', '');
  const userId = ctx.from?.id;
  if (!userId) { await ctx.answerCallbackQuery(); return; }

  const dbUser = await findUserByTelegramId(userId);
  if (!dbUser) {
    await ctx.answerCallbackQuery('⚠️ Avval /start buyrug\'ini yuboring');
    return;
  }

  let match = await getMatchWithPlayers(matchId);
  if (!match) {
    await ctx.answerCallbackQuery('❌ Match topilmadi');
    return;
  }

  if (match.status !== 'WAITING') {
    await ctx.answerCallbackQuery('⚠️ Bu match allaqachon boshlangan yoki tugagan');
    return;
  }

  if (match.players.length >= match.maxPlayers) {
    await ctx.answerCallbackQuery('⚠️ Match to\'liq, yangi o\'yinchi sig\'maydi');
    return;
  }

  const alreadyIn = await isUserInMatch(matchId, dbUser.id);
  if (alreadyIn) {
    await ctx.answerCallbackQuery('ℹ️ Siz allaqachon bu matchdasiz');
    return;
  }

  const joined = await safeJoinMatch(matchId, dbUser.id);
  if (!joined) {
    await ctx.answerCallbackQuery('ℹ️ Siz allaqachon bu matchdasiz');
    return;
  }

  match = await getMatchWithPlayers(matchId) as MatchWithPlayers;
  await ctx.answerCallbackQuery('✅ Qo\'shildingiz!');

  // Update the existing join panel message
  try {
    if (match.messageId) {
      await ctx.api.editMessageText(
        Number(match.chatId),
        match.messageId,
        buildJoinPanel(match),
        { parse_mode: 'Markdown', reply_markup: buildJoinKeyboard(match) },
      );
    }
  } catch { /* message may have been deleted */ }

  // Auto-start when all slots filled
  if (match.players.length >= match.maxPlayers) {
    await doStartMatch(ctx, matchId);
  }
}

// ─── Match Start ──────────────────────────────────────────────────────────────

async function handleMatchStart(ctx: Context, data: string): Promise<void> {
  const matchId = data.replace('match:start:', '');
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) { await ctx.answerCallbackQuery(); return; }

  const dbUser = await findUserByTelegramId(userId);
  if (!dbUser) {
    await ctx.answerCallbackQuery('⚠️ Avval /start buyrug\'ini yuboring');
    return;
  }

  const match = await getMatchWithPlayers(matchId);
  if (!match) {
    await ctx.answerCallbackQuery('❌ Match topilmadi');
    return;
  }

  if (match.status !== 'WAITING') {
    await ctx.answerCallbackQuery('⚠️ Match allaqachon boshlangan');
    return;
  }

  // Authorization: must be a match participant OR group admin OR global admin
  const inMatch = await isUserInMatch(matchId, dbUser.id);
  const groupAdmin = await isGroupAdmin(ctx, chatId, userId);
  const globalAdmin = isGlobalAdmin(userId);

  if (!inMatch && !groupAdmin && !globalAdmin) {
    await ctx.answerCallbackQuery('⛔ Faqat o\'yinchilar yoki adminlar boshlay oladi');
    return;
  }

  if (match.players.length < match.requiredPlayers) {
    await ctx.answerCallbackQuery(
      `⚠️ Kamida ${match.requiredPlayers} o\'yinchi kerak (hozir ${match.players.length})`,
    );
    return;
  }

  // Team game: enforce even player count
  if (match.game.isTeamGame && match.players.length % 2 !== 0) {
    await ctx.answerCallbackQuery('⚠️ Jamoaviy o\'yin uchun juft sonli o\'yinchi kerak');
    return;
  }

  await ctx.answerCallbackQuery('🚀 O\'yin boshlanmoqda...');
  await doStartMatch(ctx, matchId);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Joins a match, handling the unique-constraint race condition gracefully.
 * Returns true if the join succeeded, false if the user was already in the match.
 */
async function safeJoinMatch(matchId: string, userId: string): Promise<boolean> {
  try {
    await joinMatch(matchId, userId);
    return true;
  } catch (err: any) {
    // Prisma unique constraint violation code
    if (err?.code === 'P2002') return false;
    throw err;
  }
}

async function doStartMatch(ctx: Context, matchId: string): Promise<void> {
  let match: MatchWithPlayers;
  try {
    match = await startMatch(matchId);
  } catch (err: any) {
    // Match may have already been started by a concurrent action
    console.warn('[doStartMatch]', err.message);
    return;
  }

  // Remove buttons from join panel and mark as started
  try {
    if (match.messageId) {
      await ctx.api.editMessageText(
        Number(match.chatId),
        match.messageId,
        buildStartedPanel(match),
        { parse_mode: 'Markdown' },
      );
    }
  } catch { /* message may have been deleted */ }

  await notifyPlayersMatchStarted(match);
  await notifyGroupMatchStarted(match.chatId, match);
}

function buildJoinPanel(match: MatchWithPlayers): string {
  const playerList = match.players
    .map((p) => {
      const name = p.user.lastName
        ? `${p.user.firstName} ${p.user.lastName}`
        : p.user.firstName;
      return `  • ${name}`;
    })
    .join('\n');

  const lines = [
    `🎮 *${match.game.name}*`,
    `👥 O'yinchilar: ${match.players.length}/${match.maxPlayers}`,
  ];
  if (playerList) lines.push('', playerList);
  return lines.join('\n');
}

function buildJoinKeyboard(match: MatchWithPlayers): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('➕ Qo\'shilish', `match:join:${match.id}`);

  // Show Start button once minimum players are gathered
  if (match.players.length >= match.requiredPlayers) {
    kb.row().text('🚀 Boshlash', `match:start:${match.id}`);
  }

  return kb;
}

function buildStartedPanel(match: MatchWithPlayers): string {
  return [
    `🎮 *${match.game.name}*`,
    `✅ O'yin boshlandi!`,
    `👥 Ishtirokchilar: ${match.players.length}`,
  ].join('\n');
}
