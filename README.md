# 🎮 Telegram Game Platform

Universal multiplayer o'yin platformasi — bir Telegram Bot orqali ko'plab turli o'yinlarni boshqarish.

## Texnologiyalar

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ / TypeScript |
| Telegram Bot | [grammY](https://grammy.dev) |
| Database | PostgreSQL + Prisma ORM |
| API | Express.js |
| Real-time | Socket.IO |
| Validation | Zod |
| Deploy | Render |

---

## Tezkor ishga tushirish (Replit / Local)

### 1. Repozitoriyani clone qiling

```bash
git clone https://github.com/YOUR_USERNAME/telegram-game-platform.git
cd telegram-game-platform
```

### 2. Muhit o'zgaruvchilarini sozlang

```bash
cp .env.example .env
```

`.env` faylini oching va quyidagi qiymatlarni to'ldiring:

```env
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://user:password@localhost:5432/gameplatform
SESSION_SECRET=some_random_long_string
ADMIN_TELEGRAM_IDS=123456789
WEBAPP_BASE_URL=https://your-miniapp-domain.com
```

> **Eslatma:** `BOT_TOKEN`ni [@BotFather](https://t.me/BotFather) dan oling.

### 3. Bog'liqliklarni o'rnating

```bash
npm install
```

### 4. Prisma client yarating

```bash
npm run db:generate
```

### 5. Ma'lumotlar bazasini migrate qiling

```bash
npm run db:migrate
```

> Migration nomi so'ralganda: `init` deb kiriting.

### 6. Ishga tushiring (development)

```bash
npm run dev
```

Bot long-polling rejimida ishga tushadi (webhook shart emas).

---

## PostgreSQL ulash

### Local (macOS/Linux)

```bash
# PostgreSQL o'rnatish (macOS)
brew install postgresql@15
brew services start postgresql@15

# Database yaratish
createdb gameplatform

# DATABASE_URL
DATABASE_URL=postgresql://$(whoami)@localhost:5432/gameplatform
```

### Replit
Replit PostgreSQL integratsiyasini ulang va `DATABASE_URL` secret sifatida qo'shing.

### Render (production)
`render.yaml` orqali database avtomatik yaratiladi va `DATABASE_URL` environment variable sifatida beriladi.

---

## Telegram Bot Token sozlash

1. Telegram'da [@BotFather](https://t.me/BotFather) ni oching
2. `/newbot` buyrug'ini yuboring
3. Bot nomini va username'ni kiriting
4. Olingan tokenni `.env` → `BOT_TOKEN` ga qo'ying

### Bot sozlamalari (BotFather)

BotFather'da quyidagilarni sozlang:

**1. Buyruqlarni ro'yxatdan o'tkazing:**
```
/setcommands
start - Botni ishga tushirish
guruh - Guruhda o'yin tanlash
yangi - Yangi o'yin qo'shish (admin)
bekor - Joriy jarayonni bekor qilish
```

**2. ⚠️ MUHIM: Guruh Privacy Mode ni o'chiring**

By default Telegram bots in groups only receive **commands** (messages starting with `/`), not plain text messages. The `/yangi` game creation wizard requires plain text input (game name, Web App URL) from the user. **If Privacy Mode is enabled, those text input steps will be silently ignored in group chats.**

To disable Privacy Mode in BotFather:
```
1. Open @BotFather in Telegram
2. Send /mybots
3. Select your bot
4. Tap "Bot Settings"
5. Tap "Group Privacy"
6. Tap "Turn off"
7. Confirm — BotFather should reply "Privacy mode is disabled"
```

> **Note:** Privacy Mode does NOT affect private (DM) chats. Global admins can always run `/yangi` in a private chat with the bot, regardless of Privacy Mode. Only group usage of `/yangi` requires Privacy Mode to be disabled.
>
> Commands `/start` and `/guruh` work correctly with Privacy Mode **enabled** (commands always reach the bot).

---

## ADMIN_TELEGRAM_IDS sozlash

Global bot adminlarining Telegram ID'larini vergul bilan ajrating:

```env
ADMIN_TELEGRAM_IDS=123456789,987654321
```

Telegram ID'ingizni [@userinfobot](https://t.me/userinfobot) orqali bilishingiz mumkin.

---

## Render Environment Variables (ishga tushirishdan oldin sozlang)

`render.yaml` da quyidagi o'zgaruvchilar `sync: false` bilan belgilangan — ya'ni ularni **Render Dashboard → Environment** bo'limida qo'lda kiritishingiz kerak:

| Variable | Tavsif | Misol |
|---|---|---|
| `BOT_TOKEN` | @BotFather dan olingan bot token | `123456:ABCdef...` |
| `ADMIN_TELEGRAM_IDS` | Global adminlarning Telegram ID'lari (vergul bilan) | `123456789` |
| `WEBHOOK_URL` | Render servisingizning HTTPS manzili | `https://your-app.onrender.com` |
| `WEBAPP_BASE_URL` | Mini App'lar joylashgan domen (CORS uchun) | `https://your-miniapp.example.com` |

> **`WEBHOOK_URL` qanday topiladi:**
> 1. Birinchi deploy'dan keyin Render Dashboard'dagi servis sahifasiga kiring.
> 2. Yuqoridagi URL'ni ko'chiring (masalan `https://telegram-game-platform.onrender.com`).
> 3. Shu URL'ni `WEBHOOK_URL` sifatida environment variable'ga kiriting.
> 4. Servisni qayta deploy qiling — bot webhook'ni avtomatik ro'yxatdan o'tkazadi.

> **Webhook tekshirish:** Botga xabar yuboring va Render Dashboard loglarida
> `[Bot] update=... type=private ...` ko'ring. Ko'rinmasa — WEBHOOK_URL noto'g'ri yoki
> bot restart kerak.

---

## Prisma migration

### Development

```bash
# Yangi migration yaratish
npm run db:migrate

# Prisma Studio (vizual DB editor)
npm run db:studio
```

### Production

```bash
npm run db:migrate:prod
```

> `render.yaml`da bu buyruq startCommand ichida avtomatik ishga tushadi.

---

## GitHub'ga push qilish

```bash
git init
git add .
git commit -m "feat: initial telegram game platform"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/telegram-game-platform.git
git push -u origin main
```

---

## Render'ga deploy qilish

### 1. Render account

[render.com](https://render.com) da account yarating.

### 2. New Blueprint

- Render dashboard → **New** → **Blueprint**
- GitHub reponi tanlang
- `render.yaml` fayli avtomatik aniqlanadi
- Service va database yaratiladi

### 3. Environment variables

Render dashboard → Service → **Environment** bo'limida quyidagilarni qo'ying:
- `BOT_TOKEN` — Telegram bot token
- `WEBHOOK_URL` — `https://your-service-name.onrender.com` (birinchi deploydan keyin)
- `ADMIN_TELEGRAM_IDS` — admin Telegram ID'lari
- `WEBAPP_BASE_URL` — Mini App URL manzili

### 4. Birinchi deploy

`render.yaml` bilan deploy qilganda:
1. Database avtomatik yaratiladi
2. `npm install && prisma generate && tsc` ishga tushadi
3. `prisma migrate deploy && node dist/index.js` boshlanadi

---

## Telegram Webhook sozlash (production)

### Avtomatik (tavsiya etiladi)

`WEBHOOK_URL` environment variable'ini to'ldirsangiz, bot webhook'ni avtomatik ro'yxatdan o'tkazadi.

```env
WEBHOOK_URL=https://your-service-name.onrender.com
```

### Qo'lda

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-service-name.onrender.com/webhook/<WEBHOOK_SECRET>"}'
```

### Webhook'ni tekshirish

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

---

## API Endpointlar

### Autentifikatsiya
```
POST /api/auth/telegram    — initData validatsiya + user upsert
GET  /api/auth/me          — joriy foydalanuvchi ma'lumotlari
```

**Authorization header:**
```
Authorization: tma <initData>
```

### O'yinlar
```
GET /api/games             — Faol o'yinlar ro'yxati (ochiq)
GET /api/games/:id         — O'yin ma'lumotlari
```

### Matchlar
```
GET /api/matches/:id       — Match ma'lumotlari (faqat ishtirokchilar)
```

### Health
```
GET /health               — Server holati
```

---

## Socket.IO Events

```js
// Matchga qo'shilish
socket.emit('join:match', matchId);

// Matchdan chiqish
socket.emit('leave:match', matchId);

// O'yin eventi yuborish
socket.emit('game:event', { matchId, event: 'move', payload: { x: 1, y: 2 } });

// O'yin eventini qabul qilish
socket.on('game:event', ({ from, event, payload }) => { ... });
```

---

## Bot Buyruqlari

| Buyruq | Tavsif | Foydalanuvchi |
|---|---|---|
| `/start` | Botni ishga tushirish, ro'yxatdan o'tish | Har kim |
| `/guruh` | Faol o'yinlar ro'yxati | Guruh a'zolari |
| `/yangi` | Yangi o'yin qo'shish (multi-step) | Adminlar |
| `/bekor` | Joriy dialog'ni bekor qilish | Admin (dialog ichida) |

---

## Loyiha Strukturasi

```
telegram-game-platform/
├── src/
│   ├── api/
│   │   ├── middleware/
│   │   │   └── validateInitData.ts   # Telegram Web App auth
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── games.ts
│   │   │   └── matches.ts
│   │   └── server.ts                 # Express + Socket.IO
│   ├── bot/
│   │   ├── commands/
│   │   │   ├── start.ts              # /start
│   │   │   ├── guruh.ts              # /guruh
│   │   │   └── yangi.ts              # /yangi (multi-step)
│   │   ├── handlers/
│   │   │   └── callbackQuery.ts      # Inline keyboard handler
│   │   ├── middleware/
│   │   │   ├── adminCheck.ts
│   │   │   └── userSync.ts
│   │   └── bot.ts
│   ├── config/
│   │   └── index.ts                  # Env validation (Zod)
│   ├── database/
│   │   └── prisma.ts
│   ├── matchmaking/
│   │   └── teamAssigner.ts
│   ├── services/
│   │   ├── gameService.ts
│   │   ├── matchService.ts
│   │   ├── notificationService.ts
│   │   └── userService.ts
│   ├── utils/
│   │   ├── telegram.ts
│   │   └── validation.ts
│   └── index.ts                      # Entry point
├── prisma/
│   └── schema.prisma
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
├── tsconfig.json
└── README.md
```

---

## Xavfsizlik

- **Telegram initData validation** — HMAC-SHA256 orqali har bir Mini App so'rovi tekshiriladi
- **Admin verification** — `/yangi` uchun guruh admini yoki global admin tekshiruvi
- **Match authorization** — faqat match ishtirokchilari o'z match ma'lumotlarini ko'ra oladi
- **Rate limiting** — 100 req/15min per IP
- **Input validation** — Zod schema validation
- **Prisma ORM** — SQL injection'dan himoya
- **Helmet.js** — HTTP security headers
- **Secrets** — barcha maxfiy ma'lumotlar `.env` orqali, source code'da yo'q

---

## Litsenziya

MIT
