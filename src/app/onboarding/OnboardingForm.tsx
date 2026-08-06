"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Sparkles, Wallet, ListChecks } from "lucide-react";
import { completeOnboarding } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/AuthShell";

interface Step {
  icon: ReactNode;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: <Sparkles size={26} />,
    title: "ברוך הבא ל-IPMS",
    description: "מעקב אישי לתיק השקעות.",
  },
  {
    icon: <Wallet size={26} />,
    title: "מתחילים",
    description: "התחל בהוספת פוזיציה או הפקדת מזומן.",
  },
  {
    icon: <ListChecks size={26} />,
    title: "יומן מסחר חכם",
    description: "כל העסקאות נשמרות ביומן המסחר, כולל עמלות ורווח/הפסד.",
  },
];

export default function OnboardingForm() {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function finish() {
    startTransition(async () => {
      await completeOnboarding();
      window.location.assign("/");
    });
  }

  function next() {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }

  return (
    <AuthShell maxWidth={448}>
      <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginBottom: "var(--space-8)" }}>
        {STEPS.map((_, i) => (
          <span
            key={i}
            style={{
              height: 6, borderRadius: "var(--radius-full)", transition: "all 200ms ease",
              width: i === step ? 28 : 6, background: i === step ? "var(--accent)" : "var(--border)",
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "var(--space-4)", marginBottom: "var(--space-9)" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56,
          borderRadius: "var(--radius-full)", background: "var(--accent-subtle)", color: "var(--accent)",
        }}>
          {current.icon}
        </div>
        <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0 }}>{current.title}</h1>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--text-dim)", margin: 0 }}>
          {current.description}
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <button
          type="button" onClick={finish} disabled={pending} className="auth-btn-ghost"
          style={{
            flex: 1, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent",
            padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 600,
            color: "var(--text-dim)", cursor: "pointer",
          }}
        >
          דלג
        </button>
        <button
          type="button" onClick={next} disabled={pending} className="auth-btn-primary"
          style={{
            flex: 1, borderRadius: "var(--radius-sm)", background: "var(--accent)", border: "none",
            padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
            color: "var(--accent-on)", cursor: "pointer",
          }}
        >
          {pending ? "רגע..." : isLast ? "התחל" : "הבא"}
        </button>
      </div>
    </AuthShell>
  );
}
