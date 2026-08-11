import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { EvaluatedPosition } from "@/components/dashboard/types";
import { colorFor, fmtPct, formatMoney } from "@/components/dashboard/format";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";

export function AllocationCard({
  evaluated, privacyMode, openDetail,
}: {
  evaluated: EvaluatedPosition[]; privacyMode: boolean; openDetail: (symbol: string) => void;
}) {
  const pieData = evaluated.map((p) => ({ name: p.symbol, value: p.value, weight: p.weight }));

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 22 }}>
      <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 700, marginBottom: "var(--space-4)", textAlign: "center" }}>הקצאת נכסים</div>
      {pieData.length === 0 ? (
        <EmptyState
          compact
          icon={<PieChartIcon size={18} />}
          title="אין עדיין נתונים להצגה"
          subtitle="ברגע שתוסיף פוזיציה, הקצאת התיק תופיע כאן כגרף עוגה"
        />
      ) : (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto", width: 210, height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={95} paddingAngle={2}
                onClick={(data) => openDetail(String(data.name))}>
                {pieData.map((p, i) => (
                  <Cell key={p.name} fill={colorFor(p.name, i)} stroke="var(--panel)" strokeWidth={2}
                    style={{ cursor: p.name !== "CASH" ? "pointer" : "default" }} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val, name) => [formatMoney(Number(val), privacyMode), String(name)]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: "0 1 260px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px" }}>
          {pieData.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: "var(--radius-full)", background: colorFor(p.name, i), flexShrink: 0 }} />
              <span style={{ color: "var(--text-dim)" }}>{p.name}</span>
              <span style={{ marginRight: "auto", fontFamily: "var(--mono)", color: "var(--text)", fontWeight: 600 }}>{fmtPct(p.weight)}</span>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
