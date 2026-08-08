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
          outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus);
        }
        .auth-shell .auth-link { color: var(--accent); text-decoration: none; transition: color 140ms ease; }
        .auth-shell .auth-link:hover { color: var(--accent-hover); text-decoration: underline; }
        .auth-shell .auth-link:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
        .auth-shell .auth-btn-primary { transition: background 140ms ease; }
        .auth-shell .auth-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .auth-shell .auth-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-shell .auth-btn-ghost { transition: border-color 140ms ease, color 140ms ease; }
        .auth-shell .auth-btn-ghost:hover:not(:disabled) { border-color: var(--text-dim); color: var(--text); }
        .auth-shell .auth-btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
        .auth-shell .auth-btn-primary:focus-visible, .auth-shell .auth-btn-ghost:focus-visible {
          outline: none; box-shadow: var(--shadow-focus);
        }

        @keyframes draw-line { to { stroke-dashoffset: 0; } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes glow-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.6; } }
        @keyframes dot-pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }

        .auth-line { stroke-dasharray: 100; stroke-dashoffset: 100; animation: draw-line 2.2s ease-out 0.3s forwards; }
        .auth-badge { animation: fade-up 0.6s ease-out 1.8s both, bob 3.5s ease-in-out 2.4s infinite; }
        .auth-glow { animation: glow-pulse 4s ease-in-out infinite; }
        .auth-dot-ping { animation: dot-pulse 1.8s ease-out 2s infinite; }

        @media (prefers-reduced-motion: reduce) {
          .auth-line, .auth-badge, .auth-glow, .auth-dot-ping { animation: none; }
        }

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
        <div className="auth-glow" style={{
          position: "absolute", top: "50%", left: "50%", width: 520, height: 520,
          background: "radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)", pointerEvents: "none",
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

          {/* logo on a light plaque so the jpg's white background reads as intentional -
              the plaque is deliberately a fixed light literal, not a theme token: the logo
              asset itself has a baked-in off-white background, so the plaque has to stay
              light regardless of app theme or the logo's own background would clash against it */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-6)" }}>
            <div style={{
              background: "#f4f4f2", borderRadius: "var(--radius-2xl)", padding: 10,
              boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="IPMS" style={{ width: 64, height: 64, borderRadius: 8, display: "block", objectFit: "cover" }} />
            </div>
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
            themes, unlike a hardcoded dark-teal which would only work in dark mode. */}
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

        {/* animated rising equity curve - purely decorative, not sourced from any portfolio */}
        <div style={{ position: "relative", width: "100%", height: 180 }}>
          <div className="auth-badge" style={{
            position: "absolute", top: 6, left: "18%",
            background: "var(--gain-subtle)", border: "1px solid var(--gain-subtle-border)", color: "var(--gain)",
            fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13, borderRadius: 8, padding: "4px 10px",
          }}>
            +24.6%
          </div>

          <svg viewBox="0 0 600 160" style={{ width: "100%", height: "100%" }} aria-hidden="true">
            <path
              className="auth-line"
              pathLength={100}
              d="M0,130 C60,90 110,150 170,100 C230,50 280,120 340,75 C400,30 450,95 510,45 C540,20 560,35 590,10"
              fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
            />
            {/* end point + pulsing ping to draw the eye upward */}
            <circle cx="590" cy="10" r="5" fill="var(--accent)" />
            <circle className="auth-dot-ping" cx="590" cy="10" r="5" fill="var(--accent)" />
          </svg>
        </div>
      </div>
    </div>
  );
}
