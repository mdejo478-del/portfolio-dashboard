// "Market pressure index (own calculation)" - task 10.2. A deterministic 0-100 number built ONLY
// from Yahoo market data, replacing the CNN Fear & Greed index (CNN blocks automated access).
// It is NOT CNN's index and is always labeled as such. Pure and framework-agnostic (type-only
// imports, no Node APIs): it runs in the browser bundle, on the server and under the test runner.
//
// 0 = no pressure, 100 = maximum pressure (the opposite direction to Fear & Greed's scale: here a
// HIGH number means a stressed market). Four components, each mapped to 0..100 by a straight line
// between two anchors (clamped outside them), and the index is the plain average of the components
// that are available:
//
//   1. VIX level            VIX <= 12 -> 0        VIX >= 40 -> 100
//   2. VIX / VIX3M ratio    ratio <= 0.80 -> 0    ratio >= 1.20 -> 100   (1.00 -> 50)
//        VIX3M is the 3-month volatility index; a ratio above 1 means short-term fear is higher
//        than 3-month fear ("backwardation") - a classic sign of panic.
//   3. S&P 500 below its 52-week high   at the high -> 0     20% below it -> 100
//        52-week high = the highest DAILY CLOSE of the last 365 days.
//   4. S&P 500 vs its 125-day average   >= 5% above it -> 0   >= 10% below it -> 100
//        125-day average = simple average of the last 125 daily closes.
//
// A component with no data is MISSING - it is never counted as 0. The index is the average of the
// rest and says how many components it is built from.

import type { PriceStatus } from "./priceStatus";

export type PressureComponentId = "vix" | "term" | "drawdown" | "trend";
export const PRESSURE_COMPONENT_IDS: PressureComponentId[] = ["vix", "term", "drawdown", "trend"];

export const PRESSURE_COMPONENT_LABEL: Record<PressureComponentId, string> = {
  vix: "רמת VIX",
  term: "VIX / VIX3M",
  drawdown: "S&P 500 - מרחק משיא 52 שבועות",
  trend: "S&P 500 - מול ממוצע 125 יום",
};

/** Where each component is 0 ("calm") and where it is 100 ("panic"). */
export const PRESSURE_ANCHORS = {
  vix: { calm: 12, panic: 40 },
  term: { calm: 0.8, panic: 1.2 },
  drawdown: { calm: 0, panic: 0.2 },
  trend: { calm: 0.05, panic: -0.1 },
} as const;

/** The 52-week window and the moving-average length used above. */
export const HIGH_WINDOW_DAYS = 365;
export const TREND_MA_DAYS = 125;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A straight line from `calm` (score 0) to `panic` (score 100), clamped; works whichever of the two is larger. */
export function lineScore(x: number, calm: number, panic: number): number {
  return clamp((x - calm) / (panic - calm), 0, 1) * 100;
}

export const scoreVix = (vix: number): number => lineScore(vix, PRESSURE_ANCHORS.vix.calm, PRESSURE_ANCHORS.vix.panic);
export const scoreTermStructure = (ratio: number): number => lineScore(ratio, PRESSURE_ANCHORS.term.calm, PRESSURE_ANCHORS.term.panic);
export const scoreDrawdown = (drawdown: number): number => lineScore(drawdown, PRESSURE_ANCHORS.drawdown.calm, PRESSURE_ANCHORS.drawdown.panic);
export const scoreTrend = (trend: number): number => lineScore(trend, PRESSURE_ANCHORS.trend.calm, PRESSURE_ANCHORS.trend.panic);

/** VIX / VIX3M; null unless both are positive numbers. */
export function termRatio(vix: number | null, vix3m: number | null): number | null {
  if (vix === null || vix3m === null || !(vix > 0) || !(vix3m > 0)) return null;
  return vix / vix3m;
}
/** Short-term fear above 3-month fear. */
export const isBackwardation = (ratio: number): boolean => ratio > 1;

/** How far below its high the price is, as a fraction (0 at the high, 0.1 = 10% below). */
export function drawdownFromHigh(price: number, high: number): number | null {
  if (!(price > 0) || !(high > 0)) return null;
  return Math.max(0, (high - price) / high);
}
/** How far above (+) or below (-) its average the price is, as a fraction. */
export function trendVsAverage(price: number, average: number): number | null {
  if (!(price > 0) || !(average > 0)) return null;
  return price / average - 1;
}

/** Simple average of the last `n` values; null with fewer than `n`. */
export function simpleMovingAverage(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

/** Highest of the closes whose timestamp (unix seconds) lies within `windowDays` before `nowSec`. */
export function highestCloseWithin(t: number[], c: number[], nowSec: number, windowDays: number): number | null {
  const from = nowSec - windowDays * 86_400;
  let high: number | null = null;
  for (let i = 0; i < c.length; i++) {
    if (t[i] >= from && Number.isFinite(c[i]) && (high === null || c[i] > high)) high = c[i];
  }
  return high;
}

// ---- the index ---------------------------------------------------------------------------------------

export interface PressureComponent {
  id: PressureComponentId;
  label: string;
  /** The raw input the score comes from (VIX level, ratio, fraction below the high, fraction vs the average). */
  raw: number | null;
  /** 0..100, or null when the component is missing (it is then NOT counted). */
  score: number | null;
  /** Only for the term-structure component: the ratio is above 1. */
  backwardation: boolean;
  source: string;
  fetchedAt: string | null;
  asOf: string | null;
  status: PriceStatus;
}

export interface PressureIndex {
  /** The average of the available components' scores, 1 decimal; null when none is available. */
  value: number | null;
  components: PressureComponent[];
  available: number;
  missing: number;
  /** missing without any component; stale if any component in use is stale; otherwise ok. */
  status: PriceStatus;
}

export const PRESSURE_SOURCE = "Yahoo Finance (חישוב עצמי)";

/** A component with no data. */
export function missingComponent(id: PressureComponentId): PressureComponent {
  return { id, label: PRESSURE_COMPONENT_LABEL[id], raw: null, score: null, backwardation: false, source: "Yahoo Finance", fetchedAt: null, asOf: null, status: "missing" };
}

/** The average of the components that have a score. A missing one is left out, never counted as 0. */
export function computePressureIndex(components: PressureComponent[]): PressureIndex {
  const used = components.filter((c) => c.score !== null && c.status !== "missing");
  const available = used.length;
  const value = available === 0 ? null : Math.round((used.reduce((s, c) => s + (c.score as number), 0) / available) * 10) / 10;
  const status: PriceStatus = available === 0 ? "missing" : used.some((c) => c.status === "stale") ? "stale" : "ok";
  return { value, components, available, missing: components.length - available, status };
}

/** The owner's rule: pressure ABOVE the threshold is extreme (default threshold in marketStatus.ts). */
export function isExtremePressure(value: number, threshold: number): boolean {
  return value > threshold;
}

// ---- building components from the market readings ---------------------------------------------------------

/** What the index needs to know about one input series. */
export interface InputReading {
  value: number | null;
  status: PriceStatus;
  fetchedAt: string | null;
  asOf: string | null;
}
export interface SpxInput extends InputReading {
  /** Highest close of the last 52 weeks and the 125-day average, computed from the same series. */
  high52: number | null;
  ma125: number | null;
}

const rank: Record<PriceStatus, number> = { ok: 0, stale: 1, missing: 2 };
const worst = (...s: PriceStatus[]): PriceStatus => s.reduce((a, b) => (rank[b] > rank[a] ? b : a));
// The older of two times (the more cautious one); null if either is unknown.
const older = (a: string | null, b: string | null): string | null => (a === null || b === null ? null : Date.parse(a) <= Date.parse(b) ? a : b);

function component(id: PressureComponentId, raw: number | null, score: number | null, inputs: InputReading[], backwardation = false): PressureComponent {
  if (raw === null || score === null) return missingComponent(id);
  const status = worst(...inputs.map((i) => i.status));
  const fetchedAt = inputs.map((i) => i.fetchedAt).reduce<string | null>((a, b, idx) => (idx === 0 ? b : older(a, b)), null);
  const asOf = inputs.map((i) => i.asOf).reduce<string | null>((a, b, idx) => (idx === 0 ? b : older(a, b)), null);
  return { id, label: PRESSURE_COMPONENT_LABEL[id], raw, score, backwardation, source: "Yahoo Finance", fetchedAt, asOf, status: status === "missing" ? "missing" : status };
}

/** The four components from the VIX, VIX3M and S&P 500 readings. Any input that is missing makes ONLY
 * the components that need it missing. */
export function buildPressureComponents(inputs: { vix: InputReading; vix3m: InputReading; spx: SpxInput }): PressureComponent[] {
  const { vix, vix3m, spx } = inputs;
  const usable = (r: InputReading) => r.value !== null && r.status !== "missing";
  const vixV = usable(vix) ? vix.value : null;
  const vix3mV = usable(vix3m) ? vix3m.value : null;
  const spxV = usable(spx) ? spx.value : null;

  const ratio = termRatio(vixV, vix3mV);
  const dd = spxV !== null && spx.high52 !== null ? drawdownFromHigh(spxV, spx.high52) : null;
  const tr = spxV !== null && spx.ma125 !== null ? trendVsAverage(spxV, spx.ma125) : null;

  return [
    component("vix", vixV, vixV === null ? null : scoreVix(vixV), [vix]),
    component("term", ratio, ratio === null ? null : scoreTermStructure(ratio), [vix, vix3m], ratio !== null && isBackwardation(ratio)),
    component("drawdown", dd, dd === null ? null : scoreDrawdown(dd), [spx]),
    component("trend", tr, tr === null ? null : scoreTrend(tr), [spx]),
  ];
}

export function buildPressureIndex(inputs: { vix: InputReading; vix3m: InputReading; spx: SpxInput }): PressureIndex {
  return computePressureIndex(buildPressureComponents(inputs));
}

/** The formulas as shown to the user, generated from the same anchors the code uses. */
export function pressureFormulaLines(): string[] {
  const a = PRESSURE_ANCHORS;
  return [
    "רמת VIX: " + a.vix.calm + " ומטה = 0, " + a.vix.panic + " ומעלה = 100",
    "VIX / VIX3M: " + a.term.calm.toFixed(2) + " ומטה = 0, " + a.term.panic.toFixed(2) + " ומעלה = 100 (מעל 1 = backwardation, סימן לפאניקה)",
    "S&P 500 מרחק משיא 52 שבועות (סגירה): בשיא = 0, " + a.drawdown.panic * 100 + "% מתחתיו ויותר = 100",
    "S&P 500 מול ממוצע " + TREND_MA_DAYS + " יום: " + a.trend.calm * 100 + "% מעליו ומעלה = 0, " + Math.abs(a.trend.panic) * 100 + "% מתחתיו ומטה = 100",
    "המדד הוא הממוצע של הרכיבים הזמינים. רכיב חסר לא נספר כ-0.",
  ];
}
