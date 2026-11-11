// Per-symbol price status (audit finding H6): a price is OK, STALE or MISSING,
// and the UI/snapshot say which instead of silently treating an old or absent
// price as current (or as 0). Pure and framework-agnostic - no Node APIs, only
// type imports - so it runs in the browser bundle, on the server and under the
// test runner.

import type { QuotesResult } from "./prices";

export type PriceStatus = "ok" | "stale" | "missing";
export type QuoteSource = "finnhub" | "yahoo-extended";
/** "regular" = the normal session price; "pre"/"post" = an extended-hours tick. */
export type QuoteSession = "regular" | "pre" | "post";
export type QuoteFailure = "rate-limited" | "no-data" | "error" | "over-limit";

/** What the server learned about one symbol in one fetch. */
export interface SymbolQuote {
  /** The price to value the position at: the extended-hours tick while the
   * market is in pre/post, otherwise the regular quote. null = none obtained. */
  price: number | null;
  /** Where `price` came from; null when there is no price. */
  source: QuoteSource | null;
  session: QuoteSession;
  /** The regular-session price (when the provider returned one) - kept so an
   * extended-hours price can be shown next to the close it differs from. */
  regularPrice: number | null;
  /** ISO time the server obtained `price`; null when there is none. */
  fetchedAt: string | null;
  /** Why there is no price; null when there is one. */
  failure: QuoteFailure | null;
}

/** The last SUCCESSFUL quote the client got for a symbol. It is only ever
 * replaced by a newer successful quote, so a symbol that stops receiving
 * prices keeps its old time instead of looking freshly updated. */
export interface QuoteMeta {
  fetchedAt: string;
  source: QuoteSource;
  session: QuoteSession;
  regularPrice: number | null;
}

/** Folds one fetch into the per-symbol record: only symbols that actually got a
 * price are updated (the rest keep their previous meta, if any). */
export function applyQuotes(prev: Record<string, QuoteMeta>, quotes: Record<string, SymbolQuote>): Record<string, QuoteMeta> {
  const next: Record<string, QuoteMeta> = { ...prev };
  for (const [symbol, q] of Object.entries(quotes)) {
    if (q.price === null || !(q.price > 0) || q.fetchedAt === null || q.source === null) continue;
    next[symbol] = { fetchedAt: q.fetchedAt, source: q.source, session: q.session, regularPrice: q.regularPrice };
  }
  return next;
}

/** A price older than this (measured between its last successful fetch and the
 * latest refresh cycle) is stale. Prices refresh every 75 seconds, so this is
 * several consecutive failed cycles - not one dropped request. */
export const STALE_AFTER_MS = 10 * 60_000;

export interface PriceInfo {
  /** "pending" only before the first refresh cycle of the session has finished. */
  status: PriceStatus | "pending";
  source: QuoteSource | null;
  session: QuoteSession;
  /** ISO time of this symbol's last successful price; null if none this session. */
  updatedAt: string | null;
  regularPrice: number | null;
}

/** Status of one position's price. `cycle.completedAt` is when the latest
 * refresh cycle finished (ms), so the result depends on data only - never on
 * the wall clock at render time. */
export function derivePriceInfo(price: number | null | undefined, meta: QuoteMeta | undefined, cycle: { completedAt: number | null }): PriceInfo {
  const known = typeof price === "number" && Number.isFinite(price) && price > 0;
  if (cycle.completedAt === null && !meta) {
    return { status: "pending", source: null, session: "regular", updatedAt: null, regularPrice: null };
  }
  if (!known) {
    return { status: "missing", source: meta ? meta.source : null, session: meta ? meta.session : "regular", updatedAt: meta ? meta.fetchedAt : null, regularPrice: meta ? meta.regularPrice : null };
  }
  if (!meta) {
    // A price saved from an earlier session that no refresh has replaced yet.
    return { status: "stale", source: null, session: "regular", updatedAt: null, regularPrice: null };
  }
  const fetched = Date.parse(meta.fetchedAt);
  const age = cycle.completedAt !== null && Number.isFinite(fetched) ? cycle.completedAt - fetched : 0;
  return { status: age > STALE_AFTER_MS ? "stale" : "ok", source: meta.source, session: meta.session, updatedAt: meta.fetchedAt, regularPrice: meta.regularPrice };
}

export interface PriceSummary { ok: number; stale: number; missing: number; extended: number }

export function summarizePriceInfo(infos: PriceInfo[]): PriceSummary {
  const s: PriceSummary = { ok: 0, stale: 0, missing: 0, extended: 0 };
  for (const i of infos) {
    if (i.status === "ok") s.ok++;
    else if (i.status === "stale") s.stale++;
    else if (i.status === "missing") s.missing++;
    if (i.status !== "pending" && i.session !== "regular") s.extended++;
  }
  return s;
}

export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = { ok: "תקין", stale: "ישן", missing: "חסר" };
const SOURCE_LABEL: Record<QuoteSource, string> = { finnhub: "Finnhub", "yahoo-extended": "Yahoo (מסחר מורחב)" };
export const SESSION_LABEL: Record<Exclude<QuoteSession, "regular">, string> = { pre: "טרום-פתיחה", post: "אחרי סגירה" };

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("he-IL");
}

/** One-line Hebrew explanation of a symbol's price state, for tooltips. */
export function describePriceInfo(info: PriceInfo): string {
  if (info.status === "pending") return "טוען מחיר...";
  const time = clock(info.updatedAt);
  const parts: string[] = [PRICE_STATUS_LABEL[info.status]];
  if (info.status === "missing") {
    parts.push(time ? "לא התקבל מחיר עדכני; המחיר האחרון שהתקבל היה ב-" + time : "לא התקבל מחיר לנכס זה");
  } else if (info.status === "stale") {
    parts.push(time ? "לא התקבל מחיר חדש מאז " + time : "מחיר שמור מהפעם הקודמת - עדיין לא התקבל מחיר חדש");
  } else {
    if (info.source) parts.push("מקור: " + SOURCE_LABEL[info.source]);
    if (time) parts.push("עודכן " + time);
  }
  if (info.status !== "missing" && info.session !== "regular") {
    parts.push("מחיר מסחר מורחב (" + SESSION_LABEL[info.session] + ") - פחות אמין ממחיר סשן רגיל");
  }
  return parts.join(" · ");
}

// ---- batching ---------------------------------------------------------------

/** Symbols per server request. The server also caps a request, so a portfolio
 * larger than the cap is sent in several requests rather than cut short. */
export const QUOTE_BATCH_SIZE = 25;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface BatchedQuotes extends QuotesResult {
  /** Symbols whose request failed outright (the whole batch call threw). */
  failedSymbols: string[];
}

/** Fetches every symbol, in sequential batches, and merges the results. Nothing
 * is cut off: a batch that fails is reported in `failedSymbols` while the other
 * batches still apply. `configured` is false as soon as any batch says so. */
export async function fetchQuotesInBatches(
  symbols: string[],
  fetchBatch: (batch: string[]) => Promise<QuotesResult>,
  size: number = QUOTE_BATCH_SIZE,
): Promise<BatchedQuotes> {
  const merged: BatchedQuotes = { configured: true, prices: {}, dayChangePct: {}, extended: {}, quotes: {}, failedSymbols: [] };
  const batches = chunk(Array.from(new Set(symbols)), size);
  // Even with nothing to price, ask once: the answer to "is live pricing
  // configured at all?" comes from the server.
  if (batches.length === 0) batches.push([]);
  for (const batch of batches) {
    let res: QuotesResult;
    try {
      res = await fetchBatch(batch);
    } catch {
      merged.failedSymbols.push(...batch);
      continue;
    }
    if (!res.configured) return { ...merged, configured: false };
    Object.assign(merged.prices, res.prices);
    Object.assign(merged.dayChangePct, res.dayChangePct);
    Object.assign(merged.extended, res.extended);
    Object.assign(merged.quotes, res.quotes);
  }
  return merged;
}

// ---- valuation without inventing zeros ---------------------------------------

export interface ValuablePosition { symbol: string; qty: number | null; price: number | null; value: number }

export interface Valuation {
  total: number;
  /** Symbols valued at their last KNOWN price/value because no fresh quote arrived. */
  staleSymbols: string[];
}

/** Total portfolio value for the daily snapshot. A symbol without a fresh price
 * is valued at its last known price, or - if it never had one - its last known
 * value; it is never counted as 0 just because a quote is missing. Such symbols
 * are returned so the snapshot can be marked as partly estimated. */
export function valuePositions(positions: ValuablePosition[], livePrices: Record<string, number | null | undefined>): Valuation {
  let total = 0;
  const staleSymbols: string[] = [];
  for (const p of positions) {
    if (p.symbol === "CASH" || p.qty === null) { total += p.value; continue; }
    const live = livePrices[p.symbol];
    if (typeof live === "number" && live > 0) { total += p.qty * live; continue; }
    staleSymbols.push(p.symbol);
    total += typeof p.price === "number" && p.price > 0 ? p.qty * p.price : p.value;
  }
  return { total, staleSymbols };
}
