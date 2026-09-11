# Railway deployment

This version is prepared for Railway.

## Required variables

Set these in Railway → Service → Variables:

- `NODE_ENV=production`
- `ADMIN_PASSWORD` — administrator password, at least 12 characters
- `SESSION_SECRET` — a long random secret

## Persistent database

Create a Railway Volume and mount it at:

`/data`

Then set:

`DATA_DIR=/data`

The application database and production sessions will be stored on the volume.

## Start command

Railway can detect the start command automatically from `package.json`:

`npm start`

which runs:

`node server.js`

## Telegram notifications and replies for candidate chat (1.8.2)

Add these Railway Variables to the site service:

- `TELEGRAM_BOT_TOKEN` — token of the existing Telegram bot. Keep it secret; do not put it in the repository.
- `TELEGRAM_ADMIN_CHAT_ID` — Telegram chat ID where notifications should arrive.
- `PUBLIC_SITE_URL` — public HTTPS URL of the site, for example `https://example.up.railway.app`. This adds an "Открыть админ-панель" button to notifications.

The site uses the Telegram Bot API only to send notifications. It does not start polling/getUpdates, so it will not conflict with an existing bot process that polls Telegram.


For two-way Telegram replies add to the website service:
- `TELEGRAM_CHAT_REPLY_SECRET` — a long random secret.

Add to the Telegram bot service:
- `SITE_CHAT_API_URL` — public HTTPS URL of the website
- `TELEGRAM_CHAT_REPLY_SECRET` — exactly the same secret

Reply to the candidate notification in Telegram; the bot sends that reply to the candidate website chat.


### Ответ кандидату из Telegram
В уведомлении Telegram появилась кнопка «↩️ Ответить». После нажатия бот попросит написать ответ, а затем отправит его в чат кандидата на сайте.
