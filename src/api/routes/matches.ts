import { Router, Request, Response } from 'express';
import { requireTelegramAuth } from '../middleware/validateInitData';
import {
  getMatchWithPlayers,
  isUserInMatch,
} from '../../services/matchService';
import { findUserByTelegramId } from '../../services/userService';
import { getTeamLabel } from '../../matchmaking/teamAssigner';

const router = Router();

/**
 * GET /api/matches/:id
 * Returns match info. Requires Telegram auth.
 * Only players in the match can access their match data.
 */
router.get('/:id', requireTelegramAuth, async (req: Request, res: Response) => {
  try {
    const tgUser = (req as any).telegramUser;
    const match = await getMatchWithPlayers(req.params.id);

    if (!match) {
      res.status(404).json({ ok: false, error: 'Match not found' });
      return;
    }

    // Find the requesting user
    const dbUser = await findUserByTelegramId(tgUser.id);
    if (!dbUser) {
      res.status(401).json({ ok: false, error: 'User not registered. Use /start first.' });
      return;
    }

    // Authorization: only match participants
    const inMatch = await isUserInMatch(match.id, dbUser.id);
    if (!inMatch) {
      res.status(403).json({ ok: false, error: 'You are not a participant of this match' });
      return;
    }

    // Find requester's team
    const selfPlayer = match.players.find((p) => p.userId === dbUser.id);

    res.json({
      ok: true,
      match: {
        id: match.id,
        status: match.status,
        game: {
          id: match.game.id,
          name: match.game.name,
          webAppUrl: match.game.webAppUrl,
          isTeamGame: match.game.isTeamGame,
        },
        players: match.players.map((p) => ({
          userId: p.userId,
          telegramId: p.user.telegramId.toString(),
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          username: p.user.username,
          team: p.team,
          teamLabel: getTeamLabel(p.team),
        })),
        myTeam: selfPlayer?.team ?? null,
        myTeamLabel: getTeamLabel(selfPlayer?.team ?? null),
        startedAt: match.startedAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
