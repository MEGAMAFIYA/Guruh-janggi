import { Router, Request, Response } from 'express';
import { requireTelegramAuth } from '../middleware/validateInitData';
import { upsertUser } from '../../services/userService';

const router = Router();

/**
 * POST /api/auth/telegram
 * Validates Telegram initData and upserts user.
 * Returns user record.
 */
router.post('/telegram', requireTelegramAuth, async (req: Request, res: Response) => {
  try {
    const tgUser = (req as any).telegramUser;
    const user = await upsertUser({
      id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
      last_name: tgUser.last_name,
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Returns current user info from validated initData.
 */
router.get('/me', requireTelegramAuth, async (req: Request, res: Response) => {
  try {
    const tgUser = (req as any).telegramUser;
    const user = await upsertUser({
      id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
      last_name: tgUser.last_name,
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
