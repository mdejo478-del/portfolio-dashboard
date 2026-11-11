"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Gauge, Settings2, ArrowUp, ArrowDown } from "lucide-react";
import { getMarketStatusAction } from "@/app/actions/market";
import {
  VIX_ZONE_LABEL, changeOf, fearGreedRatingHe, gaugeFraction, isExtremeFear, missingReading, vixGaugeMax, vixGaugeSegments, vixZone,
  type IndicatorReading, type MarketSettings, type MarketSnapshot, type VixZoneId,
} from "@/lib/marketStatus";
import { PRICE_STATUS_LABEL } from "@/lib/priceStatus";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

// "Market status": the VIX and CNN Fear & Greed, shown against the owner's OWN rules (the zones
// below are the owner's thresholds from settings). Display only - nothing here recommends a trade.

const REFRESH_MS = 5 * 60_000;

const ZONE_COLOR: Record<VixZoneId, string> = {
  calm: "var(--gain)", alert: "var(--info)", buy: "var(--accent)", panic: "var(--warning)", extreme: "var(--loss)",
};
const STATUS_COLOR = { ok: "var(--gain)", stale: "var(--warning)", missing: "var(--loss)" } as const;

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

/** Source, when it was obtained, and whether it can be trusted - the same ok / stale / missing
 * vocabulary as the price status. A source with no official API says so. */
function ReliabilityLine({ reading }: { reading: IndicatorReading }) {
  const time = clock(reading.fetchedAt);
  return (
    <div data-reliability={reading.status} style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
      <span style={{ color: STATUS_COLOR[reading.status], fontWeight: 700 }}>● {PRICE_STATUS_LABEL[reading.status]}</span>
      {" · מקור: " + reading.source}
      {reading.unofficial && <span data-unofficial="true" style={{ color: "var(--warning)", fontWeight: 600 }}> (מקור לא רשמי)</span>}
      {time ? " · עודכן " + time : reading.asOf ? " · נתון מתאריך " + reading.asOf.slice(0, 10) : ""}
    </div>
  );
}

function ChangeLine({ reading, digits, percent }: { reading: IndicatorReading; digits: number; percent: boolean }) {
  const c = changeOf(reading);
  if (!c) return <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>שינוי מאתמול: אין נתון</div>;
  const up = c.abs > 0;
  const flat = c.abs === 0;
  return (
    <div data-change style={{ fontSize: 12.5, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
      <span>שינוי מאתמול:</span>
      {!flat && (up ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
      <span style={{ fontFamily: "var(--mono)", direction: "ltr", unicodeBidi: "plaintext" }}>
        {(up ? "+" : "") + c.abs.toFixed(digits)}
        {percent && c.pct !== null ? " (" + (c.pct >= 0 ? "+" : "") + (c.pct * 100).toFixed(1) + "%)" : ""}
      </span>
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
  padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
};

function Unavailable({ title, reading, hint }: { title: string; reading: IndicatorReading; hint: string }) {
  return (
    <div style={panelStyle} data-panel-missing>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-faint)" }}>לא זמין</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{hint}</div>
      <ReliabilityLine reading={reading} />
    </div>
  );
}

/** A horizontal scale (left = low, always, so numbers read the same in RTL) with a marker. */
function Gauge1D({ segments, max, value, ticks, activeId }: {
  segments: Array<{ id: string; from: number; to: number; color: string }>; max: number; value: number; ticks: number[]; activeId?: string;
}) {
  const pos = gaugeFraction(value, max) * 100;
  return (
    <div dir="ltr" style={{ position: "relative", paddingTop: 8, paddingBottom: 18 }} data-gauge>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden" }}>
        {segments.map((s) => (
          <div key={s.id} data-zone={s.id} style={{ width: ((s.to - s.from) / max) * 100 + "%", background: s.color, opacity: activeId === undefined || activeId === s.id ? 1 : 0.35 }} />
        ))}
      </div>
      <div data-marker style={{
        position: "absolute", top: 0, left: pos + "%", transform: "translateX(-50%)", width: 0, height: 0,
        borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid var(--text)",
      }} />
      {ticks.map((t) => (
        <span key={t} style={{ position: "absolute", top: 22, left: gaugeFraction(t, max) * 100 + "%", transform: "translateX(-50%)", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>{t}</span>
      ))}
    </div>
  );
}

function VixPanel({ reading, settings }: { reading: IndicatorReading; settings: MarketSettings }) {
  if (reading.value === null) {
    return <Unavailable title="VIX - מדד התנודתיות" reading={reading} hint="לא התקבל נתון מ-Yahoo Finance. שאר הכרטיס ממשיך לעבוד." />;
  }
  const zone = vixZone(reading.value, settings.vixZones);
  const max = vixGaugeMax(settings.vixZones);
  const z = settings.vixZones;
  return (
    <div style={panelStyle} data-panel="vix">
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>VIX - מדד התנודתיות</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span data-value style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700 }}>{reading.value.toFixed(2)}</span>
        <span data-zone-label={zone} style={{
          padding: "2px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: ZONE_COLOR[zone],
          border: "1px solid " + ZONE_COLOR[zone],
        }}>{VIX_ZONE_LABEL[zone]}</span>
      </div>
      <ChangeLine reading={reading} digits={2} percent />
      <Gauge1D
        max={max} value={reading.value} activeId={zone} ticks={[z.calmBelow, z.alertBelow, z.buyBelow, z.panicUpTo]}
        segments={vixGaugeSegments(z, max).map((s) => ({ ...s, color: ZONE_COLOR[s.id] }))}
      />
      <ReliabilityLine reading={reading} />
    </div>
  );
}

function FearGreedPanel({ reading, settings }: { reading: IndicatorReading; settings: MarketSettings }) {
  if (reading.value === null) {
    return <Unavailable title="Fear & Greed (CNN)" reading={reading} hint="המקור הלא רשמי של CNN לא החזיר נתון (ייתכן שהוא חוסם בקשות אוטומטיות). שאר הכרטיס ממשיך לעבוד." />;
  }
  const threshold = settings.fearGreedExtremeBelow;
  const extreme = isExtremeFear(reading.value, threshold);
  const rating = fearGreedRatingHe(reading.rating);
  return (
    <div style={panelStyle} data-panel="fear-greed">
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Fear & Greed (CNN) <span style={{ color: "var(--warning)", fontWeight: 600, fontSize: 11.5 }}>· מקור לא רשמי</span></div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span data-value style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700 }}>{reading.value.toFixed(1)}</span>
        {rating && <span data-rating style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{rating}</span>}
      </div>
      <div data-extreme-fear={extreme ? "true" : "false"} style={{ fontSize: 12.5, fontWeight: extreme ? 700 : 500, color: extreme ? "var(--accent)" : "var(--text-faint)" }}>
        {extreme ? "פחד קיצוני - מתחת ל-" + threshold + " (לפי הכלל שלך)" : "מעל סף פחד קיצוני (" + threshold + ")"}
      </div>
      <ChangeLine reading={reading} digits={1} percent={false} />
      <Gauge1D
        max={100} value={reading.value} activeId={extreme ? "extreme" : "rest"} ticks={[0, threshold, 100]}
        segments={[
          { id: "extreme", from: 0, to: threshold, color: "var(--accent)" },
          { id: "rest", from: threshold, to: 100, color: "var(--text-faint)" },
        ]}
      />
      <ReliabilityLine reading={reading} />
    </div>
  );
}

export function MarketStatusCard({ settings, onOpenSettings }: { settings: MarketSettings; onOpenSettings: () => void }) {
  const isMobile = useIsMobile(760);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await getMarketStatusAction());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount, then poll - the same canonical data-fetching Effect as the price refresh. The
    // server serves this from a cache shared by every user, so polling is cheap.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  // If the very request failed, show both indicators as missing rather than a blank card.
  const shown: MarketSnapshot | null = snapshot ?? (loadFailed ? { vix: missingReading("Yahoo Finance", false), fearGreed: missingReading("CNN", true) } : null);

  return (
    <section aria-label="מצב שוק" data-market-card style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
      padding: "var(--space-4) var(--space-5)", marginBottom: "var(--space-6)", display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
            <Gauge size={17} color="var(--accent)" /> מצב שוק
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>לפי הכללים שלך · הצגה בלבד, לא המלצה</div>
        </div>
        <button type="button" onClick={onOpenSettings} aria-label="הגדרות מצב שוק" title="הגדרות מצב שוק"
          style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-dim)", cursor: "pointer", padding: 6, display: "flex" }}>
          <Settings2 size={15} />
        </button>
      </div>
      {shown === null ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }} data-market-loading>
          {[0, 1].map((i) => <div key={i} className="ds-skeleton" style={{ height: 150, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <VixPanel reading={shown.vix} settings={settings} />
          <FearGreedPanel reading={shown.fearGreed} settings={settings} />
        </div>
      )}
    </section>
  );
}
