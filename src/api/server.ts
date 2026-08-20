import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import { config } from '../config';
import authRoutes from './routes/auth';
import gamesRoutes from './routes/games';
import matchesRoutes from './routes/matches';
import { validateTelegramInitData } from './middleware/validateInitData';
import { getMatchWithPlayers, MatchWithPlayers } from '../services/matchService';
import { findUserByTelegramId } from '../services/userService';
import { registerKatapultaHandlers } from '../game-servers/katapulta/socketHandlers';
import { setIoInstance } from '../services/realtimeService';

/**
 * Normalizes a configured origin for comparison against the browser's
 * `Origin` header (which never has a trailing slash or path). Without this,
 * a WEBAPP_BASE_URL env var set with a trailing slash (e.g.
 * "https://foo.onrender.com/" instead of "https://foo.onrender.com")
 * silently fails strict CORS origin matching — Socket.IO then rejects the
 * connection at the transport level, before our own auth/logging code ever
 * runs, which looks exactly like "the client is stuck on connecting, no
 * server logs at all".
 */
function normalizeOrigin(url: string): string {
  return url.replace(/\/+$/, '');
}

const ALLOWED_ORIGIN = normalizeOrigin(config.webApp.baseUrl || '*');

function isAllowedOrigin(origin: string | undefined): boolean {
  if (ALLOWED_ORIGIN === '*') return true;
  if (!origin) return true; // non-browser clients (curl, server-to-server) send no Origin
  return normalizeOrigin(origin) === ALLOWED_ORIGIN;
}

export function createServer(bot?: Bot): {
  app: Express;
  httpServer: http.Server;
  io: SocketIOServer;
} {
  const app = express();

  // Render (and most PaaS hosts) sit behind a reverse proxy that sets
  // X-Forwarded-For. Without this, Express treats every request as coming
  // from the proxy's internal address, which breaks express-rate-limit's
  // per-user IP detection (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) and causes
  // ALL users to share a single rate-limit bucket — eventually 429-blocking
  // static game assets and Socket.IO handshakes for everyone.
  // "1" = trust the first hop only (Render's own proxy), which is correct
  // and safe for this single-proxy deployment.
  app.set('trust proxy', 1);

  // ── Blanket request logger ──────────────────────────────────────────────
  // Logs EVERY inbound HTTP request before any other middleware touches it.
  // This is the ground truth for "did the request even reach the server":
  // if a mini app player reports a stuck screen and NOTHING shows up here
  // for their /games/... or /socket.io/... requests, the problem is on the
  // network/client side (blocked, wrong URL, DNS, etc.) — not in our code.
  // If entries DO show up here but nothing after, the problem is inside our
  // handling of that specific request.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
    next();
  });

  // ── Security middleware ────────────────────────────────────────────────────
  // Helmet's default Content-Security-Policy sets `script-src 'self'` with NO
  // 'unsafe-inline'. The katapulta mini app's entire game client is one
  // inline <script> block (no separate .js bundle) — under the default CSP
  // the browser silently REFUSES to execute it. No console error visible to
  // the player, no network request ever made, the page just sits frozen at
  // whatever static HTML was there before any JS ran (which is exactly the
  // "Ulanmoqda..." placeholder text baked into the HTML). This was the real
  // cause of "it's stuck on connecting and never even tries the socket".
  // We keep every other helmet default and only relax script-src (to allow
  // our inline script + the official Telegram Web App SDK from telegram.org).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'", 'https://telegram.org'],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      message: { ok: false, error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(express.json({ limit: '10kb' }));

  // ── Static Mini App files (e.g. /games/katapulta/index.html) ──────────────
  // Served straight from the repo's `public/games/` folder (resolved via
  // process.cwd(), so it works the same whether running `ts-node src/index.ts`
  // in dev or `node dist/index.js` in prod — both are launched from the repo
  // root). Not gated behind Telegram auth: Telegram opens this URL directly
  // in the client's browser/webview; real auth happens afterwards via the
  // Socket.IO handshake below.
  //
  // no-store: Telegram's in-app WebView (especially on Android) aggressively
  // caches Mini App pages across sessions. Without this, players can keep
  // seeing an OLD version of index.html for days after a new deploy — which
  // looks exactly like "nothing happens" bugs that don't actually exist in
  // the current code. Game assets change often during development, so we'd
  // rather take the tiny bandwidth hit than debug phantom stale-cache bugs.
  app.use(
    '/games',
    (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      next();
    },
    express.static(path.join(process.cwd(), 'public', 'games'), {
      etag: false,
      lastModified: false,
    }),
  );

  // ── Telegram Webhook endpoint ──────────────────────────────────────────────
  // Mounted only in production when a bot instance is provided.
  // Telegram posts updates to POST /webhook/<secret>
  if (bot && config.bot.webhookUrl) {
    const webhookPath = `/webhook/${config.bot.webhookSecret}`;
    app.post(
      webhookPath,
      webhookCallback(bot, 'express', {
        secretToken: config.bot.webhookSecret,
      }),
    );
    console.log(`📡 Webhook endpoint mounted at POST ${webhookPath}`);
  }

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  });

  // ── API routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/games', gamesRoutes);
  app.use('/api/matches', matchesRoutes);

  // ── 404 handler ────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  // ── HTTP + Socket.IO ───────────────────────────────────────────────────────
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ['GET', 'POST'],
    },
  });

  // Catches connection failures at the Engine.IO transport layer — BEFORE
  // our io.use() auth middleware even runs (e.g. CORS origin mismatch, bad
  // handshake request, transport negotiation failure). If a client is stuck
  // and NEITHER this nor "[Socket.IO] Rejected handshake" nor
  // "[Socket.IO] User X connected" ever appears for their attempt, the
  // request never reached this server process at all.
  io.engine.on('connection_error', (err) => {
    console.warn(
      `[Socket.IO] Engine-level connection_error: code=${err.code} message="${err.message}" ` +
        `context=${JSON.stringify(err.context ?? {})}`,
    );
  });

  // ── Socket.IO authentication middleware ────────────────────────────────────
  // Clients must send Telegram initData in the auth handshake:
  //   socket = io(url, { auth: { initData: "<raw initData string>", matchId: "<id>" } })
  io.use(async (socket, next) => {
    const { initData, matchId } = socket.handshake.auth as {
      initData?: string;
      matchId?: string;
    };

    if (!initData) {
      console.warn(`[Socket.IO] Rejected handshake (no initData) socket=${socket.id}`);
      return next(new Error('AUTH_MISSING: initData is required'));
    }

    const parsed = validateTelegramInitData(initData);
    if (!parsed || !parsed.user) {
      console.warn(`[Socket.IO] Rejected handshake (invalid initData) socket=${socket.id}`);
      return next(new Error('AUTH_INVALID: invalid or expired Telegram initData'));
    }

    if (!matchId) {
      console.warn(`[Socket.IO] Rejected handshake (no matchId) socket=${socket.id}`);
      return next(new Error('AUTH_MISSING: matchId is required'));
    }

    // Verify the user is a participant of the requested match
    const dbUser = await findUserByTelegramId(parsed.user.id).catch(() => null);
    if (!dbUser) {
      console.warn(`[Socket.IO] Rejected handshake (unregistered user) tgId=${parsed.user.id}`);
      return next(new Error('AUTH_UNREGISTERED: use /start in the bot first'));
    }

    const match: MatchWithPlayers | null = await getMatchWithPlayers(matchId).catch(() => null);
    if (!match) {
      console.warn(`[Socket.IO] Rejected handshake (match not found) matchId=${matchId}`);
      return next(new Error('AUTH_NOT_FOUND: match does not exist'));
    }

    const participant = match.players.some((p) => p.userId === dbUser.id);
    if (!participant) {
      console.warn(
        `[Socket.IO] Rejected handshake (not a participant) user=${dbUser.id} matchId=${matchId}`,
      );
      return next(new Error('AUTH_FORBIDDEN: you are not a participant of this match'));
    }

    // Attach verified identity to socket for use in event handlers
    socket.data.telegramId = parsed.user.id;
    socket.data.userId = dbUser.id;
    socket.data.matchId = matchId;
    socket.data.match = match;

    next();
  });

  // ── Socket.IO room management ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, matchId, match } = socket.data as {
      userId: string;
      matchId: string;
      match: MatchWithPlayers;
    };

    // Auto-join the authenticated match room
    socket.join(`match:${matchId}`);
    console.log(`[Socket.IO] User ${userId} connected to match:${matchId}`);

    // Broadcast game events only within the authenticated match room.
    // The matchId is taken from socket.data (server-authoritative),
    // NOT from the client payload, preventing room injection.
    socket.on('game:event', (data: { event: string; payload: unknown }) => {
      socket.to(`match:${matchId}`).emit('game:event', {
        fromUserId: userId,
        event: data.event,
        payload: data.payload,
      });
    });

    // ── Per-game wiring ───────────────────────────────────────────────────
    // Add new games here following the same pattern: a `game-servers/<slug>`
    // module exporting `register<Name>Handlers(io, socket, match)`.
    if (match.game.slug === 'katapulta') {
      registerKatapultaHandlers(io, socket, match);
    }

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] User ${userId} disconnected from match:${matchId}`);
    });
  });

  // Make the Socket.IO server reachable from outside this module (e.g. the
  // /bekor bot command needs to notify connected clients of a cancellation).
  setIoInstance(io);

  return { app, httpServer, io };
}
