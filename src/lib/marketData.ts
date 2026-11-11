// Market-status data (tasks 9.2, 10.2): everything comes from Yahoo's chart API (the same fetch,
// with its retry/backoff, the rest of the app uses) - the VIX, the VIX3M, and the S&P 500 - and the
// "market pressure index (own calculation)" is computed from them (see marketPressure.ts).
// Server-only. All of it is SHARED across users: one fetch, one cache, one daily history file -
// never per portfolio.
//
// There is deliberately NO call to CNN's Fear & Greed endpoint: CNN blocks automated access and
// that block is not something to work around. The card links to CNN's page instead.

import { promises as fs } from "fs";
import path from "path";
import { withFileLock } from "@/lib/fileLock";
import { writeFileDurable } from "@/lib/durableFile";
import { isValidMarketHistory, recoverFromBackup } from "@/lib/backup";
import { fetchYahooDailyClosesInRange } from "@/lib/prices";
import {
  SPX_STALE_AFTER_MS, VIX3M_STALE_AFTER_MS, VIX_STALE_AFTER_MS, missingReading, readingStatus,
  type IndicatorReading, type MarketSnapshot,
} from "@/lib/marketStatus";
import {
  HIGH_WINDOW_DAYS, PRESSURE_COMPONENT_IDS, TREND_MA_DAYS, buildPressureIndex, computePressureIndex, highestCloseWithin,
  missingComponent, simpleMovingAverage, type PressureComponent, type PressureComponentId, type PressureIndex, type SpxInput,
} from "@/lib/marketPressure";

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "market-history.json");
const QUARANTINE_DIR = path.join(DATA_DIR, "corrupted");
const MAX_HISTORY_DAYS = 3_650; // ~10 years of daily points

const SOURCE = "Yahoo Finance";

type Kind = "vix" | "vix3m" | "spx";
type Series = IndicatorReading | SpxReading;

/** The S&P 500 reading, with the two numbers the pressure index needs from the same series. */
export interface SpxReading extends IndicatorReading, SpxInput {}

/** How long a successful reading is served without fetching again. */
export const MARKET_CACHE_TTL_MS: Record<Kind, number> = { vix: 5 * 60_000, vix3m: 5 * 60_000, spx: 10 * 60_000 };
/** After a FAILED fetch, how long before trying again - so a source that is down is not hit by
 * every user's every refresh. */
export const MARKET_FAILURE_BACKOFF_MS: Record<Kind, number> = { vix: 2 * 60_000, vix3m: 2 * 60_000, spx: 5 * 60_000 };
const STALE_AFTER_MS: Record<Kind, number> = { vix: VIX_STALE_AFTER_MS, vix3m: VIX3M_STALE_AFTER_MS, spx: SPX_STALE_AFTER_MS };

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---- fetching ---------------------------------------------------------------------------------

async function fetchIndexLevel(symbol: string, nowMs: number): Promise<IndicatorReading> {
  const sec = Math.floor(nowMs / 1000);
  // Retried with backoff inside; never throws.
  const closes = await fetchYahooDailyClosesInRange(symbol, sec - 10 * 86_400, sec + 86_400);
  if (!closes || closes.c.length === 0) return missingReading(SOURCE);
  const n = closes.c.length;
  const last = closes.c[n - 1];
  const prev = n >= 2 ? closes.c[n - 2] : null;
  if (!Number.isFinite(last) || !(last > 0)) return missingReading(SOURCE);
  return {
    value: round2(last),
    previous: prev !== null && Number.isFinite(prev) && prev > 0 ? round2(prev) : null,
    source: SOURCE,
    fetchedAt: new Date(nowMs).toISOString(),
    asOf: new Date(closes.t[n - 1] * 1000).toISOString(),
    status: "ok",
  };
}

/** Current VIX and yesterday's close, from the last two daily closes. Missing when Yahoo has no data. */
export const fetchVix = (nowMs: number = Date.now()) => fetchIndexLevel("^VIX", nowMs);
/** The 3-month volatility index, for the VIX / VIX3M ratio. */
export const fetchVix3m = (nowMs: number = Date.now()) => fetchIndexLevel("^VIX3M", nowMs);

/** The S&P 500's last close, its 52-week high (highest daily close of the last 365 days) and its
 * 125-day simple average, all from one daily series. */
export async function fetchSpx(nowMs: number = Date.now()): Promise<SpxReading> {
  const sec = Math.floor(nowMs / 1000);
  const empty: SpxReading = { ...missingReading(SOURCE), high52: null, ma125: null };
  // Over a year of daily closes, so the 52-week window and the 125-day average both have what they need.
  const closes = await fetchYahooDailyClosesInRange("^GSPC", sec - (HIGH_WINDOW_DAYS + 35) * 86_400, sec + 86_400);
  if (!closes || closes.c.length === 0) return empty;
  const n = closes.c.length;
  const last = closes.c[n - 1];
  const prev = n >= 2 ? closes.c[n - 2] : null;
  if (!Number.isFinite(last) || !(last > 0)) return empty;
  return {
    value: round2(last),
    previous: prev !== null && Number.isFinite(prev) && prev > 0 ? round2(prev) : null,
    source: SOURCE,
    fetchedAt: new Date(nowMs).toISOString(),
    asOf: new Date(closes.t[n - 1] * 1000).toISOString(),
    status: "ok",
    high52: highestCloseWithin(closes.t, closes.c, sec, HIGH_WINDOW_DAYS),
    ma125: simpleMovingAverage(closes.c, TREND_MA_DAYS),
  };
}

const FETCHERS: Record<Kind, (nowMs: number) => Promise<Series>> = { vix: fetchVix, vix3m: fetchVix3m, spx: fetchSpx };

// ---- shared cache -----------------------------------------------------------------------------

interface KindState {
  /** The last successfully fetched reading, kept even after a later fetch fails. */
  good: Series | null;
  goodAt: number;
  lastAttemptAt: number;
  lastAttemptOk: boolean;
}

const emptyState = (): KindState => ({ good: null, goodAt: 0, lastAttemptAt: 0, lastAttemptOk: true });
const state: Record<Kind, KindState> = { vix: emptyState(), vix3m: emptyState(), spx: emptyState() };
const inflight: Partial<Record<Kind, Promise<void>>> = {};
const KINDS: Kind[] = ["vix", "vix3m", "spx"];

/** For tests: forget everything cached. */
export function resetMarketCache(): void {
  for (const k of KINDS) { state[k] = emptyState(); delete inflight[k]; }
}

async function refresh(kind: Kind, nowMs: number, force: boolean): Promise<void> {
  const st = state[kind];
  const fresh = st.good !== null && nowMs - st.goodAt < MARKET_CACHE_TTL_MS[kind];
  const backingOff = !st.lastAttemptOk && st.lastAttemptAt > 0 && nowMs - st.lastAttemptAt < MARKET_FAILURE_BACKOFF_MS[kind];
  if (!force && (fresh || backingOff)) return;
  // Concurrent callers share one fetch.
  if (!inflight[kind]) {
    inflight[kind] = (async () => {
      const reading = await FETCHERS[kind](nowMs);
      st.lastAttemptAt = nowMs;
      if (reading.status === "ok") { st.good = reading; st.goodAt = nowMs; st.lastAttemptOk = true; }
      else st.lastAttemptOk = false;
    })().finally(() => { delete inflight[kind]; });
  }
  await inflight[kind];
}

/** The last good reading, honestly aged: "stale" once it is older than it should be; "missing" if
 * nothing was ever obtained. */
function present(kind: Kind, nowMs: number): Series {
  const st = state[kind];
  if (!st.good) return kind === "spx" ? { ...missingReading(SOURCE), high52: null, ma125: null } : missingReading(SOURCE);
  return { ...st.good, status: readingStatus(st.good.value, st.good.fetchedAt, nowMs, STALE_AFTER_MS[kind]) };
}

const asSpx = (r: Series): SpxReading => ({ high52: null, ma125: null, ...r });

/** The VIX and the pressure index, served from a cache shared by every user. A failed fetch never breaks
 * the other series (a missing component is just left out of the index) and never discards the last good
 * value (it just ages into "stale"). \`force\` bypasses the cache (the daily snapshot uses it). */
export async function getMarketSnapshot(opts: { force?: boolean; nowMs?: number } = {}): Promise<MarketSnapshot> {
  const nowMs = opts.nowMs ?? Date.now();
  const force = opts.force ?? false;
  await Promise.all(KINDS.map((k) => refresh(k, nowMs, force)));
  const vixLive = present("vix", nowMs);
  const vix3m = present("vix3m", nowMs);
  const spx = asSpx(present("spx", nowMs));

  // Nothing fetched since this process started: fall back to the last recorded day, marked stale.
  const vix = vixLive.status !== "missing" ? vixLive : (await lastKnownVixFromHistory().catch(() => null)) ?? vixLive;
  let pressure = buildPressureIndex({ vix: vixLive, vix3m, spx });
  if (pressure.available === 0) pressure = (await lastKnownPressureFromHistory().catch(() => null)) ?? pressure;
  return { vix, pressure };
}

// ---- daily history (shared, not per portfolio) -----------------------------------------------------

export interface MarketHistoryDay {
  vix: number | null;
  /** The own pressure index that day; null when it could not be computed. */
  pressure: number | null;
  /** How many components \`pressure\` was built from. */
  pressureComponents?: number;
  /** Each component that went into \`pressure\`: its raw input and its 0..100 score. */
  components?: Partial<Record<PressureComponentId, { raw: number; score: number }>>;
  recordedAt: string;
  /** Written by the first version of this file (CNN Fear & Greed); never written any more, never dropped. */
  fearGreed?: number | null;
}
export interface MarketHistory {
  days: Record<string, MarketHistoryDay>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function quarantineHistory(reason: string): Promise<void> {
  try {
    await fs.mkdir(QUARANTINE_DIR, { recursive: true });
    await fs.rename(HISTORY_FILE, path.join(QUARANTINE_DIR, "market-history.json." + new Date().toISOString().replace(/[:.]/g, "-") + ".corrupt"));
    console.error("[market] history file unreadable (" + reason + "); kept aside and starting a new one");
  } catch (err) {
    console.error("[market] could not set the unreadable history file aside:", err);
  }
}

/** The recorded daily history. A missing file is empty. An unreadable one is restored from the newest valid
 * backup snapshot (the damaged file is kept aside, like the user files); with no valid snapshot it is kept
 * aside (never silently overwritten) and treated as empty. */
export async function readMarketHistory(): Promise<MarketHistory> {
  let text: string;
  try {
    text = await fs.readFile(HISTORY_FILE, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { days: {} };
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isValidMarketHistory(parsed)) return parsed as MarketHistory;
  } catch {
    // fall through to recovery
  }
  const restored = await recoverFromBackup({ livePath: HISTORY_FILE, relPath: "market-history.json", isValid: isValidMarketHistory });
  if (isValidMarketHistory(restored)) return restored as MarketHistory;
  await quarantineHistory("unreadable, and no snapshot holds a valid copy");
  return { days: {} };
}

export interface MarketHistoryValues {
  vix?: number | null;
  pressure?: number | null;
  pressureComponents?: number;
  components?: MarketHistoryDay["components"];
}

/** Adds one day's values. A value that is null/absent never overwrites one already recorded for that day
 * (the pressure index and its components are replaced together, so they always agree); nothing is written
 * when there is nothing to record. */
export async function recordMarketHistory(date: string, values: MarketHistoryValues): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("invalid history date: " + date);
  await withFileLock(HISTORY_FILE, async () => {
    const history = await readMarketHistory();
    const prev = history.days[date];
    const next: MarketHistoryDay = { ...prev, vix: values.vix ?? prev?.vix ?? null, pressure: prev?.pressure ?? null, recordedAt: new Date().toISOString() };
    // A day recorded from MORE components is not replaced by a later run that managed fewer (a partial index
    // is a different, less complete number); an equal or better one replaces it.
    if (values.pressure !== undefined && values.pressure !== null
      && (prev?.pressure == null || (values.pressureComponents ?? 0) >= (prev.pressureComponents ?? 0))) {
      next.pressure = values.pressure;
      next.pressureComponents = values.pressureComponents;
      next.components = values.components;
    }
    if (next.vix === null && next.pressure === null) return;
    history.days[date] = next;
    const dates = Object.keys(history.days).sort();
    for (const old of dates.slice(0, Math.max(0, dates.length - MAX_HISTORY_DAYS))) delete history.days[old];
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeFileDurable(HISTORY_FILE, JSON.stringify(history));
  });
}

/** The most recent recorded VIX (and the one before it), as a stale reading. */
async function lastKnownVixFromHistory(): Promise<IndicatorReading | null> {
  const history = await readMarketHistory();
  const dates = Object.keys(history.days).filter((d) => history.days[d].vix !== null && history.days[d].vix !== undefined).sort();
  if (dates.length === 0) return null;
  const last = dates[dates.length - 1];
  return {
    value: history.days[last].vix, previous: dates.length >= 2 ? history.days[dates[dates.length - 2]].vix : null,
    source: SOURCE, fetchedAt: null, asOf: last, status: "stale",
  };
}

/** The most recent recorded pressure index with its components, all marked stale and dated. */
async function lastKnownPressureFromHistory(): Promise<PressureIndex | null> {
  const history = await readMarketHistory();
  const dates = Object.keys(history.days).filter((d) => typeof history.days[d].pressure === "number").sort();
  if (dates.length === 0) return null;
  const last = dates[dates.length - 1];
  const day = history.days[last];
  const components: PressureComponent[] = PRESSURE_COMPONENT_IDS.map((id) => {
    const stored = day.components?.[id];
    if (!stored) return missingComponent(id);
    return { ...missingComponent(id), raw: stored.raw, score: stored.score, source: SOURCE, asOf: last, status: "stale" };
  });
  const idx = computePressureIndex(components);
  // An entry with no stored components still has its value; show it, honestly stale.
  return idx.value === null ? { ...idx, value: day.pressure, status: "stale" } : { ...idx, status: "stale" };
}

/** A value fetched within this window of "now" counts as obtained now. */
const OBTAINED_NOW_WINDOW_MS = 2 * 60_000;

/** Called by the daily snapshot job: fetches fresh values (bypassing the cache) and records them under
 * \`date\`. Only values OBTAINED NOW are recorded. A status of "ok" is not enough: it also covers the last
 * good value while it is still within its allowed age, and if this fetch failed that would file an old value
 * under today's date. The pressure index recorded is the one built from the components obtained now only,
 * with how many that was. */
export async function recordDailyMarketHistory(date: string, nowMs: number = Date.now()): Promise<void> {
  const snap = await getMarketSnapshot({ force: true, nowMs });
  const obtainedNow = (iso: string | null): boolean => iso !== null && nowMs - Date.parse(iso) <= OBTAINED_NOW_WINDOW_MS;
  const fresh = snap.pressure.components.map((c) => (c.status === "ok" && obtainedNow(c.fetchedAt) ? c : missingComponent(c.id)));
  const index = computePressureIndex(fresh);
  const components: MarketHistoryDay["components"] = {};
  for (const c of fresh) if (c.score !== null && c.raw !== null) components[c.id] = { raw: c.raw, score: c.score };
  await recordMarketHistory(date, {
    vix: snap.vix.status === "ok" && obtainedNow(snap.vix.fetchedAt) ? snap.vix.value : null,
    pressure: index.value,
    pressureComponents: index.available,
    components,
  });
}
