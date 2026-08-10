import type { ReactNode } from "react";

export function AuthShell({ children, maxWidth = 420 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div dir="rtl" style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "var(--bg)",
      position: "relative", overflow: "hidden", padding: "var(--space-6) var(--space-4)",
    }}>
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
      `}</style>

      {/* רקע מאוחד אחד לכל הדף - glow עדין + קו דקורטיבי, לא פאנל נפרד */}
      <div style={{
        position: "absolute", top: "-10%", left: "50%", width: 900, height: 900,
        background: "radial-gradient(circle, var(--accent-subtle) 0%, transparent 65%)",
        transform: "translateX(-50%)", pointerEvents: "none", opacity: 0.6,
      }} />
      <svg viewBox="0 0 1200 300" style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: "40%",
        opacity: 0.08, pointerEvents: "none",
      }}>
        <path d="M0,220 C150,160 300,260 450,180 C600,100 750,220 900,140 C1000,90 1100,150 1200,80"
          fill="none" stroke="var(--accent)" strokeWidth="3" />
      </svg>

      {/* טאגליין ממורכז מעל הכרטיס - לא בפאנל נפרד */}
      <div style={{ textAlign: "center", marginBottom: "var(--space-6)", position: "relative", maxWidth: 480 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", lineHeight: 1.4 }}>
          השקעה לפי הקצאה, <span style={{ color: "var(--accent)" }}>לא לפי רגש.</span>
        </div>
      </div>

      <div className="auth-shell" style={{
        width: "100%", maxWidth, position: "relative",
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)",
        padding: "var(--space-8)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.6)",
      }}>
        {/* The logo asset has a solid black canvas baked in, which blends
            invisibly into the dark-theme panel but reads as a hard-edged
            black square on the light-theme panel (var(--panel) is white
            there). Rounding it + a theme-aware shadow lift makes it read as
            a deliberate icon tile in both themes instead of a clipped photo. */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-6)" }}>
          <div style={{ borderRadius: "var(--radius-xl)", overflow: "hidden", boxShadow: "var(--shadow-md)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="IPMS" style={{ width: 130, height: "auto", display: "block" }} />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
