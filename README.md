# Familienorga

A shared family organizer PWA — shopping lists, to-dos, notes & reminders with real-time sync.

## Features

- **Shopping Lists** — Multiple lists with emoji icons, real-time sync between devices
- **To-Dos / Tasks** — Assign tasks to family members with due dates
- **Notes** — Quick notes with auto-save and pin functionality
- **Wishlists** — Track wishes and gift ideas with member assignments
- **Reminders** — Push notifications for upcoming tasks and events
- **Member Management** — Add family members with auto-assigned colors
- **Multi-Family** — Each family creates their own household with a unique share code
- **PWA** — Installable on iOS & Android, works offline

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework
- **Backend:** Cloudflare Pages Functions (serverless)
- **Database:** Cloudflare D1 (SQLite at the edge)
- **Sync:** Polling every 3 seconds with ETag-based caching
- **Push:** Web Push API with VAPID authentication

## Setup

1. Clone this repo
2. Copy `wrangler.toml.example` to `wrangler.toml` and fill in your values
3. Create a D1 database: `npx wrangler d1 create einkaufsliste`
4. Apply the schema: `npx wrangler d1 execute einkaufsliste --file=schema.sql`
5. Generate VAPID keys: `npx web-push generate-vapid-keys`
6. Run locally: `npx wrangler pages dev public/`
7. Deploy: `npx wrangler pages deploy public/`

## How It Works

1. One person creates a household → gets a 6-digit share code
2. Other family members join with the code → everyone sees the same lists
3. Add items, check them off, assign tasks — changes sync in real-time
4. Install as PWA on your phone for the full app experience

## License

MIT
