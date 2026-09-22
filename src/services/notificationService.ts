import { Bot, InlineKeyboard } from 'grammy';
import { MatchWithPlayers } from './matchService';
import { getTeamLabel } from '../matchmaking/teamAssigner';
import { escapeMarkdownV1 } from '../utils/telegram';

let botInstance: Bot | null = null;
let cachedBotUsername: string | null = null;

// Changes once per server restart (i.e. once per deploy). Appended to every
// Web App URL below so Telegram's in-app WebView treats it as a brand new
// URL and can never silently serve a cached (stale) index.html from a
// previous deploy — the #1 cause of "the button doesn't show up" reports
// that turn out to be an old cached page, not an actual code bug.
const BUILD_ID = Date.now().toString(36);

export function setBotInstance(bot: Bot): void {
  botInstance = bot;
  cachedBotUsername = null; // reset cache when bot instance changes
}

function getBot(): Bot {
  if (!botInstance) throw new Error('Bot instance not initialized');
  return botInstance;
}

async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await getBot().api.getMe();
  cachedBotUsername = me.username ?? 'bot';
  return cachedBotUsername;
}

/**
 * Send a private message to each player with a Web App button to open the game.
 * Failures are silently ignored (player may not have started the bot yet).
 */
export async function notifyPlayersMatchStarted(match: MatchWithPlayers): Promise<void> {
  const bot = getBot();

  for (const player of match.players) {
    const webAppUrl = buildPlayerWebAppUrl(match, player.user.telegramId.toString());
    const teamLabel = match.game.isTeamGame ? `\n${getTeamLabel(player.team)}` : '';

    const kb = new InlineKeyboard().webApp('🎮 O\'yinni boshlash', webAppUrl);

    try {
      await bot.api.sendMessage(
        Number(player.user.telegramId),
        [
          `🎮 *${escapeMarkdownV1(match.game.name)}* o'yini boshlandi!`,
          teamLabel,
          '',
          'Quyidagi tugmani bosib o\'yinga kiring:',
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: kb },
      );
    } catch (err) {
      // Player may not have started the bot yet — this is expected and
      // common, so it's not logged as an error. It's still logged (not
      // silently swallowed) so a *systemic* delivery failure (e.g. bad
      // token, Telegram outage) is visible in the logs instead of just
      // looking like "some players never got their invite".
      console.warn(
        `[notify] Failed to DM player tgId=${player.user.telegramId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Send a group announcement that the match has started.
 * Includes a "Go to Bot" deep-link button so players can open their private chat.
 */
export async function notifyGroupMatchStarted(
  chatId: bigint,
  match: MatchWithPlayers,
): Promise<void> {
  const bot = getBot();
  const username = await getBotUsername();

  const playerList = match.players
    .map((p, i) => {
      const name = p.user.lastName
        ? `${p.user.firstName} ${p.user.lastName}`
        : p.user.firstName;
      const team = match.game.isTeamGame ? ` ${getTeamLabel(p.team)}` : '';
      return `${i + 1}. ${escapeMarkdownV1(name)}${team}`;
    })
    .join('\n');

  const kb = new InlineKeyboard().url('🤖 Botga o\'tish', `https://t.me/${username}`);

  await bot.api.sendMessage(
    Number(chatId),
    [
      `🚀 *${escapeMarkdownV1(match.game.name)}* o'yini boshlandi!`,
      '',
      '👥 Ishtirokchilar:',
      playerList,
      '',
      'Har bir o\'yinchiga private xabar yuborildi.',
      'Botga o\'tib "🎮 O\'yinni boshlash" tugmasini bosing.',
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: kb },
  );
}

/**
 * Builds the Web App URL for a specific player in a match.
 * Adds matchId and tgId as query parameters.
 */
function buildPlayerWebAppUrl(match: MatchWithPlayers, telegramId: string): string {
  // Use URL to safely append query params without breaking existing ones
  const url = new URL(match.game.webAppUrl);
  url.searchParams.set('matchId', match.id);
  url.searchParams.set('tgId', telegramId);
  url.searchParams.set('v', BUILD_ID);
  return url.toString();
}
