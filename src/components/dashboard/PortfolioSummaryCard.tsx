import { FileText } from "lucide-react";

export function PortfolioSummaryCard({ lines }: { lines: string[] }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      padding: "var(--space-4) var(--space-5)", marginBottom: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-md)", fontWeight: 700, color: "var(--text)" }}>
        <FileText size={16} color="var(--accent)" /> סיכום התיק
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: "flex", gap: "var(--space-2)", fontSize: "var(--font-size-sm)", lineHeight: "var(--line-height-normal)" }}>
            <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
            <span style={{ color: "var(--text-dim)" }}>{line}</span>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-faint)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
        סיכום אוטומטי על בסיס נתוני המערכת בלבד · לא ייעוץ השקעות
      </div>
    </div>
  );
}
