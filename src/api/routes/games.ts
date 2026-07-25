import { Router, Request, Response } from 'express';
import { listActiveGames, findGameById } from '../../services/gameService';

const router = Router();

/**
 * GET /api/games
 * Returns list of active games (public endpoint).
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const games = await listActiveGames();
    res.json({
      ok: true,
      games: games.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        webAppUrl: g.webAppUrl,
        isTeamGame: g.isTeamGame,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/games/:id
 * Returns a single game by ID.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const game = await findGameById(req.params.id);
    if (!game || !game.isActive) {
      res.status(404).json({ ok: false, error: 'Game not found' });
      return;
    }
    res.json({ ok: true, game });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
