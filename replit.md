# Telegram Game Platform

Universal multiplayer o'yin platformasi — bir Telegram Bot orqali ko'plab turli o'yinlarni boshqarish.

## Stack

- **Runtime:** Node.js 18+ / TypeScript
- **Telegram Bot:** grammY
- **Database:** PostgreSQL + Prisma ORM
- **API:** Express.js
- **Real-time:** Socket.IO
- **Deploy target:** Render

## Development (Replit)

Bu loyiha Replit'da development/test uchun ishlatiladi. Production Render'da joylashadi.

### Ishga tushirish

```bash
npm install
npm run db:generate
npm run db:migrate   # migration nomini so'rasa: init
npm run dev
```

### Kerakli secretlar

Replit Secrets (yoki `.env`) da quyidagilarni sozlang:

| Key | Tavsif |
|-----|--------|
| `BOT_TOKEN` | @BotFather dan olingan Telegram Bot Token |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Random uzun string |
| `ADMIN_TELEGRAM_IDS` | Admin Telegram ID'lari, vergul bilan |
| `WEBAPP_BASE_URL` | Mini App URL manzili |

### Bot buyruqlari

- `/start` — Foydalanuvchini ro'yxatdan o'tkazish
- `/guruh` — Guruhda o'yin tanlash (group chatda)
- `/yangi` — Yangi o'yin qo'shish (admin)

## User Preferences

- Kod toza, modulli va kengaytiriladigan bo'lsin
- Secretlar hech qachon source code'da bo'lmasin
- Arxitektura Replit'ga qattiq bog'lanib qolmasin (GitHub → Render pipeline)
- TypeScript strict mode
- Hamma muhim ma'lumotlar `.env.example` da ko'rsatilsin
