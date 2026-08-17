// Sends transactional email (currently just password-reset links) via Resend's
// REST API. Both RESEND_API_KEY and RESEND_FROM_EMAIL must be set - if either
// is missing this silently no-ops (logged, not thrown), matching FINNHUB_API_KEY's
// "leave empty to disable" pattern elsewhere in this app.
const RESEND_API_BASE = "https://api.resend.com";
const SEND_TIMEOUT_MS = 8000;

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("[email] RESEND_API_KEY or RESEND_FROM_EMAIL not set - email not sent");
    return;
  }

  try {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[email] send failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[email] send failed:", err);
  }
}

function emailShell(bodyHtml: string): string {
  // Plain, self-contained inline-styled HTML - no external stylesheet/font,
  // since email clients strip <link>/<style> support inconsistently.
  return `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <div style="font-size: 13px; font-weight: 700; color: #8a8a8a; letter-spacing: 0.05em; margin-bottom: 16px;">IPMS &mdash; ניהול תיק השקעות</div>
    ${bodyHtml}
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #9a9a9a;">
      אם לא ביקשת פעולה זו, אפשר להתעלם מהמייל הזה בבטחה.
    </div>
  </div>`;
}

// Fire-and-forget by design, same as notifyNewUserRegistration in telegram.ts:
// the caller (requestPasswordReset) must never let a slow/unreachable Resend
// API delay or fail the response - and critically, must never let the
// success/failure of the send itself leak whether the recipient's account
// exists (see the comment on requestPasswordReset for the full reasoning).
export function sendPasswordResetEmail(to: string, resetUrl: string): void {
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 12px;">איפוס סיסמה</h1>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
      התקבלה בקשה לאיפוס הסיסמה לחשבון שלך. לחץ על הכפתור הבא כדי לבחור סיסמה חדשה. הקישור תקף ל-30 דקות.
    </p>
    <a href="${resetUrl}" style="display: inline-block; background: #b8924f; color: #1c1508; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px;">
      איפוס סיסמה
    </a>
    <p style="font-size: 12px; line-height: 1.6; color: #6a6a6a; margin-top: 20px; word-break: break-all;">
      אם הכפתור לא עובד, העתק את הקישור הבא לדפדפן:<br />${resetUrl}
    </p>
  `);
  sendEmail(to, "איפוס סיסמה - IPMS", html).catch(() => { /* already logged inside sendEmail */ });
}
