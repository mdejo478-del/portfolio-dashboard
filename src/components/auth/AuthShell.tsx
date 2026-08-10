import type { ReactNode } from "react";
import { Lock } from "lucide-react";

export function AuthShell({ children, maxWidth = 420 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div dir="rtl" style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "var(--bg)",
      position: "relative", overflow: "hidden", padding: "var(--space-3)",
    }}>
      <style>{`
        .auth-shell input, .auth-shell select, .auth-shell textarea {
          transition: border-color 200ms ease, box-shadow 200ms ease;
        }
        .auth-shell input:focus, .auth-shell select:focus, .auth-shell textarea:focus {
          outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus);
        }
        .auth-shell .auth-link { color: var(--accent); text-decoration: none; transition: color 140ms ease; }
        .auth-shell .auth-link:hover { color: var(--accent-hover); text-decoration: underline; }
        .auth-shell .auth-link:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
        .auth-shell .auth-btn-primary { transition: background 140ms ease, transform 140ms ease; }
        .auth-shell .auth-btn-primary:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
        .auth-shell .auth-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-shell .auth-btn-ghost { transition: border-color 140ms ease, color 140ms ease; }
        .auth-shell .auth-btn-ghost:hover:not(:disabled) { border-color: var(--text-dim); color: var(--text); }
        .auth-shell .auth-btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-shell .auth-btn-primary:focus-visible, .auth-shell .auth-btn-ghost:focus-visible {
          outline: none; box-shadow: var(--shadow-focus);
        }

        @keyframes auth-glow-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.85; } }
        .auth-glow-pulse { animation: auth-glow-pulse 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .auth-glow-pulse { animation: none; opacity: 0.5; }
        }
      `}</style>

      {/* רקע מאוחד אחד לכל הדף - glow עדין + קו דקורטיבי, לא פאנל נפרד */}
      <div className="auth-glow-pulse" style={{
        position: "absolute", top: "-12%", left: "50%", width: 1050, height: 1050,
        background: "radial-gradient(circle, var(--accent-subtle) 0%, var(--accent-subtle) 35%, transparent 70%)",
        transform: "translateX(-50%)", pointerEvents: "none",
      }} />
      <svg viewBox="0 0 1200 300" style={{
        position: "absolute", top: "50%", left: "50%", width: 1000, height: 250,
        transform: "translate(-50%, -50%)", opacity: 0.08, pointerEvents: "none",
      }}>
        <path d="M0,220 C150,160 300,260 450,180 C600,100 750,220 900,140 C1000,90 1100,150 1200,80"
          fill="none" stroke="var(--accent)" strokeWidth="3" />
      </svg>

      {/* eyebrow + כותרת ממורכזים מעל הכרטיס - לא בפאנל נפרד */}
      <div style={{ textAlign: "center", marginBottom: "var(--space-3)", position: "relative", maxWidth: 480 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase",
          letterSpacing: "0.15em", marginBottom: "var(--space-1)",
        }}>
          ניהול תיק השקעות חכם
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1.35, letterSpacing: "-0.01em" }}>
          השקעה לפי <span style={{ color: "var(--accent)" }}>הקצאה</span>, לא לפי{" "}
          <span style={{ color: "var(--accent)" }}>רגש</span>.
        </div>
      </div>

      <div className="auth-shell" style={{
        width: "100%", maxWidth, position: "relative",
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)",
        padding: "var(--space-5)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-3)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="IPMS" style={{
            width: 140, height: "auto", display: "block",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)",
          }} />
        </div>

        {children}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)",
          marginTop: "var(--space-2)", fontSize: 12, color: "var(--text-faint)",
        }}>
          <Lock size={12} />
          מאובטח ומוצפן מקצה לקצה
        </div>
      </div>

      <div style={{
        position: "absolute", inset: 0, opacity: 0.025, pointerEvents: "none",
        mixBlendMode: "overlay",
        backgroundImage: "url(/grain.png)",
        backgroundRepeat: "repeat",
      }} />
    </div>
  );
}
