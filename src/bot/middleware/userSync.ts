import { Context, NextFunction } from 'grammy';
import { upsertUser } from '../../services/userService';

/**
 * Middleware: syncs Telegram user to the database on every update.
 * Attaches the DB user record to ctx.state for downstream handlers.
 */
export async function userSyncMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (from && !from.is_bot) {
    try {
      const dbUser = await upsertUser({
        id: from.id,
        username: from.username,
        first_name: from.first_name,
        last_name: from.last_name,
      });
      // Attach to context for downstream use
      (ctx as any).dbUser = dbUser;
    } catch (err) {
      console.error('[userSync] Failed to upsert user:', err);
    }
  }
  await next();
}
