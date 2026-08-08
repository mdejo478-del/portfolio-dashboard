import type { ReactNode } from "react";
import type { Tone } from "@/components/dashboard/types";
import { TONE_STYLES } from "@/components/dashboard/constants";

export function Card({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: string; tone?: Tone; icon?: ReactNode }) {
  const s = tone ? TONE_STYLES[tone] : null;
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-sm)",
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--text-dim)", fontSize: "var(--font-size-subtitle)", fontWeight: 600, letterSpacing: "var(--letter-spacing-subtitle)", lineHeight: 1.3 }}>{label}</span>
        {icon}
      </div>
      <span style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 700, lineHeight: 1.2, color: s ? s.text : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ color: "var(--text-faint)", fontSize: 12, lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}
