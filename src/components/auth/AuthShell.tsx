import type { ReactNode } from "react";

// Shared outer wrapper + card for the standalone auth-flow screens (login,
// register, verify, disclaimer, onboarding) - these sit outside the
// dashboard's own <style> block, so this carries a small scoped <style> for
// :focus/:hover states that plain inline style objects can't express,
// mirroring the pattern already established in Header.tsx.
export function AuthShell({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div
      dir="rtl"
      className="auth-shell"
      style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg)", padding: "var(--space-4)",
      }}
    >
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
      `}</style>
      <div style={{
        width: "100%", maxWidth,
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)",
        padding: "var(--space-8)",
      }}>
        {children}
      </div>
    </div>
  );
}
