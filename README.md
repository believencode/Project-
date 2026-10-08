# Kapso Desk prototype

Clickable prototype of a WhatsApp Business bot for small businesses in Bishkek, built from
[`whatsapp-bot-prototype-spec.md`](whatsapp-bot-prototype-spec.md). WhatsApp connection, chat sync and sending are mocked.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # reply-lock and pause rules
```

By default the bot classifies and replies with keyword rules. To use Claude instead, copy `.env.example` to
`.env.local` and set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. The test box shows which path ran
(`LLM` or `rules`). If the LLM call fails, the route falls back to rules.

State lives in the browser (localStorage). **Settings → Reset prototype** starts over.

## Demo script

1. **Set up a business** → name → **Shop** → **I scanned it** → **Share 6 months**.
2. Review: prices and availability show **check this**. **Approve and go live** → **Confirm all and go live**.
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
- `lib/llm.ts` — optional Claude classifier and reply (`/api/reply`)
- `lib/engine.ts` — off-topic count, handoff, human pause, badges (pure functions, tested in `lib/engine.test.ts`)
- `lib/fixtures.ts` — shoe shop and café sheets, 8 demo chats
- `app/` — wizard (`/setup`), review (`/review`), live + test box (`/live`), inbox, settings
