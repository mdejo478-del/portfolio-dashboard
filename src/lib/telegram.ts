// Sends admin notifications (e.g. new signups) to a personal Telegram chat via
// a bot. Both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in the
// environment - if either is missing this silently no-ops, so the feature is
// entirely opt-in and never blocks the caller (see notifyNewUserRegistration).
const TELEGRAM_API_BASE = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 5000;

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[telegram] sendMessage failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[telegram] sendMessage failed:", err);
  }
}

// Fire-and-forget by design: the caller (signup) must never be slowed down or
// broken by a slow/unreachable Telegram API, so this is never awaited by its
// callers and never throws itself.
export function notifyNewUserRegistration(user: { name: string; email: string }): void {
  const date = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const text = "משתמש חדש נרשם\nשם: " + user.name + "\nאימייל: " + user.email + "\nתאריך: " + date;
  sendTelegramMessage(text).catch(() => { /* already logged inside sendTelegramMessage */ });
}
