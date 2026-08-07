import type { ReactNode } from "react";

// Shared outer wrapper + card for the standalone auth-flow screens (login,
// register, verify, disclaimer, onboarding) - these sit outside the
// dashboard's own <style> block, so this carries a small scoped <style> for
// :focus/:hover/responsive rules that plain inline style objects can't
// express, mirroring the pattern already established in Header.tsx.
//
// Layout: a split screen on wide viewports - the form card on the reading-
// start side (right, in RTL) and a purely decorative brand panel to its
// left (a soft accent glow, a static/illustrative equity-line graphic, and
// the slogan). The brand panel carries zero data or logic - it's a fixed
// SVG path, not sourced from any portfolio - and collapses away entirely
// below 900px, so the mobile experience is unchanged from before.
export function AuthShell({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div dir="rtl" className="auth-shell" style={{ minHeight: "100vh", display: "flex", background: "var(--bg)" }}>
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

        .auth-brand-panel {
          flex: 1 1 50%; position: relative; overflow: hidden;
          display: flex; flex-direction: column; justify-content: space-between;
          padding: var(--space-9) var(--space-9);
          background:
            radial-gradient(circle at 28% 18%, var(--accent-subtle), transparent 55%),
            linear-gradient(165deg, var(--bg-elevated) 0%, var(--bg) 65%);
          border-right: 1px solid var(--border);
        }
        .auth-brand-chart { position: absolute; inset: auto -4% -12% -4%; width: 108%; height: 62%; opacity: 0.5; filter: blur(0.5px); }
        .auth-brand-mark {
          font-family: var(--sans); font-size: 13px; font-weight: 700; letter-spacing: 3px;
          color: var(--text-dim); text-transform: uppercase; position: relative; z-index: 1;
        }
        .auth-brand-slogan {
          font-family: var(--sans); font-size: 38px; font-weight: 700; line-height: 1.25;
          letter-spacing: var(--letter-spacing-heading); color: var(--text); margin: 0;
          max-width: 15ch; position: relative; z-index: 1;
        }
        .auth-brand-slogan em { color: var(--accent); font-style: normal; }
        .auth-brand-sub {
          font-family: var(--sans); font-size: var(--font-size-base); color: var(--text-dim);
          margin: var(--space-3) 0 0; max-width: 34ch; position: relative; z-index: 1; line-height: 1.6;
        }
        @media (max-width: 900px) {
          .auth-brand-panel { display: none; }
        }
      `}</style>

      {/* Form card - first in DOM so it renders on the reading-start side (right, in RTL) */}
      <div style={{ flex: "1 1 50%", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)" }}>
        <div style={{
          position: "relative", width: "100%", maxWidth,
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)",
        }}>
          <div style={{
            position: "absolute", top: -1, right: "14%", left: "14%", height: 3, borderRadius: 3,
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
            boxShadow: "0 0 14px 1px var(--accent-subtle)",
          }} />

          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-6)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="IPMS" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: "var(--radius-sm)" }} />
          </div>

          {children}
        </div>
      </div>

      {/* Brand panel - decorative only, no data/logic */}
      <div className="auth-brand-panel">
        <svg className="auth-brand-chart" viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="authChartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,170 C60,160 90,140 130,145 C170,150 190,110 240,100 C290,90 310,130 360,115 C410,100 430,55 480,50 C530,45 560,75 600,60 L600,220 L0,220 Z"
            fill="url(#authChartFill)"
          />
          <path
            d="M0,170 C60,160 90,140 130,145 C170,150 190,110 240,100 C290,90 310,130 360,115 C410,100 430,55 480,50 C530,45 560,75 600,60"
            fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
          />
        </svg>

        <span className="auth-brand-mark">IPMS</span>

        <div>
          <p className="auth-brand-slogan">
            השקעה לפי הקצאה,<br /><em>לא לפי רגש.</em>
          </p>
          <p className="auth-brand-sub">
            מערכת שקטה ומדויקת לניהול תיק ההשקעות שלך - מעקב, איזון ותיעוד במקום אחד.
          </p>
        </div>
      </div>
    </div>
  );
}
