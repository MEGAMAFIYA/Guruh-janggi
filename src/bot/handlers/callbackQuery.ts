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
  const gameId = data.replace('game:select:', '');
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const game = await findGameById(gameId);
  if (!game || !game.isActive) {
    await ctx.answerCallbackQuery('❌ O\'yin topilmadi yoki o\'chirilgan');
    return;
  }

  const dbUser = await findUserByTelegramId(userId);
  if (!dbUser) {
    await ctx.answerCallbackQuery('⚠️ Avval /start buyrug\'ini yuboring');
    return;
  }

  // Find or create a waiting match for this game in this chat
  let match = await findWaitingMatchInChat(BigInt(chatId), gameId);

  if (!match) {
    match = await createMatch(gameId, BigInt(chatId), game.minPlayers, game.maxPlayers) as any;
    match = await getMatchWithPlayers(match!.id) as any;
  }

  if (!match) {
    await ctx.answerCallbackQuery('❌ Match yaratishda xatolik');
    return;
  }

  // Auto-join the selector
  const alreadyIn = await isUserInMatch(match.id, dbUser.id);
  if (!alreadyIn) {
    await joinMatch(match.id, dbUser.id);
    // Refresh
    match = await getMatchWithPlayers(match.id) as any;
  }

  await ctx.answerCallbackQuery();
  const sentMsg = await ctx.reply(buildJoinPanel(match!), {
    parse_mode: 'Markdown',
    reply_markup: buildJoinKeyboard(match!),
  });

  await updateMatchMessageId(match!.id, sentMsg.message_id);

  // Auto-start if maxPlayers reached
  if (match!.players.length >= match!.maxPlayers) {
    await doStartMatch(ctx, match!.id);
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

  await joinMatch(matchId, dbUser.id);
  match = await getMatchWithPlayers(matchId) as any;
  await ctx.answerCallbackQuery('✅ Qo\'shildingiz!');

  // Update join panel message
  try {
    if (match!.messageId) {
      await ctx.api.editMessageText(
        Number(match!.chatId),
        match!.messageId,
        buildJoinPanel(match!),
        { parse_mode: 'Markdown', reply_markup: buildJoinKeyboard(match!) },
      );
    }
  } catch { /* message may have been deleted */ }

  // Auto-start when maxPlayers reached
  if (match!.players.length >= match!.maxPlayers) {
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
  if (!dbUser) { await ctx.answerCallbackQuery('⚠️ Avval /start buyrug\'ini yuboring'); return; }

  const match = await getMatchWithPlayers(matchId);
  if (!match) { await ctx.answerCallbackQuery('❌ Match topilmadi'); return; }

  if (match.status !== 'WAITING') {
    await ctx.answerCallbackQuery('⚠️ Match allaqachon boshlangan');
    return;
  }

  // Authorization: must be in match OR group admin OR global admin
  const inMatch = await isUserInMatch(matchId, dbUser.id);
  const groupAdmin = await isGroupAdmin(ctx, chatId, userId);
  const globalAdmin = isGlobalAdmin(userId);

  if (!inMatch && !groupAdmin && !globalAdmin) {
    await ctx.answerCallbackQuery('⛔ Faqat o\'yinchilar yoki adminlar boshlay oladi');
    return;
  }

  if (match.players.length < match.requiredPlayers) {
    await ctx.answerCallbackQuery(`⚠️ Kamida ${match.requiredPlayers} o\'yinchi kerak (hozir ${match.players.length})`);
    return;
  }

  // Team game: must have even count
  if (match.game.isTeamGame && match.players.length % 2 !== 0) {
    await ctx.answerCallbackQuery('⚠️ Jamoaviy o\'yin uchun juft sonli o\'yinchi kerak');
    return;
  }

  await ctx.answerCallbackQuery('🚀 O\'yin boshlanmoqda...');
  await doStartMatch(ctx, matchId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function doStartMatch(ctx: Context, matchId: string): Promise<void> {
  const match = await startMatch(matchId);

  // Update join panel to reflect started state
  try {
    if (match.messageId) {
      await ctx.api.editMessageText(
        Number(match.chatId),
        match.messageId,
        buildStartedPanel(match),
        { parse_mode: 'Markdown' },
      );
    }
  } catch { /* ignore */ }

  await notifyPlayersMatchStarted(match);
  await notifyGroupMatchStarted(match.chatId, match);
}

function buildJoinPanel(match: any): string {
  const playerList = match.players
    .map((p: any) => {
      const n = p.user.lastName ? `${p.user.firstName} ${p.user.lastName}` : p.user.firstName;
      return `  • ${n}`;
    })
    .join('\n');

  const lines = [
    `🎮 *${match.game.name}*`,
    `👥 O'yinchilar: ${match.players.length}/${match.maxPlayers}`,
  ];
  if (playerList) lines.push('', playerList);
  return lines.join('\n');
}

function buildJoinKeyboard(match: any): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('➕ Qo\'shilish', `match:join:${match.id}`);

  const canStart = match.players.length >= match.requiredPlayers;
  if (canStart) {
    kb.row().text('🚀 Boshlash', `match:start:${match.id}`);
  }

  return kb;
}

function buildStartedPanel(match: any): string {
  return [
    `🎮 *${match.game.name}*`,
    `✅ O'yin boshlandi!`,
    `👥 Ishtirokchilar: ${match.players.length}`,
  ].join('\n');
}
