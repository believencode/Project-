/** Runs once when the server starts: begin listening for WhatsApp messages. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWhatsAppPoller } = await import("./lib/whatsapp/poller");
    startWhatsAppPoller();
  }
}
