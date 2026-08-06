import { AlertCircle } from "lucide-react";

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
      borderRadius: "var(--radius-md)", border: "1px solid var(--loss-subtle-border)",
      background: "var(--loss-subtle)", color: "var(--loss)",
      padding: "var(--space-3) var(--space-3)", fontSize: "var(--font-size-base)",
    }}>
      <AlertCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}
