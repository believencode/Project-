import type { Chat, FactSuggestion } from "./types";
import type { Db } from "./db";
import { jsonCall, llmEnabled } from "./llm";
import { numbersIn } from "./guard";
import { unansweredQuestion } from "./knowledge";
import { loadChat, saveChat } from "./repo";
import { withLock } from "./locks";

/**
 * Server only. When staff answer a question the bot couldn't, propose that
 * answer as a fact for the knowledge base. The owner adds it in one tap, and
 * next time the bot answers the same question itself.
 */

const SYSTEM = `A customer asked a small business a question its WhatsApp bot couldn't answer, and staff replied.
Decide whether the staff reply holds a general fact about the business that would answer the same question for any customer: delivery, payment, returns, warranty, parking, what a product or service includes, rules.
- useful: false if the reply is only a greeting or "I'll check", is about this one customer or order (their order status, a personal discount), or doesn't answer the question.
- topic: 1–3 words in Russian, e.g. "Доставка", "Оплата".
- text: the fact in one or two short sentences in Russian, about the business ("Доставка по Бишкеку — 200 сом."), using only what staff wrote. Copy every number exactly.`;

export async function suggestFact(chat: Chat, now: number): Promise<Chat> {
  const open = unansweredQuestion(chat, now);
  if (!open) return chat;
  const existing = chat.fact_suggestions?.find((s) => s.id === open.id);
  // The owner already decided on this one.
  if (existing?.status) return chat;
  const answer = open.answers.join("\n");

  let topic = "";
  let text = answer;
  if (llmEnabled()) {
    const out = await jsonCall<{ useful: boolean; topic: string; text: string }>(
      SYSTEM,
      `<customer_question>${open.question}</customer_question>\n<staff_reply>${answer}</staff_reply>`,
      {
        type: "object",
        properties: { useful: { type: "boolean" }, topic: { type: "string" }, text: { type: "string" } },
        required: ["useful", "topic", "text"],
        additionalProperties: false,
      },
    );
    // Every number must be one staff actually wrote.
    const said = new Set(numbersIn(`${open.question} ${answer}`));
    if (!out.useful || !out.text.trim() || !numbersIn(out.text).every((n) => said.has(n))) return chat;
    topic = out.topic.trim();
    text = out.text.trim();
  }

  const suggestion: FactSuggestion = { id: open.id, question: open.question, answer, topic, text, at: now };
  const others = (chat.fact_suggestions ?? []).filter((s) => s.id !== open.id);
  return { ...chat, fact_suggestions: [...others, suggestion] };
}

/** After a staff reply is saved: propose a fact if it answered an open question. Never fails the reply. */
export async function learnFromStaff(db: Db, businessId: string, chatId: string, now = Date.now()): Promise<void> {
  try {
    await withLock(`${businessId}:${chatId}`, async () => {
      const chat = await loadChat(db, businessId, chatId);
      if (!chat) return;
      const next = await suggestFact(chat, now);
      if (next !== chat) await saveChat(db, businessId, next);
    });
  } catch (err) {
    console.error("Could not propose a fact from the staff reply:", err);
  }
}
