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
      textAlign: "center", gap: "var(--space-3)", padding: compact ? "var(--space-7) var(--space-5)" : "var(--space-9) var(--space-6)",
      background: "var(--panel)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
    }}>
      <div style={{
        width: compact ? 40 : 56, height: compact ? 40 : 56, borderRadius: "var(--radius-full)",
        background: "var(--accent-subtle)", color: "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{icon}</div>
      <div style={{ fontSize: compact ? "var(--font-size-base)" : "var(--font-size-md)", fontWeight: 700, color: "var(--text)" }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-dim)", maxWidth: 320, lineHeight: "var(--line-height-relaxed)" }}>{subtitle}</div>
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
