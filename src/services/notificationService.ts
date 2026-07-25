import { Bot, InlineKeyboard } from 'grammy';
import { MatchWithPlayers } from './matchService';
import { config } from '../config';
import { getTeamLabel } from '../matchmaking/teamAssigner';

let botInstance: Bot | null = null;

export function setBotInstance(bot: Bot): void {
  botInstance = bot;
}

function getBot(): Bot {
  if (!botInstance) throw new Error('Bot instance not initialized');
  return botInstance;
}

/**
 * Send private message to each player with a Web App button to open the game.
 */
export async function notifyPlayersMatchStarted(match: MatchWithPlayers): Promise<void> {
  const bot = getBot();

  for (const player of match.players) {
    const webAppUrl = buildPlayerWebAppUrl(match, player.user.telegramId.toString());
    const teamLabel = match.game.isTeamGame ? `\n${getTeamLabel(player.team)}` : '';

    const kb = new InlineKeyboard().webApp(
      '🎮 O\'yinni boshlash',
      webAppUrl,
    );

    try {
      await bot.api.sendMessage(Number(player.user.telegramId), [
        `🎮 *${match.game.name}* o'yini boshlandi!`,
        teamLabel,
        '',
        'Quyidagi tugmani bosib o\'yinga kiring:',
      ].join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
    } catch {
      // Player may not have started the bot — silently ignore
    }
  }
}

/**
 * Send group message announcing the match has started.
 */
export async function notifyGroupMatchStarted(
  chatId: bigint,
  match: MatchWithPlayers,
): Promise<void> {
  const bot = getBot();

  const playerList = match.players
    .map((p, i) => {
      const name = p.user.lastName
        ? `${p.user.firstName} ${p.user.lastName}`
        : p.user.firstName;
      const team = match.game.isTeamGame ? ` ${getTeamLabel(p.team)}` : '';
      return `${i + 1}. ${name}${team}`;
    })
    .join('\n');

  const kb = new InlineKeyboard().url(
    '🤖 Botga o\'tish',
    `https://t.me/${(await bot.api.getMe()).username}`,
  );

  await bot.api.sendMessage(Number(chatId), [
    `🚀 *${match.game.name}* o'yini boshlandi!`,
    '',
    '👥 Ishtirokchilar:',
    playerList,
    '',
    'Har bir o\'yinchiga private xabar yuborildi.',
    'Botga o\'tib "🎮 O\'yinni boshlash" tugmasini bosing.',
  ].join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

function buildPlayerWebAppUrl(match: MatchWithPlayers, telegramId: string): string {
  const base = match.game.webAppUrl;
  const url = new URL(base.includes('?') ? base : base);
  url.searchParams.set('matchId', match.id);
  url.searchParams.set('tgId', telegramId);
  return url.toString();
}
