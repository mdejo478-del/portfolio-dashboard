import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceLine, Tooltip } from "recharts";
import { TrendingUp, RefreshCw } from "lucide-react";
import type { Tone } from "@/components/dashboard/types";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { fmtPct, formatMoney } from "@/components/dashboard/format";
import type { EquityPoint } from "@/lib/portfolio";

export function EquityCurveCard({
  data, total, ath, returnPct, privacyMode, onRebuild, rebuilding, rebuildWarnings, canRebuild,
}: {
  data: EquityPoint[]; total: number; ath: number; returnPct: number | null; privacyMode: boolean;
  onRebuild: () => void; rebuilding: boolean; rebuildWarnings: string[]; canRebuild: boolean;
}) {
  const tone: Tone = returnPct === null ? "blue" : returnPct >= 0 ? "green" : "red";
  const s = TONE_STYLES[tone];
  const drawdown = ath > 0 ? (total - ath) / ath : 0;

  // Recharts' Area only draws a curve/fill once there are 2+ points, and a
  // single point can also get swallowed by its default entrance animation -
  // so for a brand-new history (or a still-degenerate value range) we render
  // an explicit "first point recorded today" state instead of an empty chart.
  const values = data.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const hasRange = data.length >= 2 && rawMax > rawMin;
  const padding = hasRange ? Math.max((rawMax - rawMin) * 0.12, rawMax * 0.01, 1) : 0;
  const yDomain: [number, number] = [rawMin - padding, rawMax + padding];

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow-sm)", padding: "16px 20px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>
          <TrendingUp size={16} color="var(--accent)" /> התפתחות התיק
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{formatMoney(total, privacyMode)}</span>
          {returnPct !== null && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: s.text }}>
              {returnPct >= 0 ? "+" : ""}{fmtPct(returnPct)} מצטבר
            </span>
          )}
          <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>שיא (ATH): {formatMoney(ath, privacyMode)}</span>
          <span style={{ fontSize: 11.5, color: drawdown < 0 ? "var(--loss)" : "var(--text-faint)" }}>
            Drawdown: {drawdown === 0 ? "0.00%" : fmtPct(drawdown)}
          </span>
          {canRebuild && (
            <button type="button" className="ghost" onClick={onRebuild} disabled={rebuilding}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11.5 }}>
              <RefreshCw size={12} className={rebuilding ? "spin-icon" : undefined} />
              {rebuilding ? "משחזר..." : "שחזור היסטוריה מיומן המסחר"}
            </button>
          )}
        </div>
      </div>

      <div style={{ width: "100%", height: 160 }}>
        {hasRange ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis domain={yDomain} hide />
              <ReferenceLine y={ath} stroke="var(--text-faint)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(label) => String(label)}
                formatter={(val) => [formatMoney(Number(val), privacyMode), "שווי"]}
              />
              <Area
                type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#equityFill)"
                dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--accent)" }} />
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>נקודת המדידה הראשונה נרשמה היום</span>
          </div>
        )}
      </div>

      {!hasRange && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-faint)" }}>
          המערכת שומרת נקודת שווי יומית - הגרף יתמלא בהדרגה ככל שיעברו ימים
          {canRebuild ? ", או לחץ \"שחזור היסטוריה מיומן המסחר\" כדי למלא אותו מיד לפי עסקאות העבר." : "."}
        </div>
      )}

      {rebuildWarnings.length > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: 8, color: "var(--warning)", fontSize: 11.5 }}>
          {rebuildWarnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
    </div>
  );
}
