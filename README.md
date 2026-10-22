# Kapso Desk prototype

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
| Claude | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...` | `claude-opus-5-5` |

`LLM_MODEL` overrides the model (for example a pinned Gemini version).

With an AI key, the AI reads the imported chats to build the knowledge sheet and writes every bot message in the
customer's language; a guard blocks any message with a number that isn't a confirmed fact. If the AI can't be
reached, the bot sends nothing and the chat goes to a person. Without a key the app runs in demo mode (keyword rules
and fixed lines, labelled "fixed line"). Counts, pauses, handoffs and booking/order requests stay in code either way.

State lives in the browser (localStorage). **Settings → Reset prototype** starts over.

## Real WhatsApp through Kapso (sandbox)

```bash
KAPSO_API_KEY=... LLM_PROVIDER=gemini GEMINI_API_KEY=... npm run kapso
```

The bridge (`scripts/kapso-bridge.mts`) checks the Kapso project's sandbox number for new messages every 3 seconds,
runs each one through the same bot logic as the web app (`lib/turn.ts`), and sends the replies. Staff replies sent
from the WhatsApp Business app pause the bot in that chat. State is kept in `data/kapso-bridge.json`; it answers
from the demo shoe shop facts until the web app saves a real sheet there. All Kapso calls are in `lib/kapso.ts`.

To test: in the Kapso dashboard, **WhatsApp → Sandbox → Add Test Number**, enter your phone number, then send the
6-character code to the sandbox number from that phone. Sandbox replies use the project's Kapso credits.

Behind an HTTPS proxy, Node 22.21+ needs `NODE_USE_ENV_PROXY=1`. Production will use Kapso webhooks instead of polling.

## Demo script

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
- `lib/sources.ts` — links every fact to the chat message behind it and finds older prices
- `lib/clarify.ts` — the one-by-one questions and how answers change the sheet
- `lib/edits.ts`, `lib/editRequest.ts` — change requests in the owner's words: AI proposes, code checks
- `app/api/turn`, `app/api/settle`, `app/api/build-sheet` — server routes for a customer message, a staff confirm/decline, and setup
- `lib/kapso.ts` — the only file that talks to Kapso; `lib/turn.ts` — one customer message through the bot, shared by the web app and the bridge
- `lib/engine.ts` — off-topic count, handoff, human pause, badges (pure functions, tested in `lib/engine.test.ts`)
- `lib/fixtures.ts` — shoe shop and café sheets, 8 demo chats
- `app/` — wizard (`/setup`), review (`/review`), live + test box (`/live`), inbox, settings
