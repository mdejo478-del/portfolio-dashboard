import type { ReactNode } from "react";

export function PageBanner({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: "var(--space-5) var(--space-6)", marginBottom: "var(--space-6)",
      display: "flex", alignItems: "center", gap: "var(--space-4)",
    }}>
      <div style={{
        color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
        width: 40, height: 40, borderRadius: "var(--radius-sm)", background: "var(--panel-2)", flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "var(--text)", letterSpacing: "var(--letter-spacing-heading)", lineHeight: "var(--line-height-tight)" }}>{title}</div>
        <div style={{ fontSize: "var(--font-size-subtitle)", fontWeight: 600, color: "var(--text-dim)", marginTop: "var(--space-1)", letterSpacing: "var(--letter-spacing-subtitle)" }}>{subtitle}</div>
      </div>
    </div>
  );
}

export function SectionTitle({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
      <span style={{ color: "var(--accent)", display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}
