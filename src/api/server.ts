import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import { config } from '../config';
import authRoutes from './routes/auth';
import gamesRoutes from './routes/games';
import matchesRoutes from './routes/matches';
import { validateTelegramInitData } from './middleware/validateInitData';
import { isUserInMatch } from '../services/matchService';
import { findUserByTelegramId } from '../services/userService';

export function createServer(bot?: Bot): {
  app: Express;
  httpServer: http.Server;
  io: SocketIOServer;
} {
  const app = express();

  // ── Security middleware ────────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: config.webApp.baseUrl || '*',
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
      origin: config.webApp.baseUrl || '*',
      methods: ['GET', 'POST'],
    },
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
      return next(new Error('AUTH_MISSING: initData is required'));
    }

    const parsed = validateTelegramInitData(initData);
    if (!parsed || !parsed.user) {
      return next(new Error('AUTH_INVALID: invalid or expired Telegram initData'));
    }

    if (!matchId) {
      return next(new Error('AUTH_MISSING: matchId is required'));
    }

    // Verify the user is a participant of the requested match
    const dbUser = await findUserByTelegramId(parsed.user.id).catch(() => null);
    if (!dbUser) {
      return next(new Error('AUTH_UNREGISTERED: use /start in the bot first'));
    }

    const participant = await isUserInMatch(matchId, dbUser.id).catch(() => false);
    if (!participant) {
      return next(new Error('AUTH_FORBIDDEN: you are not a participant of this match'));
    }

    // Attach verified identity to socket for use in event handlers
    socket.data.telegramId = parsed.user.id;
    socket.data.userId = dbUser.id;
    socket.data.matchId = matchId;

    next();
  });

  // ── Socket.IO room management ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, matchId } = socket.data as {
      userId: string;
      matchId: string;
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

    socket.on('disconnect', () => {
      console.log(`[Socket.IO] User ${userId} disconnected from match:${matchId}`);
    });
  });

  return { app, httpServer, io };
}
