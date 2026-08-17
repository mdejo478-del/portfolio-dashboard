"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { requestPasswordReset, type RequestPasswordResetState } from "@/app/actions/auth";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { AuthShell } from "@/components/auth/AuthShell";

const initialState: RequestPasswordResetState = {};

const labelStyle = { display: "block", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-dim)", marginBottom: "var(--space-2)" };
const inputStyle = {
  width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-2)",
  padding: "var(--space-3) var(--space-3)", fontSize: 16, color: "var(--text)",
};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <AuthShell>
      <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: "var(--space-1)" }}>
        שחזור סיסמה
      </h1>
      <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-dim)", margin: 0, marginBottom: "var(--space-6)" }}>
        הזן את כתובת האימייל שלך ונשלח אליך קישור לאיפוס הסיסמה
      </p>

      {state.success ? (
        <div style={{ padding: "var(--space-2) 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", background: "var(--gain-subtle)",
            color: "var(--gain)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Mail size={24} />
          </div>
          <div style={{ fontSize: "var(--font-size-base)", color: "var(--text)", lineHeight: "var(--line-height-relaxed)" }}>
            אם קיים חשבון עם כתובת האימייל הזו, נשלח אליו קישור לאיפוס הסיסמה. בדוק את תיבת הדואר שלך (כולל תיקיית ספאם).
          </div>
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div>
            <label htmlFor="email" style={labelStyle}>אימייל</label>
            <input id="email" name="email" type="email" required autoComplete="email" style={inputStyle} />
          </div>

          {state.error && <ErrorBanner message={state.error} />}

          <button
            type="submit" disabled={pending} className="auth-btn-primary"
            style={{
              marginTop: "var(--space-2)", borderRadius: "var(--radius-sm)", background: "var(--accent)",
              padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
              color: "var(--accent-on)", border: "none", cursor: "pointer",
            }}
          >
            {pending ? "שולח..." : "שלח קישור איפוס"}
          </button>
        </form>
      )}

      <p style={{ marginTop: "var(--space-6)", textAlign: "center", fontSize: "var(--font-size-base)", color: "var(--text-dim)" }}>
        נזכרת בסיסמה?{" "}
        <Link href="/login" className="auth-link">התחברות</Link>
      </p>
    </AuthShell>
  );
}
