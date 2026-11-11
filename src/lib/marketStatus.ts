// "Market status" card (task 9.2): VIX and CNN Fear & Greed, shown against the owner's own
// rules. Display only - these are the owner's zones, not recommendations. Pure and
// framework-agnostic (type-only imports, no Node APIs), so it runs in the browser bundle,
// on the server and under the test runner.

import type { PriceStatus } from "./priceStatus";

// ---- the owner's rules (defaults; changeable in settings) -----------------------------------

/** Upper edges of the VIX zones. calm: v < calmBelow · alert: calmBelow <= v < alertBelow ·
 * buy: alertBelow <= v < buyBelow · panic: buyBelow <= v <= panicUpTo · extreme: v > panicUpTo.
 * With the defaults (20, 25, 30, 40): under 20 calm, 20-25 alert, 25-30 buying zone,
 * 30-40 panic, above 40 extreme panic - a value exactly on an edge belongs to the HIGHER
 * zone, except 40 itself, which is still "panic" ("above 40" is extreme). */
export interface VixZones {
  calmBelow: number;
  alertBelow: number;
  buyBelow: number;
  panicUpTo: number;
}

export interface MarketSettings {
  vixZones: VixZones;
  /** Fear & Greed below this is "extreme fear" (default 25). */
  fearGreedExtremeBelow: number;
}

export const DEFAULT_VIX_ZONES: VixZones = { calmBelow: 20, alertBelow: 25, buyBelow: 30, panicUpTo: 40 };
export const DEFAULT_FEAR_GREED_EXTREME_BELOW = 25;
export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  vixZones: { ...DEFAULT_VIX_ZONES },
  fearGreedExtremeBelow: DEFAULT_FEAR_GREED_EXTREME_BELOW,
};

export type VixZoneId = "calm" | "alert" | "buy" | "panic" | "extreme";

export const VIX_ZONE_LABEL: Record<VixZoneId, string> = {
  calm: "רגוע",
  alert: "דריכות",
  buy: "אזור קנייה",
  panic: "פאניקה",
  extreme: "פאניקה קיצונית",
};

export const VIX_ZONE_ORDER: VixZoneId[] = ["calm", "alert", "buy", "panic", "extreme"];

export function vixZone(value: number, zones: VixZones = DEFAULT_VIX_ZONES): VixZoneId {
  if (value < zones.calmBelow) return "calm";
  if (value < zones.alertBelow) return "alert";
  if (value < zones.buyBelow) return "buy";
  if (value <= zones.panicUpTo) return "panic";
  return "extreme";
}

/** The owner's rule for Fear & Greed: below the threshold is extreme fear. */
export function isExtremeFear(score: number, threshold: number = DEFAULT_FEAR_GREED_EXTREME_BELOW): boolean {
  return score < threshold;
}

// ---- settings validation -----------------------------------------------------------------------

const MAX_VIX_THRESHOLD = 150;

export type SettingsCheck = { ok: true; settings: MarketSettings } | { ok: false; message: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checks settings coming from the user (or from disk) and explains in Hebrew what is wrong. */
export function validateMarketSettings(input: unknown): SettingsCheck {
  if (!input || typeof input !== "object") return { ok: false, message: "הגדרות מצב השוק חסרות או אינן תקינות." };
  const o = input as Record<string, unknown>;
  const z = o.vixZones as Record<string, unknown> | undefined;
  if (!z || typeof z !== "object") return { ok: false, message: "הגדרות אזורי ה-VIX חסרות." };
  const { calmBelow, alertBelow, buyBelow, panicUpTo } = z;
  if (![calmBelow, alertBelow, buyBelow, panicUpTo].every(isNum)) {
    return { ok: false, message: "ספי ה-VIX חייבים להיות מספרים." };
  }
  const [a, b, c, d] = [calmBelow, alertBelow, buyBelow, panicUpTo] as number[];
  if (a <= 0) return { ok: false, message: "סף ה-VIX הראשון חייב להיות גדול מ-0." };
  if (!(a < b && b < c && c < d)) {
    return { ok: false, message: "ספי ה-VIX חייבים לעלות לפי הסדר: רגוע < דריכות < אזור קנייה < פאניקה (למשל 20, 25, 30, 40)." };
  }
  if (d > MAX_VIX_THRESHOLD) return { ok: false, message: "סף ה-VIX העליון לא יכול לעלות על " + MAX_VIX_THRESHOLD + "." };
  const fg = o.fearGreedExtremeBelow;
  if (!isNum(fg) || !(fg > 0 && fg < 100)) {
    return { ok: false, message: "סף פחד קיצוני במדד Fear & Greed חייב להיות מספר בין 0 ל-100 (ברירת המחדל 25)." };
  }
  return { ok: true, settings: { vixZones: { calmBelow: a, alertBelow: b, buyBelow: c, panicUpTo: d }, fearGreedExtremeBelow: fg } };
}

/** Settings as stored: valid ones are used as they are, anything missing or invalid falls
 * back to the defaults (a bad stored value must never break the card). */
export function normalizeMarketSettings(raw: unknown): MarketSettings {
  const check = validateMarketSettings(raw);
  return check.ok ? check.settings : { vixZones: { ...DEFAULT_VIX_ZONES }, fearGreedExtremeBelow: DEFAULT_FEAR_GREED_EXTREME_BELOW };
}

// ---- readings and their reliability --------------------------------------------------------------

/** One indicator as shown: the value, where it came from, when we got it, and whether it can be
 * trusted - the same ok / stale / missing vocabulary the prices use (see priceStatus.ts). */
export interface IndicatorReading {
  value: number | null;
  /** Yesterday's value, for "change since yesterday". */
  previous: number | null;
  /** Human-readable source ("Yahoo Finance", "CNN"). */
  source: string;
  /** True for a source with no official API (CNN) - always labeled as such. */
  unofficial: boolean;
  /** ISO time WE obtained this value; null when it comes from the stored history. */
  fetchedAt: string | null;
  /** The data point's own time (ISO), or the history date it was recorded on. */
  asOf: string | null;
  status: PriceStatus;
  /** The source's own rating word (CNN: "fear", "extreme fear"...), when it gives one. */
  rating: string | null;
}

export interface MarketSnapshot {
  vix: IndicatorReading;
  fearGreed: IndicatorReading;
}

/** How old a successfully fetched value may get before it is "stale". */
export const VIX_STALE_AFTER_MS = 30 * 60_000;
export const FEAR_GREED_STALE_AFTER_MS = 6 * 60 * 60_000;

export function readingStatus(value: number | null, fetchedAt: string | null, nowMs: number, staleAfterMs: number): PriceStatus {
  if (value === null || !Number.isFinite(value)) return "missing";
  if (fetchedAt === null) return "stale"; // known only from the stored history
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return "stale";
  return nowMs - at > staleAfterMs ? "stale" : "ok";
}

export function missingReading(source: string, unofficial: boolean): IndicatorReading {
  return { value: null, previous: null, source, unofficial, fetchedAt: null, asOf: null, status: "missing", rating: null };
}

/** Change since yesterday: absolute, and in percent (only when yesterday's value is positive). */
export function changeOf(r: Pick<IndicatorReading, "value" | "previous">): { abs: number; pct: number | null } | null {
  if (r.value === null || r.previous === null || !Number.isFinite(r.previous)) return null;
  return { abs: r.value - r.previous, pct: r.previous > 0 ? (r.value - r.previous) / r.previous : null };
}

const FEAR_GREED_LABEL_HE: Record<string, string> = {
  "extreme fear": "פחד קיצוני", fear: "פחד", neutral: "ניטרלי", greed: "חמדנות", "extreme greed": "חמדנות קיצונית",
};

/** CNN's rating word in Hebrew; null when there is none or it is not one we know. */
export function fearGreedRatingHe(rating: string | null): string | null {
  if (!rating) return null;
  return FEAR_GREED_LABEL_HE[rating.trim().toLowerCase().replace(/[_-]+/g, " ")] ?? null;
}

// ---- gauge geometry ----------------------------------------------------------------------------------------

/** Where the VIX scale ends (so the extreme zone has room); never below 50. */
export function vixGaugeMax(zones: VixZones): number {
  return Math.max(50, Math.ceil(zones.panicUpTo * 1.25));
}

export interface GaugeSegment {
  id: VixZoneId;
  from: number;
  to: number;
}

export function vixGaugeSegments(zones: VixZones, max: number = vixGaugeMax(zones)): GaugeSegment[] {
  return [
    { id: "calm", from: 0, to: zones.calmBelow },
    { id: "alert", from: zones.calmBelow, to: zones.alertBelow },
    { id: "buy", from: zones.alertBelow, to: zones.buyBelow },
    { id: "panic", from: zones.buyBelow, to: zones.panicUpTo },
    { id: "extreme", from: zones.panicUpTo, to: max },
  ];
}

/** Position of a value on a 0..max scale, as a fraction in [0, 1] (clamped). */
export function gaugeFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !(max > 0)) return 0;
  return Math.min(1, Math.max(0, value / max));
}
