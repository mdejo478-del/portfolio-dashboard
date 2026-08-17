"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "@/app/actions/auth";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { AuthShell } from "@/components/auth/AuthShell";

const initialState: ResetPasswordState = {};

const labelStyle = { display: "block", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-dim)", marginBottom: "var(--space-2)" };
const inputStyle = {
  width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-2)",
  padding: "var(--space-3) var(--space-3)", fontSize: 16, color: "var(--text)",
};

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <AuthShell>
      <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: "var(--space-1)" }}>
        איפוס סיסמה
      </h1>
      <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-dim)", margin: 0, marginBottom: "var(--space-6)" }}>
        בחר סיסמה חדשה לחשבון שלך
      </p>

      {state.resetButLoginFailed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{
            borderRadius: "var(--radius-sm)", border: "1px solid var(--gain-subtle-border)", background: "var(--gain-subtle)",
            padding: "var(--space-3) var(--space-3)", fontSize: "var(--font-size-base)", color: "var(--gain)",
          }}>
            הסיסמה עודכנה בהצלחה. התחבר עם הסיסמה החדשה שלך.
          </div>
          <Link
            href="/login" className="auth-link"
            style={{
              display: "block", textAlign: "center", borderRadius: "var(--radius-sm)", background: "var(--accent)",
              padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
              color: "var(--accent-on)", textDecoration: "none",
            }}
          >
            התחברות
          </Link>
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="newPassword" style={labelStyle}>סיסמה חדשה</label>
            <input id="newPassword" name="newPassword" type="password" required autoComplete="new-password" minLength={6} style={inputStyle} />
            <p style={{ marginTop: "var(--space-1)", fontSize: "var(--font-size-xs)", color: "var(--text-faint)" }}>לפחות 6 תווים</p>
          </div>
          <div>
            <label htmlFor="confirmPassword" style={labelStyle}>אימות סיסמה חדשה</label>
            <input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" minLength={6} style={inputStyle} />
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
            {pending ? "מאפס..." : "איפוס סיסמה"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
