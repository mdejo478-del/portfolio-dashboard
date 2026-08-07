import type { ReactNode } from "react";

// Shared outer wrapper + card for the standalone auth-flow screens (login,
// register, verify, disclaimer, onboarding).
//
// Layout note: the outer flex container is forced to `direction: "ltr"` so
// "left panel" / "right panel" are physically deterministic, regardless of
// where this tree sits (it's always nested under <html dir="rtl">, so merely
// omitting a dir="rtl" attribute here would NOT make it LTR - direction is
// an inherited CSS property, not just an attribute, so the inherited rtl
// would still govern flex packing order unless overridden explicitly like
// this). Each panel then sets its own dir="rtl" for its own text. Don't
// rely on flex+inherited-RTL for physical placement - see the
// HoldingsSection ticker-column bug for why that's fragile.
export function AuthShell({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", direction: "ltr", background: "var(--bg)" }}>
      <style>{`
        .auth-shell input:focus, .auth-shell select:focus, .auth-shell textarea:focus {
          outline: none; border-color: var(--accent);
        }
        .auth-shell .auth-link { color: var(--accent); text-decoration: none; transition: color 140ms ease; }
        .auth-shell .auth-link:hover { color: var(--accent-hover); text-decoration: underline; }
        .auth-shell .auth-btn-primary { transition: background 140ms ease; }
        .auth-shell .auth-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .auth-shell .auth-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-shell .auth-btn-ghost { transition: border-color 140ms ease, color 140ms ease; }
        .auth-shell .auth-btn-ghost:hover:not(:disabled) { border-color: var(--text-dim); color: var(--text); }
        .auth-shell .auth-btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }

        @media (max-width: 860px) {
          .auth-shell-marketing { display: none !important; }
          .auth-shell-login { flex: 1 1 100% !important; }
        }
      `}</style>

      {/* LEFT: login/form panel */}
      <div
        dir="rtl"
        className="auth-shell auth-shell-login"
        style={{
          flex: "0 0 46%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "var(--space-4)", position: "relative", overflow: "hidden",
        }}
      >
        {/* soft glow behind the card */}
        <div style={{
          position: "absolute", top: "50%", left: "50%", width: 520, height: 520,
          background: "radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)", pointerEvents: "none", opacity: 0.5,
        }} />

        <div style={{
          width: "100%", maxWidth, position: "relative",
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.5)",
        }}>
          {/* accent highlight inset at the top, instead of a flat uniform border */}
          <div style={{
            position: "absolute", top: -1, right: "14%", left: "14%", height: 3, borderRadius: 3,
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
            boxShadow: "0 0 14px 1px var(--accent-subtle)",
          }} />

          {/* wordmark instead of the old placeholder logo image */}
          <div style={{
            display: "flex", alignItems: "baseline", gap: 2, marginBottom: "var(--space-6)",
            fontFamily: "var(--mono)", fontWeight: 700, fontSize: 20, letterSpacing: "0.08em", color: "var(--text)",
          }}>
            IPMS<span style={{ color: "var(--accent)" }}>.</span>
          </div>

          {children}
        </div>
      </div>

      {/* RIGHT: marketing / brand panel */}
      <div
        dir="rtl"
        className="auth-shell-marketing"
        style={{
          flex: "1 1 54%", position: "relative", overflow: "hidden",
          background:
            "radial-gradient(circle at 75% 15%, var(--accent-subtle), transparent 55%), " +
            "linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg) 65%)",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: "var(--space-6) var(--space-8)",
        }}
      >
        {/* fade seam so the two panels don't look like two pasted divs - extends
            inward from this panel's own left edge (the shared boundary), so it
            stays inside the panel's own box and isn't clipped by overflow:hidden.
            A neutral black-based fade (not a token) reads as a soft shadow in both
            themes, unlike the previous hardcoded dark-teal which only worked in dark mode. */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: 120,
          background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)",
          pointerEvents: "none",
        }} />

        <div style={{
          fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15, letterSpacing: "0.12em",
          color: "var(--text-dim)", alignSelf: "flex-start",
        }}>
          IPMS
        </div>

        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 34, lineHeight: 1.3, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            השקעה לפי הקצאה,<br />
            <span style={{ color: "var(--accent)" }}>לא לפי רגש.</span>
          </h1>
          <p style={{ marginTop: "var(--space-4)", fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
            מערכת שקטה ומדויקת לניהול תיק ההשקעות שלך – מעקב, איזון ותיעוד במקום אחד.
          </p>
        </div>

        {/* decorative equity-curve style wave, purely visual */}
        <svg viewBox="0 0 600 160" style={{ width: "100%", height: 140, opacity: 0.85 }} aria-hidden="true">
          <path
            d="M0,110 C60,60 120,140 180,90 C240,40 300,120 360,70 C420,20 480,100 540,55 C570,30 590,45 600,40"
            fill="none" stroke="var(--accent)" strokeWidth="2.5"
          />
        </svg>
      </div>
    </div>
  );
}
