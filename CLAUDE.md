# Jardamchy

An AI WhatsApp assistant for small businesses in Kyrgyzstan. Next.js 16 (App Router), React 19, TypeScript,
Postgres (`pg` on Vercel/Neon, PGlite locally), Kapso for WhatsApp, Claude for the AI. See README.md for the product
and the setup.

## Commands

- `npm run typecheck`, `npm test` (Vitest), `npm run build` — run all three before pushing; CI runs the same.
- Local server: `npm run build && PORT=3300 npm start`. Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1`.
  Stop it with `pkill "^next-server"` — never `pkill -f "next start"` (it matches your own shell).

## Rules

- **Owner-facing text** lives only in `lib/i18n/{en,ru,ky}.ts`. `en.ts` is the key list; every key needs Russian
  (the default) and Kyrgyz, with the same `{placeholders}` (`lib/i18n.test.ts` checks). Server errors are English
  strings that match an `err_*` key, so they get translated.
- **Words owners never see:** "bot"/«бот» (say «ассистент», Kyrgyz «жардамчы»), the AI model's name, "Kapso".
  The connection guide doesn't mention Facebook (an owner decision; it may change after real tests).
- **Customers only get confirmed facts.** The guard (`lib/guard.ts`) blocks any number that isn't a confirmed fact.
  Facts the AI finds (from chats or staff replies) start as `needs_check` until the owner confirms them.
- **Never answer old messages:** messages marked `history_sync`, or older than the connection (`isLive`).
- **Kapso calls** go through `lib/kapso.ts` only. Each business only sees its own numbers (its Kapso customer) and
  the shared sandbox.
- **Database changes** are `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `lib/db.ts`, so existing databases upgrade.
- Next.js page files may only export the page (and its config); helpers go in `lib/`.
- Never put API keys or other secrets in code, commits, logs or chat.
