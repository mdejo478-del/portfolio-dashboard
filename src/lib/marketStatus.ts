// "Market status" card (tasks 9.2, 10.2): the VIX and the own-calculation market pressure index,
// shown against the owner's own rules. Display only - these are the owner's zones, not recommendations. Pure and
// framework-agnostic (type-only imports, no Node APIs), so it runs in the browser bundle,
// on the server and under the test runner.

import type { PriceStatus } from "./priceStatus";
import type { PressureIndex } from "./marketPressure";

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
  /** The own market-pressure index ABOVE this is "extreme pressure" (default 75). */
  pressureExtremeAbove: number;
}

export const DEFAULT_VIX_ZONES: VixZones = { calmBelow: 20, alertBelow: 25, buyBelow: 30, panicUpTo: 40 };
export const DEFAULT_PRESSURE_EXTREME_ABOVE = 75;
export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  vixZones: { ...DEFAULT_VIX_ZONES },
  pressureExtremeAbove: DEFAULT_PRESSURE_EXTREME_ABOVE,
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

// ---- settings validation -----------------------------------------------------------------------

const MAX_VIX_THRESHOLD = 150;

export type SettingsCheck = { ok: true; settings: MarketSettings } | { ok: false; message: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type ZonesCheck = { ok: true; zones: VixZones } | { ok: false; message: string };

function checkVixZones(z: unknown): ZonesCheck {
  if (!z || typeof z !== "object") return { ok: false, message: "הגדרות אזורי ה-VIX חסרות." };
  const { calmBelow, alertBelow, buyBelow, panicUpTo } = z as Record<string, unknown>;
  if (![calmBelow, alertBelow, buyBelow, panicUpTo].every(isNum)) {
    return { ok: false, message: "ספי ה-VIX חייבים להיות מספרים." };
  }
  const [a, b, c, d] = [calmBelow, alertBelow, buyBelow, panicUpTo] as number[];
  if (a <= 0) return { ok: false, message: "סף ה-VIX הראשון חייב להיות גדול מ-0." };
  if (!(a < b && b < c && c < d)) {
    return { ok: false, message: "ספי ה-VIX חייבים לעלות לפי הסדר: רגוע < דריכות < אזור קנייה < פאניקה (למשל 20, 25, 30, 40)." };
  }
  if (d > MAX_VIX_THRESHOLD) return { ok: false, message: "סף ה-VIX העליון לא יכול לעלות על " + MAX_VIX_THRESHOLD + "." };
  return { ok: true, zones: { calmBelow: a, alertBelow: b, buyBelow: c, panicUpTo: d } };
}

const isValidPressureThreshold = (v: unknown): v is number => isNum(v) && v > 0 && v < 100;
const PRESSURE_THRESHOLD_MESSAGE = "סף לחץ קיצוני במדד הלחץ חייב להיות מספר בין 0 ל-100 (ברירת המחדל " + DEFAULT_PRESSURE_EXTREME_ABOVE + ").";

/** Checks settings coming from the user and explains in Hebrew what is wrong. */
export function validateMarketSettings(input: unknown): SettingsCheck {
  if (!input || typeof input !== "object") return { ok: false, message: "הגדרות מצב השוק חסרות או אינן תקינות." };
  const o = input as Record<string, unknown>;
  const zones = checkVixZones(o.vixZones);
  if (!zones.ok) return { ok: false, message: zones.message };
  if (!isValidPressureThreshold(o.pressureExtremeAbove)) return { ok: false, message: PRESSURE_THRESHOLD_MESSAGE };
  return { ok: true, settings: { vixZones: zones.zones, pressureExtremeAbove: o.pressureExtremeAbove } };
}

/** Settings as stored: each valid part is used as it is, anything missing or invalid falls back to its
 * default (a bad stored value must never break the card, and a part that is fine is never thrown away
 * because another is not - e.g. VIX zones saved before the pressure threshold existed). */
export function normalizeMarketSettings(raw: unknown): MarketSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const zones = checkVixZones(o.vixZones);
  return {
    vixZones: zones.ok ? zones.zones : { ...DEFAULT_VIX_ZONES },
    pressureExtremeAbove: isValidPressureThreshold(o.pressureExtremeAbove) ? o.pressureExtremeAbove : DEFAULT_PRESSURE_EXTREME_ABOVE,
  };
}

// ---- readings and their reliability --------------------------------------------------------------

/** One indicator as shown: the value, where it came from, when we got it, and whether it can be
 * trusted - the same ok / stale / missing vocabulary the prices use (see priceStatus.ts). */
export interface IndicatorReading {
  value: number | null;
  /** Yesterday's value, for "change since yesterday". */
  previous: number | null;
  /** Human-readable source ("Yahoo Finance"). */
  source: string;
  /** ISO time WE obtained this value; null when it comes from the stored history. */
  fetchedAt: string | null;
  /** The data point's own time (ISO), or the history date it was recorded on. */
  asOf: string | null;
  status: PriceStatus;
}

export interface MarketSnapshot {
  vix: IndicatorReading;
  /** The own-calculation market pressure index and the components it is made of. */
  pressure: PressureIndex;
}

/** How old a successfully fetched value may get before it is "stale". */
export const VIX_STALE_AFTER_MS = 30 * 60_000;
export const VIX3M_STALE_AFTER_MS = 30 * 60_000;
export const SPX_STALE_AFTER_MS = 3 * 60 * 60_000;

export function readingStatus(value: number | null, fetchedAt: string | null, nowMs: number, staleAfterMs: number): PriceStatus {
  if (value === null || !Number.isFinite(value)) return "missing";
  if (fetchedAt === null) return "stale"; // known only from the stored history
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return "stale";
  return nowMs - at > staleAfterMs ? "stale" : "ok";
}

export function missingReading(source: string): IndicatorReading {
  return { value: null, previous: null, source, fetchedAt: null, asOf: null, status: "missing" };
}

/** Change since yesterday: absolute, and in percent (only when yesterday's value is positive). */
export function changeOf(r: Pick<IndicatorReading, "value" | "previous">): { abs: number; pct: number | null } | null {
  if (r.value === null || r.previous === null || !Number.isFinite(r.previous)) return null;
  return { abs: r.value - r.previous, pct: r.previous > 0 ? (r.value - r.previous) / r.previous : null };
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
