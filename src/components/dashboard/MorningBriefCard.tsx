import { Newspaper } from "lucide-react";
import type { MorningBriefResult } from "@/app/actions/morningBrief";
import { computeMorningBriefSummary } from "@/components/dashboard/morningBriefUtils";

export function MorningBriefCard({
  result, loading, error, onOpenDrawer,
}: {
  result: MorningBriefResult | null; loading: boolean; error: string; onOpenDrawer: () => void;
}) {
  const today = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const updatedAt = result ? new Date(result.fetchedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : null;
  const summary = result ? computeMorningBriefSummary(result.upcomingEarnings, result.bigMovers, result.news) : null;

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 22,
      display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 260,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Newspaper size={16} color="var(--accent)" /> Morning Brief
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {today}{updatedAt ? " · עודכן ב-" + updatedAt : ""}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="ds-skeleton" style={{ display: "block", width: "80%", height: 14, borderRadius: 4 }} />
          <span className="ds-skeleton" style={{ display: "block", width: "60%", height: 11, borderRadius: 4 }} />
          <span className="ds-skeleton" style={{ display: "block", width: "70%", height: 11, borderRadius: 4 }} />
        </div>
      ) : error ? (
        <div style={{ color: "var(--loss)", fontSize: 12.5 }}>{error}</div>
      ) : summary ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.5 }}>{summary.headline}</div>
          {summary.bullets.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
              {summary.bullets.map((b, i) => (
                <li key={i} style={{ fontSize: 12.5, color: "var(--text-dim)", display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span> {b}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <button
        type="button" onClick={onOpenDrawer}
        style={{
          marginTop: "auto", alignSelf: "flex-start", background: "transparent", border: "none",
          color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0,
        }}
      >
        קרא את הבריף המלא ←
      </button>
    </div>
  );
}
