// 52-week highs for the watchlist (task 10.3). Server-only. The LIVE price comes from the normal
// price refresh (with its ok / stale / missing status, see priceStatus.ts); this adds only what the
// price feed does not give: the highest daily close of the last 52 weeks, from Yahoo's chart API
// through the same retry the rest of the app uses.
//
// Shared across users and cached per symbol: a 52-week high moves slowly, so it is fetched at most
// every few hours per symbol however many users watch it; a symbol Yahoo has no data for is not asked
// again for a while.

import { fetchYahooDailyClosesInRange } from "@/lib/prices";
import { HIGH_WINDOW_DAYS, highestCloseWithin } from "@/lib/marketPressure";
import type { PriceStatus } from "@/lib/priceStatus";

export interface HighReading {
  /** Highest daily close of the last 52 weeks; null when it could not be obtained. */
  high52: number | null;
  /** ISO time WE obtained it. */
  fetchedAt: string | null;
  /** The date of the last close in the series. */
  asOf: string | null;
  status: PriceStatus;
}

export const HIGH_CACHE_TTL_MS = 6 * 60 * 60_000;
export const HIGH_FAILURE_BACKOFF_MS = 10 * 60_000;
/** A high older than this is "stale" (it can only be so if refreshing keeps failing). */
export const HIGH_STALE_AFTER_MS = 36 * 60 * 60_000;
const CONCURRENCY = 5;

const SYMBOL_RE = /^[A-Za-z0-9:_.-]{1,20}$/;

interface Entry { good: HighReading | null; goodAt: number; lastAttemptAt: number; lastOk: boolean }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();

/** For tests: forget everything cached. */
export function resetHighsCache(): void {
  cache.clear();
  inflight.clear();
}

async function fetchHigh(symbol: string, nowMs: number): Promise<HighReading> {
  const sec = Math.floor(nowMs / 1000);
  const closes = await fetchYahooDailyClosesInRange(symbol, sec - (HIGH_WINDOW_DAYS + 7) * 86_400, sec + 86_400);
  if (!closes || closes.c.length === 0) return { high52: null, fetchedAt: null, asOf: null, status: "missing" };
  const high = highestCloseWithin(closes.t, closes.c, sec, HIGH_WINDOW_DAYS);
  if (high === null || !(high > 0)) return { high52: null, fetchedAt: null, asOf: null, status: "missing" };
  return {
    high52: Math.round(high * 100) / 100,
    fetchedAt: new Date(nowMs).toISOString(),
    asOf: new Date(closes.t[closes.t.length - 1] * 1000).toISOString().slice(0, 10),
    status: "ok",
  };
}

async function refreshOne(symbol: string, nowMs: number): Promise<void> {
  const entry = cache.get(symbol) ?? { good: null, goodAt: 0, lastAttemptAt: 0, lastOk: true };
  cache.set(symbol, entry);
  const fresh = entry.good !== null && nowMs - entry.goodAt < HIGH_CACHE_TTL_MS;
  const backingOff = !entry.lastOk && entry.lastAttemptAt > 0 && nowMs - entry.lastAttemptAt < HIGH_FAILURE_BACKOFF_MS;
  if (fresh || backingOff) return;
  let p = inflight.get(symbol);
  if (!p) {
    p = (async () => {
      const reading = await fetchHigh(symbol, nowMs);
      entry.lastAttemptAt = nowMs;
      if (reading.status === "ok") { entry.good = reading; entry.goodAt = nowMs; entry.lastOk = true; }
      else entry.lastOk = false;
    })().finally(() => { inflight.delete(symbol); });
    inflight.set(symbol, p);
  }
  await p;
}

/** The 52-week high of each symbol (upper-cased; invalid symbols are returned as missing, never skipped
 * silently). A failed refresh keeps the last good value, which turns "stale" once it is old. */
export async function getHighs52(symbols: string[], nowMs: number = Date.now()): Promise<Record<string, HighReading>> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));
  const valid = unique.filter((s) => SYMBOL_RE.test(s));
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= valid.length) return;
      await refreshOne(valid[i], nowMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker));

  const out: Record<string, HighReading> = {};
  for (const s of unique) {
    const good = SYMBOL_RE.test(s) ? cache.get(s)?.good ?? null : null;
    if (!good) { out[s] = { high52: null, fetchedAt: null, asOf: null, status: "missing" }; continue; }
    const age = good.fetchedAt === null ? Infinity : nowMs - Date.parse(good.fetchedAt);
    out[s] = { ...good, status: age > HIGH_STALE_AFTER_MS ? "stale" : "ok" };
  }
  return out;
}
