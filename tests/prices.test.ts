// 0.7 / audit finding H6, case 11: per-symbol price status, batching instead of
// slice(0, 50), valuation that never turns a missing price into 0, extended-hours
// prices marked as such. Network is mocked (globalThis.fetch); nothing real is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuotes, derivePriceInfo, describePriceInfo, summarizePriceInfo, fetchQuotesInBatches, chunk, valuePositions,
  STALE_AFTER_MS, QUOTE_BATCH_SIZE, type SymbolQuote, type QuoteMeta,
} from "../src/lib/priceStatus";
import type { QuotesResult } from "../src/lib/prices";

const NOW = Date.parse("2026-03-10T15:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const okQuote = (price: number, msAgo = 0, extra: Partial<SymbolQuote> = {}): SymbolQuote =>
  ({ price, source: "finnhub", session: "regular", regularPrice: price, fetchedAt: iso(msAgo), failure: null, ...extra });
const noQuote = (failure: SymbolQuote["failure"] = "error"): SymbolQuote =>
  ({ price: null, source: null, session: "regular", regularPrice: null, fetchedAt: null, failure });
const meta = (msAgo: number, extra: Partial<QuoteMeta> = {}): QuoteMeta =>
  ({ fetchedAt: iso(msAgo), source: "finnhub", session: "regular", regularPrice: 100, ...extra });

// ---- case 11: a price that did not arrive ------------------------------------------

test("case 11: a symbol that got no price keeps its OLD update time; only symbols that got one move", () => {
  const before = { NVDA: meta(5 * 60_000), AAPL: meta(5 * 60_000) };
  const after = applyQuotes(before, { NVDA: noQuote("rate-limited"), AAPL: okQuote(190) });
  assert.equal(after.NVDA.fetchedAt, before.NVDA.fetchedAt, "NVDA was NOT marked as just updated");
  assert.equal(after.AAPL.fetchedAt, iso(0), "AAPL was");
  assert.deepEqual(applyQuotes({}, { NVDA: noQuote() }), {}, "a symbol that never got a price has no update time at all");
  assert.deepEqual(applyQuotes({}, { X: okQuote(0) }), {}, "a zero 'price' is not a price");
});

test("case 11: the status of a symbol without a price is stale/missing - never ok, never 0", () => {
  const done = { completedAt: NOW };
  // Had a price earlier this session, then requests started failing for 12 minutes.
  const stale = derivePriceInfo(120, meta(STALE_AFTER_MS + 2 * 60_000), done);
  assert.equal(stale.status, "stale");
  assert.equal(stale.updatedAt, iso(STALE_AFTER_MS + 2 * 60_000), "shows when it was last good");
  // One failed cycle (75s) is not stale yet.
  assert.equal(derivePriceInfo(120, meta(150_000), done).status, "ok");
  // Price saved from a previous session, never refreshed in this one.
  const carried = derivePriceInfo(120, undefined, done);
  assert.equal(carried.status, "stale");
  assert.equal(carried.updatedAt, null);
  // No price at all.
  assert.equal(derivePriceInfo(null, undefined, done).status, "missing");
  assert.equal(derivePriceInfo(0, undefined, done).status, "missing", "0 is not a price");
  // Before the first refresh cycle finishes nothing is declared stale/missing.
  assert.equal(derivePriceInfo(120, undefined, { completedAt: null }).status, "pending");
  assert.equal(derivePriceInfo(null, undefined, { completedAt: null }).status, "pending");
});

test("status carries source and time, and says so in Hebrew", () => {
  const ok = derivePriceInfo(190, meta(30_000), { completedAt: NOW });
  assert.equal(ok.status, "ok");
  assert.equal(ok.source, "finnhub");
  const text = describePriceInfo(ok);
  assert.ok(text.includes("תקין") && text.includes("Finnhub") && text.includes("עודכן"), text);
  assert.ok(describePriceInfo(derivePriceInfo(120, undefined, { completedAt: NOW })).startsWith("ישן"));
  assert.ok(describePriceInfo(derivePriceInfo(null, undefined, { completedAt: NOW })).startsWith("חסר"));
});

// ---- extended hours ------------------------------------------------------------------

test("an extended-hours price is flagged as such (and the regular close is kept)", () => {
  const q = okQuote(192, 0, { source: "yahoo-extended", session: "pre", regularPrice: 190 });
  const info = derivePriceInfo(192, applyQuotes({}, { AAPL: q }).AAPL, { completedAt: NOW });
  assert.equal(info.status, "ok");
  assert.equal(info.session, "pre");
  assert.equal(info.regularPrice, 190);
  assert.ok(describePriceInfo(info).includes("מחיר מסחר מורחב"), describePriceInfo(info));
  const regular = describePriceInfo(derivePriceInfo(190, meta(0), { completedAt: NOW }));
  assert.ok(!regular.includes("מורחב"), "a regular price is not labeled extended");
  assert.deepEqual(summarizePriceInfo([info, derivePriceInfo(1, meta(0), { completedAt: NOW }), derivePriceInfo(null, undefined, { completedAt: NOW })]), { ok: 2, stale: 0, missing: 1, extended: 1 });
});

// ---- batching: nothing cut off at 50 -----------------------------------------------------

const quotesFor = (symbols: string[]): QuotesResult => ({
  configured: true,
  prices: Object.fromEntries(symbols.map((s) => [s, 100])),
  dayChangePct: Object.fromEntries(symbols.map((s) => [s, 0.01])),
  extended: Object.fromEntries(symbols.map((s) => [s, null])),
  quotes: Object.fromEntries(symbols.map((s) => [s, okQuote(100)])),
});

test("80 symbols are all priced: sent in batches, merged, none dropped (old code cut at 50)", async () => {
  const symbols = Array.from({ length: 80 }, (_, i) => "S" + i);
  const sizes: number[] = [];
  const res = await fetchQuotesInBatches(symbols, async (batch) => { sizes.push(batch.length); return quotesFor(batch); });
  assert.equal(Object.keys(res.quotes).length, 80);
  assert.equal(Object.keys(res.prices).length, 80);
  assert.ok(sizes.every((n) => n <= QUOTE_BATCH_SIZE), "no request is bigger than a batch: " + sizes);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 80);
  assert.ok(Math.max(...sizes) <= 50, "stays under the server's per-request cap");
  assert.deepEqual(res.failedSymbols, []);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("a batch that fails outright is reported while the other batches still apply", async () => {
  const symbols = Array.from({ length: 60 }, (_, i) => "S" + i);
  let call = 0;
  const res = await fetchQuotesInBatches(symbols, async (batch) => { if (++call === 2) throw new Error("boom"); return quotesFor(batch); }, 25);
  assert.equal(res.failedSymbols.length, 25, "the second batch's symbols");
  assert.equal(Object.keys(res.quotes).length, 35);
  assert.ok(res.failedSymbols.every((s) => !(s in res.quotes)));
});

test("not configured stops immediately; an empty portfolio still asks once", async () => {
  let calls = 0;
  const off = await fetchQuotesInBatches(["A", "B", "C"], async () => { calls++; return { configured: false, prices: {}, dayChangePct: {}, extended: {}, quotes: {} }; }, 1);
  assert.equal(off.configured, false);
  assert.equal(calls, 1, "does not keep asking once the server says pricing is not configured");
  let emptyCalls = 0;
  const none = await fetchQuotesInBatches([], async (b) => { emptyCalls++; return quotesFor(b); });
  assert.equal(emptyCalls, 1);
  assert.equal(none.configured, true);
});

// ---- daily snapshot valuation: a missing price is not 0 ------------------------------------

test("snapshot valuation: missing price uses the last known price and is flagged, never 0", () => {
  const positions = [
    { symbol: "CASH", qty: null, price: null, value: 1000 },
    { symbol: "AAA", qty: 10, price: 50, value: 500 },     // live price arrives
    { symbol: "BBB", qty: 10, price: 80, value: 800 },     // no live price -> last known 80
    { symbol: "CCC", qty: 4, price: null, value: 400 },    // never had a price -> last known value 400
    { symbol: "DDD", qty: null, price: null, value: 250 }, // no quantity -> its value
  ];
  const v = valuePositions(positions, { AAA: 60, BBB: null });
  assert.equal(v.total, 1000 + 600 + 800 + 400 + 250);
  assert.deepEqual(v.staleSymbols, ["BBB", "CCC"]);
  // The previous formula, p.qty * (livePrice ?? p.price ?? 0): a position that never had a price counted as 0.
  const live: Record<string, number | null> = { AAA: 60, BBB: null };
  const oldTotal = positions.reduce((sum, p) => sum + (p.symbol === "CASH" ? p.value : p.qty !== null ? p.qty * (live[p.symbol] ?? p.price ?? 0) : p.value), 0);
  assert.equal(oldTotal, 1000 + 600 + 800 + 0 + 250, "old logic dropped CCC (400) to 0");
  assert.equal(v.total - oldTotal, 400);
  assert.deepEqual(valuePositions(positions, { AAA: 60, BBB: 85, CCC: 11 }).staleSymbols, [], "nothing stale when every quote arrived");
});

// ---- the real getQuotes against a mocked network ----------------------------------------------

process.env.FINNHUB_API_KEY = "test-key";
const realFetch = globalThis.fetch;
const calls: Record<string, number> = {};
let inFlight = 0;
let maxInFlight = 0;
const tNow = Math.floor(Date.now() / 1000);

function yahooPre(regular: number, last: number): unknown {
  const start = tNow - 7200;
  return { chart: { result: [{
    meta: { regularMarketPrice: regular, currentTradingPeriod: { pre: { start, end: tNow + 3600 }, regular: { start: tNow + 3600, end: tNow + 7200 }, post: { start: tNow + 7200, end: tNow + 9000 } } },
    timestamp: [tNow - 120, tNow - 60], indicators: { quote: [{ close: [last - 0.5, last] }] },
  }] } };
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await new Promise((r) => setTimeout(r, 2));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("finnhub.io") && url.includes("/quote")) {
      const sym = new URL(url).searchParams.get("symbol") as string;
      calls[sym] = (calls[sym] || 0) + 1;
      if (sym === "NVDA") return json({}, 500);
      if (sym === "RATE") return json({}, 429);
      if (sym === "FLAKY") return calls[sym] === 1 ? json({}, 429) : json({ c: 55, dp: 0.5 });
      if (sym === "BADX") return json({ c: 0, dp: 0 });
      if (sym === "AAPL") return json({ c: 190, dp: 1.2 });
      return json({ c: 100, dp: 0 });
    }
    if (url.includes("query1.finance.yahoo.com")) {
      return url.includes("/AAPL?") ? json(yahooPre(190, 192)) : json({}, 404);
    }
    return json({}, 404);
  } finally { inFlight--; }
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

test("getQuotes: per-symbol outcome - failures say why, extended tick is flagged, nothing becomes 0", async () => {
  const { getQuotes } = await import("../src/lib/prices");
  const r = await getQuotes(["AAPL", "NVDA", "RATE", "FLAKY", "BADX", "MSFT"]);
  assert.equal(r.configured, true);

  assert.equal(r.quotes.NVDA.price, null);
  assert.equal(r.quotes.NVDA.failure, "error");
  assert.equal(r.quotes.NVDA.fetchedAt, null, "no price = no 'updated at'");
  assert.equal(r.prices.NVDA, null, "missing, not 0");
  assert.equal(r.quotes.RATE.failure, "rate-limited");
  assert.equal(r.quotes.BADX.failure, "no-data");
  assert.equal(calls.NVDA, 2, "a server error is retried once");

  assert.equal(r.quotes.FLAKY.price, 55, "a rate limit is retried and recovers");
  assert.equal(calls.FLAKY, 2);

  const aapl = r.quotes.AAPL;
  assert.equal(aapl.price, 192, "valued at the extended-hours tick, as before");
  assert.equal(aapl.session, "pre");
  assert.equal(aapl.source, "yahoo-extended");
  assert.equal(aapl.regularPrice, 190, "the regular price is kept alongside");
  assert.ok(aapl.fetchedAt && !Number.isNaN(Date.parse(aapl.fetchedAt)));
  assert.equal(r.prices.AAPL, 190, "prices[] is still the regular-session price");
  assert.equal(r.extended.AAPL?.price, 192);

  assert.equal(r.quotes.MSFT.session, "regular");
  assert.equal(r.quotes.MSFT.source, "finnhub");
});

test("getQuotes: 80 symbols all come back, and requests are paced instead of all fired at once", async () => {
  const { getQuotes } = await import("../src/lib/prices");
  const symbols = Array.from({ length: 80 }, (_, i) => "Z" + i);
  maxInFlight = 0;
  const r = await getQuotes(symbols);
  assert.equal(Object.keys(r.quotes).length, 80);
  assert.ok(symbols.every((s) => r.quotes[s].price === 100));
  assert.ok(maxInFlight <= 16, "at most 8 symbols x 2 requests in flight, saw " + maxInFlight);
});
