"use client";

import { useActionState } from "react";
import { verifyCode, type AuthFormState } from "@/app/actions/auth";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { AuthShell } from "@/components/auth/AuthShell";

const initialState: AuthFormState = {};

export default function VerifyForm({ email, code, fromLogin }: { email: string; code: string; fromLogin?: boolean }) {
  const [state, formAction, pending] = useActionState(verifyCode, initialState);

  return (
    <AuthShell>
      <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: "var(--space-1)" }}>
        אימות חשבון
      </h1>
      <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-dim)", margin: 0, marginBottom: "var(--space-6)" }}>
        נשלח קוד אימות בן 6 ספרות לכתובת{" "}
        <strong style={{ color: "var(--text)" }}>{email}</strong>
      </p>

      {fromLogin && (
        <div style={{
          marginBottom: "var(--space-6)", borderRadius: "var(--radius-sm)", border: "1px solid var(--info-subtle-border)",
          background: "var(--info-subtle)", padding: "var(--space-3) var(--space-3)", fontSize: "var(--font-size-base)", color: "var(--info)",
        }}>
          יש לאמת את כתובת האימייל שלך לפני ההתחברות. הזן את הקוד שקיבלת כדי להמשיך.
        </div>
      )}

      <div style={{
        marginBottom: "var(--space-6)", borderRadius: "var(--radius-sm)", border: "1px solid var(--accent-subtle-border)",
        background: "var(--accent-subtle)", padding: "var(--space-4) var(--space-4)", textAlign: "center",
      }}>
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-dim)", marginBottom: "var(--space-1)" }}>
          קוד לדוגמה (בשלב זה אין שליחת מייל בפועל)
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: "var(--font-size-2xl)", fontWeight: 700, letterSpacing: "0.3em", color: "var(--gain)" }}>
          {code}
        </div>
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <label htmlFor="code" style={{ display: "block", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-dim)", marginBottom: "var(--space-2)" }}>
            קוד אימות
          </label>
          <input
            id="code" name="code" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            required autoComplete="one-time-code"
            style={{
              width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-2)",
              padding: "var(--space-3) var(--space-3)", textAlign: "center", fontSize: "var(--font-size-lg)", letterSpacing: "0.4em", color: "var(--text)",
            }}
          />
        </div>

        {state?.error && <ErrorBanner message={state.error} />}

        <button
          type="submit" disabled={pending} className="auth-btn-primary"
          style={{
            marginTop: "var(--space-2)", borderRadius: "var(--radius-sm)", background: "var(--accent)",
            padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
            color: "var(--accent-on)", border: "none", cursor: "pointer",
          }}
        >
          {pending ? "מאמת..." : "אימות"}
        </button>
      </form>
    </AuthShell>
  );
}
