"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type AuthFormState } from "@/app/actions/auth";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { AuthShell } from "@/components/auth/AuthShell";

const initialState: AuthFormState = {};

const labelStyle = { display: "block", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-dim)", marginBottom: "var(--space-2)" };
const inputStyle = {
  width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel-2)",
  padding: "var(--space-3) var(--space-3)", fontSize: 16, color: "var(--text)",
};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <AuthShell>
      <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: "var(--space-1)" }}>
        התחברות
      </h1>
      <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-dim)", margin: 0, marginBottom: "var(--space-6)" }}>
        התחבר כדי לצפות בתיק ההשקעות שלך
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <label htmlFor="email" style={labelStyle}>אימייל</label>
          <input id="email" name="email" type="email" required autoComplete="email" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="password" style={labelStyle}>סיסמה</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" style={inputStyle} />
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
          {pending ? "מתחבר..." : "התחברות"}
        </button>
      </form>

      <p style={{ marginTop: "var(--space-6)", textAlign: "center", fontSize: "var(--font-size-base)", color: "var(--text-dim)" }}>
        אין לך חשבון?{" "}
        <Link href="/register" className="auth-link">הרשמה</Link>
      </p>
    </AuthShell>
  );
}
