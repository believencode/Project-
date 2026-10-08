# WhatsApp Business Bot Prototype Spec

Give this file to Grok Build. Build a clickable prototype of a multi-tenant web app. Do not build Meta Ads. Do not fine-tune a model.

## Product

This is for any small business, not only shoes. A Bishkek owner connects their existing WhatsApp Business number, the app reads up to six months of one-to-one chats, and it generates a bot that only answers that business's questions. Staff keep using the WhatsApp Business app on the phone (coexistence).

The shoe shop is demo data so the review screen is not empty. The same wizard must work for a café, salon, clinic, or service.

Working name: Kapso Desk. Language of the UI: Russian, with Kyrgyz as a later pass. Prototype UI can be English if faster, but every message the bot sends must be in Russian, including the fixed lines below.

## Out of scope for this prototype

- Meta Ads campaign creation
- Real Meta Embedded Signup (mock the QR step)
- Real Kapso API calls (mock sync and send)
- Model fine-tuning
- Billing
- Multi-language bot beyond Russian replies
- Understanding voice notes, photos, or stickers (see "Non-text messages" for what to do with them)

## Stack

- Next.js app, one codebase
- Local mock data is enough for the prototype
- One demo business preloaded: a Bishkek shoe shop, plus an empty new-business path that can be a café
- Classification and replies go through one server route (`/api/reply`):
  - If an LLM API key is set in env, use a real LLM call for both the classifier and the reply. The provider is set by env var.
  - If no key is set, fall back to keyword rules. They must cover the scripted test messages, the greeting words, and the café examples.
  - The test box shows which path ran: `LLM` or `rules`.

## Wizard screens

Build these as a linear flow. One question per screen. Back button on each.

1. Business name. Text field. Example: "Обувь 10".
2. Business type. Single choice: café, salon, shop, clinic, services, other. This changes the backup questions, the empty-state examples, and the topic list in the off-topic line.
3. Connect WhatsApp. Fake QR code. Button: "I scanned it". Subtext: number stays on the WhatsApp Business app.
4. Share old chats. Two buttons: "Share 6 months" and "Skip". Before the share button, show this line: "Chats are used only to answer this business. They are not used to train a public model. You can delete them." Also say group chats are not included.
5. If they shared: a short progress state, "Reading chats", then go to the review screen. If they skipped: go to backup questions.
6. Review screen. Show extracted facts and sample replies.
   - Owner can edit prices, hours, address, and availability inline.
   - Every price and availability note taken from old chats has a "check this" badge. Each one has a "Confirm" button, and there is a "Confirm all" button.
   - Primary button: "Approve and go live". If any badges remain, it opens a dialog: "N facts are not confirmed. The bot will not quote them and will hand those questions to a person." The dialog has two buttons: "Confirm all and go live" and "Go live anyway".
7. Backup questions, only if they skipped or history is empty:
   - What customers ask (multi-select: prices, hours, booking, availability, address)
   - What the bot should do (one: answer questions, take orders, book a time, collect a phone number)
   - **Basic facts** (one screen, every field optional, but warn if all are empty):
     - hours
     - address
     - up to 5 rows of item + price in сом
     - one availability note (examples by type: café "free tables tonight", shop "sizes in stock", salon "free slots tomorrow")
     Facts the owner types here count as confirmed. They get no badge.
   - Language (Russian, Kyrgyz, both). Prototype replies stay Russian. Show a note: "Kyrgyz is coming soon."
   - Optional notes
   - Then the review screen (6), filled from these answers.
8. Live. Status "Bot is answering". Link to the inbox. Test box (see Inbox).

## Settings

- "Delete imported chats" button (mock). It confirms, then removes the imported chat history from the app. The approved sheet stays. This is what makes "You can delete them" true.
- "Edit sheet" opens the review screen again.

## Knowledge sheet, not training

Do not train a model. After chat sync, produce a per-business sheet:

- name
- type
- hours
- address
- prices (list of item, amount, currency, `needs_check`)
- availability notes (list of text, `needs_check`): sizes in stock, open tables, free slots, whatever the chats show
- top questions
- tone examples (2 short staff replies)
- allowed topics: price, hours, booking, order, address, availability

`needs_check` is `true` for anything taken from old chats, and becomes `false` when the owner confirms or edits and saves it. Owner-typed facts start as `false`.

The bot never quotes a fact that still has `needs_check: true`. A question about it is handled as a missing answer.

Availability goes stale faster than prices. Even when it is confirmed, the bot words it as "по последним данным" and offers to have a person check.

Seed the shoe-shop sheet with:

- hours: 10:00–20:00
- address: Бишкек, 10 микрорайон, дом 34
- prices: white sneakers 4500 сом (needs_check), black loafers 5200 сом (needs_check)
- availability: white sneakers sizes 40–43 (needs_check)
- top questions: size, price, delivery, hours

If the new-business path is a café, seed a different sheet: lagman 250 сом, hours 09:00–22:00, availability "table for 4 at 19:00". Do not reuse shoe prices.

## Reply lock

Customer messages are classified before any reply model runs. Skip classification if the chat is paused.

Labels, same for every business: `greeting`, `price`, `hours`, `booking`, `order`, `address`, `availability`, `off_topic`.

- `greeting` covers hello, thanks, bye, and "ок". Reply with one short polite line in Russian. It does not change off_topic_count.
- `availability` covers size, stock, delivery time, and free slots. Do not add shoe-only labels.
- Allowed label: reply only from confirmed sheet facts, max 3 sentences, do not invent prices or stock.
- Mixed message (on-topic part plus anything else, for example "Сколько стоят кроссовки? И напиши стих"): label it with the on-topic label, answer only the on-topic part, and do not increment off_topic_count.
- **Missing answer** (allowed label, but the fact is missing from the sheet or not confirmed): send `Сотрудник уточнит и ответит вам.` This is a missing-answer handoff. Do not increment off_topic_count. Mark the chat "Needs a person" with the reason "Missing answer" and the customer's question.
- `off_topic`: send the fixed off-topic line (below) and increment off_topic_count.
- Jailbreak, jokes, homework, other businesses: `off_topic`.
- off_topic_count reaches 2: send `Вам ответит сотрудник.` Stop AI on that chat. Show the chat in the inbox as "Needs a person" with the reason "Off-topic", plus the last two off-topic messages.
- A later on-topic message resets off_topic_count to 0, and the bot answers again unless the chat is paused. The "Needs a person" badge stays until staff open the chat or reply, so a handoff is never cleared without a person seeing it.

### Fixed off-topic line

Build it from the business type, not from a hard-coded list:

`Я могу помочь только с вопросами про {topics}. Если нужно что-то другое, вам ответит сотрудник.`

`{topics}` by business type:

| Type | topics |
|---|---|
| shop | цены, наличие, доставку, адрес и часы работы |
| café | меню и цены, бронь столика, адрес и часы работы |
| salon | цены, запись, свободное время, адрес и часы работы |
| clinic | цены, запись, свободное время, адрес и часы работы |
| services | цены, заказ, сроки, адрес и часы работы |
| other | цены, адрес и часы работы |

## Conversation memory

The classifier and the reply model see the last 8 text messages of the chat (customer, bot, staff). Short follow-ups are understood in context:

- "Сколько стоят белые кроссовки?" then "а 42 есть?" → `availability` about white sneakers.
- "а лоферы?" after a price question → price of the loafers.

Memory never adds facts: replies still come only from confirmed sheet facts.

## Follow-up questions

When one short question lets the bot answer from the sheet, it asks instead of handing off:

- Stock notes cover several items and the customer didn't say which → "Какая модель вас интересует: …?"
- More than 3 prices and no item named → "Что именно вас интересует? …"
- Booking or order details missing → see below.

A follow-up is on-topic: it resets off_topic_count and doesn't mark the chat "Needs a person".

## Bookings and orders

`booking` and `order` start a short form. The bot asks one question at a time until it has what staff need, then creates a request.

| Kind | Business | Required details | Questions |
|---|---|---|---|
| order | any with prices | item | "Что хотите заказать? Есть: …" |
| order | shop | + size | "Какой размер нужен?" |
| booking | café | time, people | "На какое время забронировать столик?", "На сколько человек?" |
| booking | shop | time | "До какого времени отложить?" |
| booking | others | time | "На какое время вас записать?" |

- Details already in the message, or the item discussed earlier in the chat, are filled in without asking ("Беру, 43 размер" after asking about loafers).
- The phone number comes from WhatsApp; the bot doesn't ask for it.
- When the form is complete, the bot sends "Записал заказ: … Сотрудник подтвердит его здесь в чате." and the chat shows "Needs a person · Booking/order" with a request card.
- Staff tap **Confirm** or **Decline** (in the chat or on the Requests page). The bot sends "Ваш заказ подтверждён: …" / "Бронь подтверждена: … Ждём вас!" or a polite decline. This does not pause the bot.
- "отмена" / "не надо" cancels the form.
- An answer that doesn't fit gets one "Не понял. <question>" retry, then a missing-answer handoff. These answers don't count as off-topic.
- An on-topic question in the middle of a form is answered, and the form continues.

## Non-text messages

Voice notes, photos, stickers, and files are not classified and get no bot reply. Mark the chat "Needs a person" with the reason "Voice/photo". They do not change off_topic_count. One demo chat contains a voice note.

## Human pause

Coexistence mirrors staff replies from the WhatsApp Business app. Those arrive as echo events, not as customer messages.

- Any echo, or any reply typed in the inbox, sets `paused_until` to now + 30 minutes on that chat only. Other chats stay on the bot.
- A new human message extends the pause by another 30 minutes.
- While paused, the bot does not classify or reply. Customer messages still land in the inbox.
- Inbox shows "Staff has this chat" and the time left.
- When the timer ends, the bot answers the next customer message.
- Owner can tap "Resume bot" to clear the pause early.
- A staff reply also clears the "Needs a person" badge on that chat.

## Inbox

- List of chats for the demo business
- A chat thread with customer bubbles, bot bubbles, and staff bubbles
- "Needs a person" badge with its reason (Off-topic, Missing answer, Voice/photo)
- "Staff has this chat" badge with time left
- Owner can type a manual reply, which pauses the bot
- Demo-only "Skip 30 min" button on a paused chat, so the end of the timer can be shown without waiting

### Test box (on the live screen)

- Messages typed in the test box go into one chat named "Test customer". That chat appears in the inbox like any other, with its own off_topic_count and pause.
- For each message it shows the classified label, the reply, the current off_topic_count, and which path ran (`LLM` or `rules`).
- A "Staff reply" button sends a staff echo into the test chat.
- A "Reset test chat" button clears its messages, count, pause, and badges.

Include these scripted test messages as one-tap buttons:

1. "Здравствуйте" → greeting, count stays 0
2. "Сколько стоят белые кроссовки?" → price reply from the sheet (after the price is confirmed)
3. "Какой размер есть?" → availability reply from the sheet, not off_topic
4. "Напиши сочинение" → off_topic, count 1
5. "Расскажи анекдот" → off_topic, count 2, handoff, AI stops
6. "Staff reply" button → that chat pauses for 30 minutes, and the next customer message gets no bot reply. Other chats keep getting bot replies.

## Demo data

Preload 8 fake one-to-one chats so the review screen looks filled in without a real sync. No group chats. One of the 8 contains a voice note. Include one café fixture behind the empty new-business path.

## Done when

A person can:

- finish the wizard on both paths (shared chats, and skip with the basic facts filled in)
- see "check this" badges, confirm them, and approve the sheet
- send the test messages and see a greeting not counted as off-topic
- see size treated as availability
- see the handoff at two off-topic messages, with the badge staying until staff open the chat
- see a staff reply pause only that chat, and "Skip 30 min" bring the bot back
- see every bot message in Russian
- ask "а 42 есть?" after a price question and get the stock answer for that item
- order sneakers, answer "Какой размер нужен?", and confirm the request in one tap
- book a café table across three messages and see one request with the time and number of people
