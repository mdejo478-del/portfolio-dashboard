"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Gauge, Settings2, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { getMarketStatusAction } from "@/app/actions/market";
import {
  VIX_ZONE_LABEL, changeOf, gaugeFraction, missingReading, vixGaugeMax, vixGaugeSegments, vixZone,
  type IndicatorReading, type MarketSettings, type MarketSnapshot, type VixZoneId,
} from "@/lib/marketStatus";
import {
  PRESSURE_COMPONENT_IDS, isExtremePressure, missingComponent, computePressureIndex, pressureFormulaLines,
  type PressureComponent, type PressureComponentId, type PressureIndex,
} from "@/lib/marketPressure";
import { PRICE_STATUS_LABEL, type PriceStatus } from "@/lib/priceStatus";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

// "Market status": the VIX and an own-calculation market pressure index, shown against the owner's OWN
// rules (the zones below are the owner's thresholds from settings). Display only - nothing here
// recommends a trade.

const REFRESH_MS = 5 * 60_000;
const CNN_FEAR_GREED_URL = "https://www.cnn.com/markets/fear-and-greed";

const ZONE_COLOR: Record<VixZoneId, string> = {
  calm: "var(--gain)", alert: "var(--info)", buy: "var(--accent)", panic: "var(--warning)", extreme: "var(--loss)",
};
const STATUS_COLOR = { ok: "var(--gain)", stale: "var(--warning)", missing: "var(--loss)" } as const;

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

/** Source, when it was obtained, and whether it can be trusted - the same ok / stale / missing vocabulary
 * as the price status. */
function ReliabilityLine({ status, source, fetchedAt, asOf }: { status: PriceStatus; source: string; fetchedAt: string | null; asOf: string | null }) {
  const time = clock(fetchedAt);
  return (
    <div data-reliability={status} style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
      <span style={{ color: STATUS_COLOR[status], fontWeight: 700 }}>● {PRICE_STATUS_LABEL[status]}</span>
      {" · מקור: " + source}
      {time ? " · עודכן " + time : asOf ? " · נתון מתאריך " + asOf.slice(0, 10) : ""}
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

function Unavailable({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={panelStyle} data-panel-missing>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-faint)" }}>לא זמין</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{hint}</div>
      {children}
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
    return (
      <Unavailable title="VIX - מדד התנודתיות" hint="לא התקבל נתון מ-Yahoo Finance. שאר הכרטיס ממשיך לעבוד.">
        <ReliabilityLine status={reading.status} source={reading.source} fetchedAt={reading.fetchedAt} asOf={reading.asOf} />
      </Unavailable>
    );
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
      <ReliabilityLine status={reading.status} source={reading.source} fetchedAt={reading.fetchedAt} asOf={reading.asOf} />
    </div>
  );
}

/** What one component's raw input looks like, in words. */
function rawText(c: PressureComponent): string {
  if (c.raw === null) return "";
  switch (c.id) {
    case "vix": return c.raw.toFixed(2);
    case "term": return c.raw.toFixed(3) + (c.backwardation ? " (מעל 1 - backwardation)" : "");
    case "drawdown": return (c.raw === 0 ? "בשיא" : "-" + (c.raw * 100).toFixed(1) + "% מהשיא");
    case "trend": return (c.raw >= 0 ? "+" : "") + (c.raw * 100).toFixed(1) + "% מהממוצע";
  }
}

function ComponentRow({ c }: { c: PressureComponent }) {
  const missing = c.score === null || c.status === "missing";
  const time = clock(c.fetchedAt);
  const title = missing ? "חסר - לא נספר במדד" : PRICE_STATUS_LABEL[c.status] + " · מקור: " + c.source + (time ? " · עודכן " + time : c.asOf ? " · נתון מתאריך " + c.asOf.slice(0, 10) : "");
  return (
    <div data-component={c.id} data-component-status={c.status} title={title} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px", fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ color: "var(--text-dim)" }}>
        <span style={{ color: STATUS_COLOR[c.status] }}>●</span> {c.label}
        {c.backwardation && <span data-backwardation style={{ color: "var(--warning)", fontWeight: 700 }}> · backwardation</span>}
      </span>
      <span style={{ fontFamily: "var(--mono)", direction: "ltr", textAlign: "left", fontWeight: 600 }}>
        {missing ? <span style={{ color: "var(--loss)" }}>חסר</span> : <>{c.score!.toFixed(0)}<span style={{ color: "var(--text-faint)" }}>/100</span></>}
      </span>
      <span style={{ color: "var(--text-faint)", fontSize: 11.5, gridColumn: "1 / -1" }}>
        {missing ? "לא נספר במדד (לא כ-0)" : rawText(c)}
        {!missing && c.status === "stale" ? " · ישן" : ""}
      </span>
    </div>
  );
}

function PressurePanel({ index, settings }: { index: PressureIndex; settings: MarketSettings }) {
  const title = "מדד לחץ שוק (חישוב עצמי)";
  const notCnn = (
    <div data-not-cnn style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
      זה לא המדד של CNN. <a href={CNN_FEAR_GREED_URL} target="_blank" rel="noopener noreferrer" data-cnn-link
        style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 3 }}>לצפייה ב-CNN <ExternalLink size={11} /></a>
    </div>
  );
  const reliability = <ReliabilityLine status={index.status} source="Yahoo Finance (חישוב עצמי)" fetchedAt={index.components.map((c) => c.fetchedAt).filter((x): x is string => x !== null).sort()[0] ?? null} asOf={index.components.map((c) => c.asOf).find((x) => x !== null) ?? null} />;
  if (index.value === null) {
    return (
      <Unavailable title={title} hint="אף אחד מרכיבי המדד לא התקבל מ-Yahoo Finance. שאר הכרטיס ממשיך לעבוד.">
        {notCnn}
        {reliability}
      </Unavailable>
    );
  }
  const threshold = settings.pressureExtremeAbove;
  const extreme = isExtremePressure(index.value, threshold);
  return (
    <div style={panelStyle} data-panel="pressure">
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span data-value style={{ fontFamily: "var(--mono)", fontSize: 28, fontWeight: 700 }}>{index.value.toFixed(1)}</span>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>0 = שקט · 100 = לחץ מקסימלי</span>
      </div>
      <div data-extreme-pressure={extreme ? "true" : "false"} style={{ fontSize: 12.5, fontWeight: extreme ? 700 : 500, color: extreme ? "var(--loss)" : "var(--text-faint)" }}>
        {extreme ? "לחץ קיצוני - מעל " + threshold + " (לפי הכלל שלך)" : "מתחת לסף לחץ קיצוני (" + threshold + ")"}
      </div>
      <div data-built-from style={{ fontSize: 12, color: "var(--text-dim)" }}>
        מחושב מ-{index.available} מתוך {index.components.length} רכיבים
        {index.missing > 0 && <span style={{ color: "var(--warning)", fontWeight: 600 }}> · חסרים {index.missing}</span>}
      </div>
      <Gauge1D
        max={100} value={index.value} activeId={extreme ? "extreme" : "rest"} ticks={[0, threshold, 100]}
        segments={[
          { id: "rest", from: 0, to: threshold, color: "var(--text-faint)" },
          { id: "extreme", from: threshold, to: 100, color: "var(--loss)" },
        ]}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }} data-components>
        {index.components.map((c) => <ComponentRow key={c.id} c={c} />)}
      </div>
      <details data-formulas style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
        <summary style={{ cursor: "pointer" }}>איך המדד מחושב</summary>
        <ul style={{ margin: "4px 0 0", paddingInlineStart: 18, lineHeight: 1.7 }}>
          {pressureFormulaLines().map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
      {notCnn}
      {reliability}
    </div>
  );
}

const allMissingIndex = (): PressureIndex => computePressureIndex((PRESSURE_COMPONENT_IDS as PressureComponentId[]).map(missingComponent));

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

  // If the very request failed, show both panels as missing rather than a blank card.
  const shown: MarketSnapshot | null = snapshot ?? (loadFailed ? { vix: missingReading("Yahoo Finance"), pressure: allMissingIndex() } : null);

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
          <PressurePanel index={shown.pressure} settings={settings} />
        </div>
      )}
    </section>
  );
}
