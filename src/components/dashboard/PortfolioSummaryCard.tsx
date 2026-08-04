import { FileText } from "lucide-react";

export function PortfolioSummaryCard({ lines }: { lines: string[] }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14,
      padding: "16px 20px", marginBottom: 22, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>
        <FileText size={16} color="var(--accent)" /> סיכום התיק
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
            <span style={{ color: "var(--text-dim)" }}>{line}</span>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 11, color: "var(--text-faint)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        סיכום אוטומטי על בסיס נתוני המערכת בלבד · לא ייעוץ השקעות
      </div>
    </div>
  );
}
