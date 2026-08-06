import type { ReactNode } from "react";

export function EmptyState({
  icon, title, subtitle, actionLabel, onAction, compact,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", gap: 10, padding: compact ? "28px 20px" : "48px 24px",
      background: "var(--panel)", border: "1px dashed var(--border)", borderRadius: 14,
    }}>
      <div style={{
        width: compact ? 40 : 56, height: compact ? 40 : 56, borderRadius: "50%",
        background: "rgba(34,211,168,0.1)", color: "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{icon}</div>
      <div style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: "var(--text)" }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", maxWidth: 320, lineHeight: 1.6 }}>{subtitle}</div>
      )}
      {actionLabel && onAction && (
        <button
          type="button" className="primary" onClick={onAction}
          style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, padding: "11px 22px", fontSize: 13.5 }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
