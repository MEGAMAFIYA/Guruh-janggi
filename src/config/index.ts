import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  WEBHOOK_SECRET: z.string().default('webhook_secret'),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  WEBAPP_BASE_URL: z.string().default('https://example.com'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  bot: {
    token: env.BOT_TOKEN,
    webhookUrl: env.WEBHOOK_URL || null,
    webhookSecret: env.WEBHOOK_SECRET,
  },
  db: {
    url: env.DATABASE_URL,
  },
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    sessionSecret: env.SESSION_SECRET,
  },
  admin: {
    telegramIds: env.ADMIN_TELEGRAM_IDS
      ? env.ADMIN_TELEGRAM_IDS.split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .map(Number)
      : [],
  },
  webApp: {
    baseUrl: env.WEBAPP_BASE_URL,
  },
} as const;
