import type { ReactNode } from "react";

export function PageBanner({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{
      background: "linear-gradient(90deg, rgba(34,211,168,0.16) 0%, rgba(34,211,168,0.03) 100%)",
      border: "1px solid rgba(34,211,168,0.35)", borderRight: "5px solid var(--accent)",
      borderRadius: 12, padding: "20px 24px", marginBottom: 22,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{
        color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
        width: 40, height: 40, borderRadius: 10, background: "rgba(34,211,168,0.15)", flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 23, fontWeight: 800, color: "var(--text)", letterSpacing: 0.2, lineHeight: 1.25 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4, letterSpacing: 0.4 }}>{subtitle}</div>
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
