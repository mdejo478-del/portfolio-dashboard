// Market-status data (task 9.2): the VIX from Yahoo's chart API and CNN's Fear & Greed index.
// Server-only. Both are SHARED across all users - one fetch, one cache, one daily history
// file - never per portfolio.
//
// VIX goes through the same Yahoo chart fetch (with its retry/backoff) the rest of the app
// uses. Fear & Greed has NO official API: it reads CNN's unofficial endpoint, is always
// labeled as such, and may stop working or refuse automated requests at any time - then it
// is simply "missing" and the card says "לא זמין" without breaking anything else.

import { promises as fs } from "fs";
import path from "path";
import { withFileLock } from "@/lib/fileLock";
import { writeFileDurable } from "@/lib/durableFile";
import { fetchYahooDailyClosesInRange } from "@/lib/prices";
import {
  FEAR_GREED_STALE_AFTER_MS, VIX_STALE_AFTER_MS, missingReading, readingStatus,
  type IndicatorReading, type MarketSnapshot,
} from "@/lib/marketStatus";

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "market-history.json");
const QUARANTINE_DIR = path.join(DATA_DIR, "corrupted");
const MAX_HISTORY_DAYS = 3_650; // ~10 years of daily points

const FETCH_TIMEOUT_MS = 6_000;
// Unofficial and undocumented; may change or refuse automated requests without notice.
const CNN_FEAR_GREED_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
// Identifies this app honestly instead of pretending to be a browser.
const CLIENT_USER_AGENT = "IPMS-dashboard/1.0 (personal portfolio tracker)";

const VIX_SOURCE = "Yahoo Finance";
const FEAR_GREED_SOURCE = "CNN";

type Kind = "vix" | "fearGreed";

/** How long a successful reading is served without fetching again. */
export const MARKET_CACHE_TTL_MS: Record<Kind, number> = { vix: 5 * 60_000, fearGreed: 15 * 60_000 };
/** After a FAILED fetch, how long before trying again - so an endpoint that refuses us is not hit
 * by every user's every refresh. */
export const MARKET_FAILURE_BACKOFF_MS: Record<Kind, number> = { vix: 2 * 60_000, fearGreed: 10 * 60_000 };
const STALE_AFTER_MS: Record<Kind, number> = { vix: VIX_STALE_AFTER_MS, fearGreed: FEAR_GREED_STALE_AFTER_MS };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- fetching ---------------------------------------------------------------------------------

/** Current VIX and yesterday's close, from the last two daily closes. Missing when Yahoo has no data. */
export async function fetchVix(nowMs: number = Date.now()): Promise<IndicatorReading> {
  const sec = Math.floor(nowMs / 1000);
  // Retried with backoff inside; never throws.
  const closes = await fetchYahooDailyClosesInRange("^VIX", sec - 10 * 86_400, sec + 86_400);
  if (!closes || closes.c.length === 0) return missingReading(VIX_SOURCE, false);
  const n = closes.c.length;
  const last = closes.c[n - 1];
  const prev = n >= 2 ? closes.c[n - 2] : null;
  if (!Number.isFinite(last) || !(last > 0)) return missingReading(VIX_SOURCE, false);
  return {
    value: round2(last),
    previous: prev !== null && Number.isFinite(prev) && prev > 0 ? round2(prev) : null,
    source: VIX_SOURCE, unofficial: false,
    fetchedAt: new Date(nowMs).toISOString(),
    asOf: new Date(closes.t[n - 1] * 1000).toISOString(),
    status: "ok", rating: null,
  };
}

/** Reads CNN's response defensively: anything that is not a score between 0 and 100 is "missing". */
export function parseFearGreed(json: unknown, nowMs: number = Date.now()): IndicatorReading {
  const fg = (json as { fear_and_greed?: Record<string, unknown> } | null)?.fear_and_greed;
  if (!fg || typeof fg !== "object") return missingReading(FEAR_GREED_SOURCE, true);
  const score = typeof fg.score === "number" ? fg.score : Number(fg.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return missingReading(FEAR_GREED_SOURCE, true);
  const prevRaw = typeof fg.previous_close === "number" ? fg.previous_close : Number(fg.previous_close);
  const ts = typeof fg.timestamp === "string" || typeof fg.timestamp === "number" ? Date.parse(String(fg.timestamp)) : NaN;
  return {
    value: round2(score),
    previous: Number.isFinite(prevRaw) && prevRaw >= 0 && prevRaw <= 100 ? round2(prevRaw) : null,
    source: FEAR_GREED_SOURCE, unofficial: true,
    fetchedAt: new Date(nowMs).toISOString(),
    asOf: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    status: "ok",
    rating: typeof fg.rating === "string" && fg.rating.length <= 40 ? fg.rating : null,
  };
}

/** One retry for a rate limit, a server error or a network hiccup. Any other refusal (for example
 * 418/403 - the endpoint rejecting automated requests) will not change by retrying: missing. */
export async function fetchFearGreed(nowMs: number = Date.now()): Promise<IndicatorReading> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(CNN_FEAR_GREED_URL, {
        cache: "no-store",
        headers: { "User-Agent": CLIENT_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) { await sleep(500); continue; }
        return missingReading(FEAR_GREED_SOURCE, true);
      }
      if (!res.ok) return missingReading(FEAR_GREED_SOURCE, true);
      return parseFearGreed(await res.json(), nowMs);
    } catch {
      if (attempt === 0) { await sleep(500); continue; }
    }
  }
  return missingReading(FEAR_GREED_SOURCE, true);
}

// ---- shared cache -----------------------------------------------------------------------------

interface KindState {
  /** The last successfully fetched reading, kept even after a later fetch fails. */
  good: IndicatorReading | null;
  goodAt: number;
  lastAttemptAt: number;
  lastAttemptOk: boolean;
}

const emptyState = (): KindState => ({ good: null, goodAt: 0, lastAttemptAt: 0, lastAttemptOk: true });
const state: Record<Kind, KindState> = { vix: emptyState(), fearGreed: emptyState() };
const inflight: Partial<Record<Kind, Promise<void>>> = {};

/** For tests: forget everything cached. */
export function resetMarketCache(): void {
  state.vix = emptyState();
  state.fearGreed = emptyState();
  delete inflight.vix;
  delete inflight.fearGreed;
}

async function refresh(kind: Kind, nowMs: number, force: boolean): Promise<void> {
  const st = state[kind];
  const fresh = st.good !== null && nowMs - st.goodAt < MARKET_CACHE_TTL_MS[kind];
  const backingOff = !st.lastAttemptOk && st.lastAttemptAt > 0 && nowMs - st.lastAttemptAt < MARKET_FAILURE_BACKOFF_MS[kind];
  if (!force && (fresh || backingOff)) return;
  // Concurrent callers share one fetch.
  if (!inflight[kind]) {
    inflight[kind] = (async () => {
      const reading = kind === "vix" ? await fetchVix(nowMs) : await fetchFearGreed(nowMs);
      st.lastAttemptAt = nowMs;
      if (reading.status === "ok") { st.good = reading; st.goodAt = nowMs; st.lastAttemptOk = true; }
      else st.lastAttemptOk = false;
    })().finally(() => { delete inflight[kind]; });
  }
  await inflight[kind];
}

async function present(kind: Kind, nowMs: number): Promise<IndicatorReading> {
  const st = state[kind];
  // The last good reading, honestly aged: "stale" once it is older than it should be.
  if (st.good) return { ...st.good, status: readingStatus(st.good.value, st.good.fetchedAt, nowMs, STALE_AFTER_MS[kind]) };
  // Nothing fetched since this process started: fall back to the last recorded day, marked stale.
  const known = await lastKnownFromHistory(kind).catch(() => null);
  return known ?? missingReading(kind === "vix" ? VIX_SOURCE : FEAR_GREED_SOURCE, kind === "fearGreed");
}

/** Both indicators, served from a cache shared by every user. A failed fetch never breaks the other
 * indicator, and never discards the last good value (it just ages into "stale"). `force` bypasses the
 * cache (the daily snapshot uses it). */
export async function getMarketSnapshot(opts: { force?: boolean; nowMs?: number } = {}): Promise<MarketSnapshot> {
  const nowMs = opts.nowMs ?? Date.now();
  const force = opts.force ?? false;
  await Promise.all([refresh("vix", nowMs, force), refresh("fearGreed", nowMs, force)]);
  const [vix, fearGreed] = await Promise.all([present("vix", nowMs), present("fearGreed", nowMs)]);
  return { vix, fearGreed };
}

// ---- daily history (shared, not per portfolio) -----------------------------------------------------

export interface MarketHistoryDay {
  vix: number | null;
  fearGreed: number | null;
  recordedAt: string;
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

/** The recorded daily history. A missing file is empty; an unreadable one is kept aside (never silently
 * overwritten) and treated as empty. */
export async function readMarketHistory(): Promise<MarketHistory> {
  let text: string;
  try {
    text = await fs.readFile(HISTORY_FILE, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { days: {} };
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as MarketHistory;
    if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object" && !Array.isArray(parsed.days)) return parsed;
    await quarantineHistory("unexpected shape");
  } catch {
    await quarantineHistory("not valid JSON");
  }
  return { days: {} };
}

/** Adds one day's values. A value that is null/absent never overwrites one already recorded for that day;
 * nothing is written when there is nothing to record. */
export async function recordMarketHistory(date: string, values: { vix?: number | null; fearGreed?: number | null }): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("invalid history date: " + date);
  await withFileLock(HISTORY_FILE, async () => {
    const history = await readMarketHistory();
    const prev = history.days[date];
    const vix = values.vix ?? prev?.vix ?? null;
    const fearGreed = values.fearGreed ?? prev?.fearGreed ?? null;
    if (vix === null && fearGreed === null) return;
    history.days[date] = { vix, fearGreed, recordedAt: new Date().toISOString() };
    const dates = Object.keys(history.days).sort();
    for (const old of dates.slice(0, Math.max(0, dates.length - MAX_HISTORY_DAYS))) delete history.days[old];
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeFileDurable(HISTORY_FILE, JSON.stringify(history));
  });
}

/** The most recent recorded value of one indicator (and the one before it), as a stale reading. */
async function lastKnownFromHistory(kind: Kind): Promise<IndicatorReading | null> {
  const history = await readMarketHistory();
  const dates = Object.keys(history.days).filter((d) => history.days[d][kind] !== null).sort();
  if (dates.length === 0) return null;
  const last = dates[dates.length - 1];
  const before = dates.length >= 2 ? history.days[dates[dates.length - 2]][kind] : null;
  return {
    value: history.days[last][kind], previous: before,
    source: kind === "vix" ? VIX_SOURCE : FEAR_GREED_SOURCE, unofficial: kind === "fearGreed",
    fetchedAt: null, asOf: last, status: "stale", rating: null,
  };
}

/** A value fetched within this window of "now" counts as obtained now. */
const OBTAINED_NOW_WINDOW_MS = 2 * 60_000;

/** Called by the daily snapshot job: fetches fresh values (bypassing the cache) and records them under
 * `date`. Only values actually OBTAINED NOW are recorded. A reading whose status is "ok" is not enough:
 * "ok" also covers the last good value while it is still within its allowed age (30 minutes for the VIX,
 * 6 hours for Fear & Greed), and if this fetch failed that would file an old value under today's date. */
export async function recordDailyMarketHistory(date: string, nowMs: number = Date.now()): Promise<void> {
  const snap = await getMarketSnapshot({ force: true, nowMs });
  const obtainedNow = (r: IndicatorReading): number | null =>
    r.status === "ok" && r.fetchedAt !== null && nowMs - Date.parse(r.fetchedAt) <= OBTAINED_NOW_WINDOW_MS ? r.value : null;
  await recordMarketHistory(date, { vix: obtainedNow(snap.vix), fearGreed: obtainedNow(snap.fearGreed) });
}
