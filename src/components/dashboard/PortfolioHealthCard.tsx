import type { Tone, PortfolioHealthData } from "@/components/dashboard/types";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { fmtPct } from "@/components/dashboard/format";

function ToneDot({ tone }: { tone: Tone }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "var(--radius-full)",
        background: TONE_STYLES[tone].text,
        flexShrink: 0,
      }}
    />
  );
}

function HealthChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const s = TONE_STYLES[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14,
      background: s.bg, border: "1px solid " + s.border, borderRadius: 8, padding: "6px 12px", whiteSpace: "nowrap",
    }}>
      <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>{label}:</span>
      <span style={{ color: s.text, fontWeight: 700 }}>{value}</span>
    </span>
  );
}

export function PortfolioHealthCard({ health }: { health: PortfolioHealthData }) {
  const s = TONE_STYLES[health.tone];
  const riskTone: Tone = health.risk === "תקין" ? "green" : health.risk === "גבוה" ? "red" : "blue";
  const diversificationTone: Tone = health.diversification === "טוב" ? "green" : health.diversification === "בינוני" ? "amber" : "red";

  return (
    <div style={{
      background: s.bg, border: "1px solid " + s.border, borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
      padding: "var(--space-4) var(--space-5)", marginBottom: 22, display: "flex", flexDirection: "column", gap: "var(--space-3)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
          <ToneDot tone={health.tone} /> בריאות התיק
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, color: s.text }}>
          ציון: {health.score}/100
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <HealthChip label="פיזור" value={health.diversification} tone={diversificationTone} />
        <HealthChip label="סיכון" value={health.risk} tone={riskTone} />
        <HealthChip label="Cash" value={fmtPct(health.cashPct)} tone={health.cashTone} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
        <div>
          <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>צריך לחזק: </span>
          <span style={{ color: "var(--text)" }}>
            {health.needsStrengthen.length > 0 ? health.needsStrengthen.map((p) => p.symbol).join(", ") : "אין נכסים מתחת ליעד"}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>חריגות משקל: </span>
          <span style={{ color: health.weightBreaches.length > 0 ? "var(--loss)" : "var(--text)" }}>
            {health.weightBreaches.length > 0 ? health.weightBreaches.map((p) => p.symbol).join(", ") : "אין חריגות משקל"}
          </span>
        </div>
      </div>
    </div>
  );
}
