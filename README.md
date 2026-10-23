# Jardamchy prototype

*Jardamchy* (жардамчы) is Kyrgyz for "helper": an AI assistant that answers a small business's WhatsApp customers.

Clickable prototype of a WhatsApp Business bot for small businesses in Bishkek, built from
[`whatsapp-bot-prototype-spec.md`](whatsapp-bot-prototype-spec.md). WhatsApp connection, chat sync and sending are mocked.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # reply-lock and pause rules
```

By default the bot classifies and replies with keyword rules. To use an AI model, copy `.env.example` to `.env.local`:

| Provider | Settings | Default model |
|---|---|---|
| Gemini Flash Lite | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=...` | `gemini-3.1-flash-lite` |
| Claude | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...` (or `APP_ANTHROPIC_API_KEY`) | `claude-opus-5-5`; the tested choice is `claude-haiku-5-5` |

`LLM_MODEL` overrides the model (for example a pinned Gemini version).

With an AI key, the AI reads the imported chats to build the knowledge base and writes every bot message in the
customer's language; a guard blocks any message with a number that isn't a confirmed fact. If the AI can't be
reached, the bot sends nothing and the chat goes to a person. Without a key the app runs in demo mode (keyword rules
and fixed lines, labelled "fixed line"). Counts, pauses, handoffs and booking/order requests stay in code either way.

Everything is saved in Postgres. Without `DATABASE_URL` the app uses PGlite, Postgres running inside the server
process and stored in `./data/pg`, so there is nothing to install. Owners sign up with email and password; each owner
has one business and sees only their own data. **Settings → Reset prototype** deletes the business.

## Languages

The owner app is in **Russian** by default; **Kyrgyz** and English are one tap away (the switch in the top bar, or
Settings → App language). The choice is kept in a cookie, so it survives reloads. All app text is in `lib/i18n/`
(`en.ts` lists every key; `ru.ts` and `ky.ts` must have them all, with the same `{placeholders}` — `lib/i18n.test.ts`
checks this). Messages to customers are not translated by the app: the AI writes them in the customer's language.

## Knowledge base

Besides prices, hours, address and stock notes, the bot knows **other facts** (delivery, payment, returns, parking…)
and **item details** (material, colours, what's included). Customers can ask anything about the business: the
classifier labels it `info`, code picks the facts that match (all of them for small businesses, the best matches above
30), and the AI answers only from those. If the fact isn't there, the chat goes to a person, as before.

- **From past chats:** setup pulls facts and item details out of the imported chats, each linked to the message it came
  from and confirmed by the owner one question at a time. A fee like delivery is kept as a fact, not a price.
- **From staff answers:** when staff answer a question the bot couldn't (in the inbox or from the WhatsApp Business
  app), the AI proposes it as a fact. It shows under **Knowledge → Learned from your staff**; one tap adds it, and the
  bot answers that question itself next time. Replies like "сейчас уточню" or about one customer's order are skipped.
- **In the owner's words:** "доставка теперь 250 сом, принимаем Мбанк" in **Something wrong or missing?**, or edit by hand.

Code is in `lib/knowledge.ts` (picking facts, open questions) and `lib/learn.ts` (proposing facts from staff answers).

## Alerts to the owner

When a chat starts needing a person (a question the assistant can't answer, off-topic twice, a voice note, a new
booking or order, the AI unavailable), the owner gets a WhatsApp message on their personal number: who is waiting,
what they asked, and a link straight to the chat. The owner sets the number in **Settings → Alerts** and can send a
test. One alert per change, not one per message.

- Without a template, the alert is a plain WhatsApp message, which WhatsApp only delivers if the owner's number wrote
  to the sending number in the last 24 hours. Good for testing.
- For production, create a **Utility** template in Kapso (WhatsApp → Templates), e.g. named `needs_person`, Russian
  body `Клиент {{1}} ждёт ответа: «{{2}}». Ответить: {{3}}` (optionally a Kyrgyz version), and once Meta approves it
  set `ALERT_TEMPLATE=needs_person`. Templates are delivered at any time; each costs a small fee.
- `ALERT_PHONE_NUMBER_ID` sends alerts from one Jardamchy number instead of each business's own number.

Code: `lib/alerts.ts`, `app/api/alerts`, `components/AlertSettings.tsx`.

## Checks

Every pull request runs the type check, the tests and the build on GitHub (`.github/workflows/checks.yml`). Merge only
when it's green.

## Online: Vercel + Neon

1. **Neon** (neon.tech): create a project in **AWS Europe Central 1 (Frankfurt)** and copy the connection string.
2. **Vercel** (vercel.com): import this GitHub repository. Functions run in Frankfurt too (`vercel.json`).
3. In Vercel → Project → Settings → Environment Variables, add:
   `DATABASE_URL` (from Neon), `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-5-5`, `ANTHROPIC_API_KEY`,
   `KAPSO_API_KEY`. Then redeploy.
4. Open the site, create an account, set up the business, then **Settings → WhatsApp → Connect**. Online, this
   registers a Kapso webhook to `/api/kapso/webhook`; Kapso then pushes each message, signed, and the app answers
   within 10 seconds and replies in the background. Polling is only for local development.

After deploying, open `/api/health`: it shows whether the database, AI and WhatsApp are set up, without showing any key.
The tables are created on first use. On Vercel the app refuses to start without `DATABASE_URL`, because serverless
functions have no lasting disk.

## Keys

Never paste API keys into a chat, an issue, or the code. In a Claude Code cloud environment:

- **Kapso** and **Gemini**: add them as **network secrets** (environment settings → Network secrets), with no prefix:
  host `api.kapso.ai`, header `X-API-Key`; host `generativelanguage.googleapis.com`, header `x-goog-api-key`.
  The network adds the key to each request, so the code never sees it. Set `KAPSO_ENABLED=1`.
- **Claude**: network secrets are never applied to `api.anthropic.com`, so add `APP_ANTHROPIC_API_KEY` as an
  environment variable (a separate name from Claude Code's own key).
- Settings: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-5-5`.

Environment variables load when a session starts or wakes up after being idle; network secrets apply immediately.
Locally, put the same values in `.env.local` (git-ignored).

## Real WhatsApp through Kapso

Set up the Kapso key (a key for a separate Kapso project, see Keys above), start the app, then **Settings → WhatsApp → Connect** a
number: the sandbox for testing, or a WhatsApp Business app number. The server checks connected numbers for new
messages every 3 seconds (`lib/whatsapp/poller.ts`), answers through the same bot logic as the web app
(`lib/turn.ts`) once the business is live, and saves everything to the database. WhatsApp chats show in the inbox with
a WhatsApp badge; staff replies typed there and Confirm/Decline go out on WhatsApp (`lib/whatsapp/outbound.ts`).
Staff replies from the WhatsApp Business app pause the bot in that chat. Imported history and messages from before the
connection are never answered. All Kapso calls are in `lib/kapso.ts`.

Sandbox: in the Kapso dashboard, **WhatsApp → Sandbox → Add Test Number**, then send the 6-character code from that
phone. Sandbox replies use the project's Kapso credits. Behind an HTTPS proxy, Node 22.21+ needs `NODE_USE_ENV_PROXY=1`.
Production will receive Kapso webhooks instead of polling.

## Demo script

0. Open the app and **create an account** (email and password).
1. **Set up a business** → name → **Shop** → **I scanned it** → **Share 6 months**.
2. Answer the questions one by one: confirm a price (with the chat message it came from), pick the current price of
   the loafers (5200 newest vs 5000 older), confirm stock, hours and address. Check the summary, then
   **Approve and go live**. With an AI key, try «Something wrong or missing?» to change facts in your own words.
3. On **Live**, tap the scripted messages 1–5: greeting (count stays 0), price, size → `availability`,
   two off-topic messages → handoff, AI stops, chat shows **Needs a person**.
4. **6. Staff reply** pauses only the test chat. The next customer message gets no bot reply.
5. **Inbox**: other chats still get bot replies (use the "message from this customer" box).
   On the test chat, **Skip 30 min** ends the pause and the bot answers again.
6. Back on **Live**, tap the second row **a–d**: a price question, then «а 42 есть?» (memory), then
   «Хочу заказать» → «Какой размер нужен?» → «42». A request appears; confirm it under **Requests** and the bot
   tells the customer.

Pick **Café** in setup for the café fixture (lagman 250 сом). **Skip** sharing to go through the backup questions,
including the basic-facts screen.

## Layout

- `lib/rules.ts` — keyword classifier and replies from confirmed sheet facts, with conversation memory
- `lib/actions.ts` — booking/order details: what to collect, the questions, reading answers
- `lib/llm.ts` — AI classifier, replies and booking details via Gemini or Claude
- `lib/writer.ts` — the AI writes every bot message from its intent; `lib/guard.ts` checks each one before sending
- `lib/sheetBuilder.ts` — the AI drafts the knowledge sheet from imported chats
- `lib/knowledge.ts`, `lib/learn.ts` — other facts and item details: which ones answer a question, learning from staff
- `lib/sources.ts` — links every fact to the chat message behind it and finds older prices
- `lib/clarify.ts` — the one-by-one questions and how answers change the sheet
- `lib/edits.ts`, `lib/editRequest.ts` — change requests in the owner's words: AI proposes, code checks
- `lib/db.ts`, `lib/repo.ts`, `lib/auth.ts` — Postgres (or PGlite), loading and saving businesses and chats, owner accounts
- `app/api/business`, `app/api/chats/[id]/[action]`, `app/api/auth/*`, `app/api/whatsapp` — the server API the web app uses
- `app/api/turn` (stateless, used by `npm run eval`), `app/api/build-sheet`, `app/api/edit-sheet`
- `lib/kapso.ts` — the only file that talks to Kapso; `lib/whatsapp/` — checking for messages and sending replies
- `lib/turn.ts` — one customer message through the bot, shared by the web app and WhatsApp
- `lib/engine.ts` — off-topic count, handoff, human pause, badges (pure functions, tested in `lib/engine.test.ts`)
- `lib/fixtures.ts` — shoe shop and café sheets, 8 demo chats
- `app/` — login, wizard (`/setup`), review (`/review`), live + test box (`/live`), inbox, requests, settings
