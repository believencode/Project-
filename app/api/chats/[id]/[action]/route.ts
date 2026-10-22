import { after as afterResponse, NextResponse } from "next/server";
import type { Chat, Message } from "@/lib/types";
import { currentBusiness } from "@/lib/session";
import { loadChat, saveChat } from "@/lib/repo";
import { openChat, resumeBot, settleRequest, skipThirtyMinutes, staffReply } from "@/lib/engine";
import { runTurn, type TurnResult } from "@/lib/turn";
import { llmEnabled } from "@/lib/llm";
import { writeNewMessages } from "@/lib/writer";
import { testChat } from "@/lib/fixtures";
import { withLock } from "@/lib/locks";
import { deliverNew } from "@/lib/whatsapp/outbound";
import { learnFromStaff } from "@/lib/learn";

// AI calls can take several seconds.
export const maxDuration = 60;

const ACTIONS = ["customer", "staff", "settle", "resume", "skip30", "open", "reset", "suggestion"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Everything that changes a chat: a (simulated) customer message, a staff
 * reply, confirming a request, resuming the bot, opening, resetting. On a
 * WhatsApp chat, new bot and staff messages are sent to the customer.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const { db, row } = ctx;
  const { id, action } = await params;
  if (!ACTIONS.includes(action as Action)) return NextResponse.json({ error: "unknown action" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    kind?: Message["kind"];
    requestId?: string;
    ok?: boolean;
    source?: "inbox" | "echo";
    suggestionId?: string;
    status?: "added" | "dismissed";
  };

  return withLock(`${row.id}:${id}`, async () => {
    const before = await loadChat(db, row.id, id);
    if (!before) return NextResponse.json({ error: "chat not found" }, { status: 404 });
    const sheet = row.data.sheet;
    const now = Date.now();
    let after: Chat;
    let extra: Partial<TurnResult> = {};

    switch (action as Action) {
      case "customer": {
        if (before.is_whatsapp) return NextResponse.json({ error: "This customer writes in WhatsApp; simulated messages are for test chats." }, { status: 400 });
        if (typeof body.text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
        const r = await runTurn(before, sheet, body.text, body.kind ?? "text", now);
        after = r.chat;
        extra = { decision: r.decision, ai_error: r.ai_error };
        break;
      }
      case "staff":
        if (!body.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
        // A simulated reply "from the phone" only makes sense on the test chat.
        after = staffReply(before, body.text.trim(), now, body.source === "echo" && before.is_test ? "echo" : "inbox");
        // Once the reply is saved: did it answer a question the bot couldn't? Then propose it as a fact.
        afterResponse(() => learnFromStaff(db, row.id, id));
        break;
      case "suggestion":
        // The owner added the proposed fact to the knowledge base (the sheet is saved separately) or dismissed it.
        if (!body.suggestionId || (body.status !== "added" && body.status !== "dismissed")) {
          return NextResponse.json({ error: "suggestionId and status required" }, { status: 400 });
        }
        after = {
          ...before,
          fact_suggestions: (before.fact_suggestions ?? []).map((s) => (s.id === body.suggestionId ? { ...s, status: body.status } : s)),
        };
        break;
      case "settle": {
        if (!body.requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });
        after = settleRequest(before, body.requestId, body.ok !== false, now);
        if (llmEnabled() && after !== before) {
          try {
            after = await writeNewMessages(before, after, sheet);
          } catch (err) {
            console.error("AI could not write the confirmation:", err);
            return NextResponse.json({ error: "The AI could not write the message. Try again, or reply to the customer yourself." }, { status: 503 });
          }
        }
        break;
      }
      case "resume":
        after = resumeBot(before, now);
        break;
      case "skip30":
        after = skipThirtyMinutes(before, now);
        break;
      case "open":
        after = openChat(before);
        break;
      case "reset":
        if (!before.is_test) return NextResponse.json({ error: "Only the test chat can be reset." }, { status: 400 });
        await db.query("DELETE FROM messages WHERE business_id = $1 AND chat_id = $2", [row.id, id]);
        after = testChat();
        break;
    }

    const delivered = await deliverNew(db, row, before, after);
    await saveChat(db, row.id, delivered.chat, { waIds: delivered.waIds });
    return NextResponse.json({ chat: delivered.chat, ...extra });
  });
}
