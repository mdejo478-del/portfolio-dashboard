// 10.3 - the watchlist: the numbers next to the price, sorting, creating and editing items, validation
// (shape and meaning, in Hebrew), saving through the existing revision check, 52-week highs (mocked
// network), and that it never touches holdings, weights, cash or the health score.
// Disk work runs in a throwaway temp directory - never touching the real data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { makeWatchlistItem, newWatchlistId, sortWatchlist, watchlistMetrics, type WatchlistInput } from "../src/lib/watchlist";
import { errorsOf, isValidPortfolioData, newErrors, validatePortfolio, validateWatchlistItem } from "../src/lib/validation";
import type { PortfolioData, WatchlistItem } from "../src/lib/portfolioTypes";

const HEBREW = /[֐-׿]/;
const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const item = (o: Partial<WatchlistItem> = {}): WatchlistItem => ({
  id: "w_1", symbol: "AMD", name: "AMD", assetType: "STOCK", entryPrice: 100, targetWeight: 0.05, interest: 3,
  thesis: "", notes: "", createdAt: "2026-03-01T10:00:00.000Z", updatedAt: "2026-03-01T10:00:00.000Z", ...o,
});
const input = (o: Partial<WatchlistInput> = {}): WatchlistInput =>
  ({ symbol: " amd ", name: " Advanced Micro ", assetType: "STOCK", entryPrice: 100, targetWeight: 0.05, interest: 4, thesis: " AI ", notes: " later ", ...o });
const portfolio = (o: Partial<PortfolioData> = {}): PortfolioData =>
  ({ positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 1, ...o });

// ---- the numbers -------------------------------------------------------------------------------------

test("metrics: the drop from the 52-week high and the distance from the desired entry price", () => {
  const m = watchlistMetrics({ entryPrice: 100 }, 90, 120);
  near(m.dropFromHigh, 0.25);
  near(m.distanceToEntry, -0.1);
  assert.equal(m.high, 120);
  near(watchlistMetrics({ entryPrice: 100 }, 130, 200).distanceToEntry, 0.3, 1e-9);
  assert.equal(watchlistMetrics({ entryPrice: 100 }, 100, 100).distanceToEntry, 0, "exactly at the entry price");
  assert.equal(watchlistMetrics({ entryPrice: 100 }, 100, 100).dropFromHigh, 0, "and exactly at the high");
});

test("metrics: a price above the stored high is a new high (the stored one is old); missing inputs give null, never 0", () => {
  const up = watchlistMetrics({ entryPrice: 100 }, 130, 120);
  assert.equal(up.high, 130);
  assert.equal(up.dropFromHigh, 0);
  assert.deepEqual(watchlistMetrics({ entryPrice: 100 }, null, 120), { high: 120, dropFromHigh: null, distanceToEntry: null }, "no live price");
  assert.deepEqual(watchlistMetrics({ entryPrice: null }, 90, 120), { high: 120, dropFromHigh: 0.25, distanceToEntry: null }, "no desired entry price");
  assert.deepEqual(watchlistMetrics({ entryPrice: 100 }, 90, null), { high: null, dropFromHigh: null, distanceToEntry: -0.1 }, "no high");
  assert.deepEqual(watchlistMetrics({ entryPrice: 0 }, 90, 120).distanceToEntry, null, "a zero entry price is not a price");
  assert.equal(watchlistMetrics({ entryPrice: 100 }, 0, 120).dropFromHigh, null, "a zero price is not a price");
  assert.equal(watchlistMetrics({ entryPrice: 100 }, NaN, 120).dropFromHigh, null);
});

// ---- sorting -------------------------------------------------------------------------------------------

test("sorting by the fall from the high, by the distance from the entry price, and by the order added", () => {
  const items = [
    item({ id: "a", symbol: "AAA", createdAt: "2026-03-01T00:00:00Z" }),
    item({ id: "b", symbol: "BBB", createdAt: "2026-03-02T00:00:00Z" }),
    item({ id: "c", symbol: "CCC", createdAt: "2026-03-03T00:00:00Z" }),
    item({ id: "d", symbol: "DDD", createdAt: "2026-03-04T00:00:00Z" }),
  ];
  const metrics = {
    AAA: { high: 100, dropFromHigh: 0.1, distanceToEntry: 0.2 },
    BBB: { high: 100, dropFromHigh: 0.4, distanceToEntry: -0.05 },
    CCC: { high: 100, dropFromHigh: 0.25, distanceToEntry: 0.0 },
    // DDD has no figures at all (no price yet)
  };
  const ids = (s: ReturnType<typeof sortWatchlist>) => s.map((i) => i.symbol).join(",");
  assert.equal(ids(sortWatchlist(items, metrics, "added")), "AAA,BBB,CCC,DDD");
  assert.equal(ids(sortWatchlist(items, metrics, "drop")), "BBB,CCC,AAA,DDD", "the biggest fall first, no data last");
  assert.equal(ids(sortWatchlist(items, metrics, "entry")), "BBB,CCC,AAA,DDD", "already BELOW the entry price first, then the closest above");
  const before = JSON.stringify(items);
  sortWatchlist(items, metrics, "drop");
  assert.equal(JSON.stringify(items), before, "the list itself is not reordered");
  // Ties break by symbol; items without a figure keep the order they were added in.
  const tie = [item({ id: "x", symbol: "ZZZ", createdAt: "2026-03-01T00:00:00Z" }), item({ id: "y", symbol: "AAA", createdAt: "2026-03-02T00:00:00Z" })];
  assert.equal(ids(sortWatchlist(tie, { ZZZ: { high: 1, dropFromHigh: 0.2, distanceToEntry: 0 }, AAA: { high: 1, dropFromHigh: 0.2, distanceToEntry: 0 } }, "drop")), "AAA,ZZZ");
  assert.equal(ids(sortWatchlist(tie, {}, "drop")), "ZZZ,AAA", "no figures for either: the order added");
});

// ---- creating and editing ------------------------------------------------------------------------------------

test("a new item: symbol upper-cased, text trimmed, own id, created = updated", () => {
  const now = "2026-03-10T12:00:00.000Z";
  const w = makeWatchlistItem(input(), now);
  assert.deepEqual([w.symbol, w.name, w.thesis, w.notes, w.createdAt, w.updatedAt, w.interest], ["AMD", "Advanced Micro", "AI", "later", now, now, 4]);
  assert.ok(w.id.startsWith("w_") && w.id.length > 6);
  assert.equal(new Set(Array.from({ length: 200 }, () => newWatchlistId())).size, 200, "ids don't collide");
});

test("editing keeps the id and the creation time and moves only the update time", () => {
  const original = makeWatchlistItem(input(), "2026-03-01T00:00:00.000Z");
  const edited = makeWatchlistItem(input({ interest: 5, entryPrice: 90 }), "2026-03-09T00:00:00.000Z", original);
  assert.deepEqual([edited.id, edited.createdAt, edited.updatedAt, edited.interest, edited.entryPrice], [original.id, "2026-03-01T00:00:00.000Z", "2026-03-09T00:00:00.000Z", 5, 90]);
  assert.equal(original.interest, 4, "the original is not modified");
});

// ---- validation -------------------------------------------------------------------------------------------------

test("shape: a good list is accepted; wrong types, an unknown asset type and too many items are refused", () => {
  assert.equal(isValidPortfolioData(portfolio({ watchlist: [item(), item({ id: "w_2", symbol: "NVDA" })] })), true);
  assert.equal(isValidPortfolioData(portfolio()), true, "files without a watchlist are fine");
  assert.equal(isValidPortfolioData(portfolio({ watchlist: [] })), true);
  const bad = (o: object) => isValidPortfolioData({ ...portfolio(), watchlist: [{ ...item(), ...o }] });
  assert.equal(bad({ assetType: "BOND" }), false);
  assert.equal(bad({ interest: "3" }), false);
  assert.equal(bad({ entryPrice: "100" }), false);
  assert.equal(bad({ symbol: "" }), false);
  assert.equal(bad({ id: "" }), false);
  assert.equal(bad({ thesis: "x".repeat(5001) }), false);
  assert.equal(isValidPortfolioData({ ...portfolio(), watchlist: "nope" }), false);
  assert.equal(isValidPortfolioData({ ...portfolio(), watchlist: Array.from({ length: 201 }, (_, i) => item({ id: "w" + i, symbol: "S" + i })) }), false);
});

test("meaning: entry price, target weight, interest and dates - each refusal explained in Hebrew", () => {
  const codes = (w: WatchlistItem) => errorsOf(validateWatchlistItem(w)).map((i) => i.code);
  assert.deepEqual(codes(item()), [], "a normal item");
  assert.deepEqual(codes(item({ entryPrice: null, targetWeight: null })), [], "both are optional");
  assert.deepEqual(codes(item({ entryPrice: 0 })), ["watch-entry-invalid"]);
  assert.deepEqual(codes(item({ entryPrice: -5 })), ["watch-entry-invalid"]);
  assert.deepEqual(codes(item({ targetWeight: 0 })), ["watch-weight-invalid"]);
  assert.deepEqual(codes(item({ targetWeight: 1.5 })), ["watch-weight-invalid"]);
  assert.deepEqual(codes(item({ targetWeight: 1 })), [], "100% is allowed");
  for (const interest of [0, 6, 2.5, -1, NaN]) assert.deepEqual(codes(item({ interest })), ["watch-interest-invalid"], "interest " + interest);
  for (const interest of [1, 2, 3, 4, 5]) assert.deepEqual(codes(item({ interest })), []);
  assert.deepEqual(codes(item({ createdAt: "yesterday" })), ["watch-date-invalid"]);
  for (const i of validateWatchlistItem(item({ entryPrice: 0, targetWeight: 3, interest: 9 }))) assert.ok(HEBREW.test(i.message) && i.message.includes("AMD"), i.code);
  const odd = validateWatchlistItem(item({ symbol: "תל אביב" }));
  assert.deepEqual(odd.map((i) => [i.code, i.severity]), [["symbol-chars", "warning"]], "an odd symbol is flagged, not refused");
});

test("across the list: the same symbol twice (any case) and a shared id are refused; a symbol that is also held is fine", () => {
  const codes = (w: WatchlistItem[], positions: PortfolioData["positions"] = []) => errorsOf(validatePortfolio(portfolio({ watchlist: w, positions, nextPositionId: 9 }))).map((i) => i.code);
  assert.deepEqual(codes([item({ id: "a", symbol: "AMD" }), item({ id: "b", symbol: "amd" })]), ["watch-duplicate-symbol"]);
  assert.deepEqual(codes([item({ id: "a", symbol: "AMD" }), item({ id: "a", symbol: "NVDA" })]), ["watch-duplicate-id"]);
  const held = [{ id: 1, symbol: "AMD", qty: 5, price: 100, value: 500, weight: 1, dev: 0, min: 0.05, max: 0.5, dilute: 0.6 }];
  assert.deepEqual(codes([item({ symbol: "AMD" })], held), [], "watching something you also hold raises nothing");
});

test("an existing problem does not block saving, a new one is refused (same rule as the rest of the data)", () => {
  const before = validatePortfolio(portfolio({ watchlist: [item({ symbol: "AMD", entryPrice: -1 })] }));
  const sameProblem = validatePortfolio(portfolio({ watchlist: [item({ symbol: "AMD", entryPrice: -2 }), item({ id: "w_2", symbol: "NVDA" })] }));
  assert.deepEqual(newErrors(sameProblem, before), [], "AMD's bad entry price was already there");
  const worse = validatePortfolio(portfolio({ watchlist: [item({ symbol: "AMD", entryPrice: -1 }), item({ id: "w_2", symbol: "NVDA", interest: 9 })] }));
  assert.deepEqual(newErrors(worse, before).map((i) => i.code), ["watch-interest-invalid"], "another item's new problem is not hidden by it");
});

// ---- saved with the portfolio, through the revision check ------------------------------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // the data modules resolve data/ from cwd at import time
const DATA = path.join(dir, "data");
mkdirSync(path.join(DATA, "portfolios"), { recursive: true });
const writeStored = (uid: string, data: Record<string, unknown>) =>
  writeFileSync(path.join(DATA, "portfolios", uid + ".json"), JSON.stringify({ equityHistory: [], alertAcks: {}, schemaVersion: 1, ...data }));
const POS = { id: 1, symbol: "NVDA", qty: 10, price: 100, value: 1000, weight: 1, dev: 0, min: 0.05, max: 0.5, dilute: 0.6 };
const base = { positions: [POS], trades: [], ledger: {}, nextPositionId: 2, nextTradeId: 1 };

test("saved with the portfolio: persisted, revision-protected, and a stale tab cannot overwrite it", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-2222-4222-8222-000000000001";
  writeStored(uid, base);
  assert.equal((await getPortfolio(uid)).watchlist, undefined, "a file from before the watchlist loads as it is");

  const list = [item({ id: "w_1", symbol: "AMD" }), item({ id: "w_2", symbol: "TSM", assetType: "ETF" })];
  assert.deepEqual(await savePortfolio(uid, { ...base, watchlist: list }, 0), { ok: true, revision: 1 });
  assert.deepEqual((await getPortfolio(uid)).watchlist, list);

  // A tab still on revision 0 cannot wipe the list.
  const stale = await savePortfolio(uid, { ...base, watchlist: [] }, 0);
  assert.deepEqual(stale, { ok: false, reason: "conflict", currentRevision: 1 });
  assert.deepEqual((await getPortfolio(uid)).watchlist, list, "the list survived");

  // A save that doesn't mention the watchlist (an older client) leaves it alone; an explicit empty list clears it.
  assert.deepEqual(await savePortfolio(uid, base, 1), { ok: true, revision: 2 });
  assert.deepEqual((await getPortfolio(uid)).watchlist, list);
  assert.deepEqual(await savePortfolio(uid, { ...base, watchlist: [] }, 2), { ok: true, revision: 3 });
  assert.deepEqual((await getPortfolio(uid)).watchlist, []);
});

test("no schema migration was needed: a version-1 file stays version 1 and no pre-migration copy is made", async () => {
  const { savePortfolio, getPortfolio, loadPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-2222-4222-8222-000000000002";
  writeStored(uid, base);
  await loadPortfolio(uid);
  await savePortfolio(uid, { ...base, watchlist: [item()] }, 0);
  assert.equal((await getPortfolio(uid)).schemaVersion, 1);
  const copies = (() => { try { return readdirSync(path.join(DATA, "pre-migration")).filter((f) => f.startsWith(uid)); } catch { return []; } })();
  assert.deepEqual(copies, []);
});

test("invalid items are refused on save with the Hebrew reason - but an existing bad item never locks the list", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-2222-4222-8222-000000000003";
  writeStored(uid, base);
  const refused = await savePortfolio(uid, { ...base, watchlist: [item({ entryPrice: -4 })] }, 0);
  assert.ok(!refused.ok && refused.reason === "invalid" && HEBREW.test(refused.message) && refused.message.includes("AMD"), JSON.stringify(refused));
  assert.equal((await getPortfolio(uid)).watchlist, undefined, "nothing was written");

  // A list that already contains a bad item (written before these checks) loads and can still be edited.
  const legacy = [item({ id: "w_1", symbol: "AMD", entryPrice: -4 }), item({ id: "w_2", symbol: "NVDA" })];
  writeStored(uid, { ...base, watchlist: legacy });
  const loaded = await getPortfolio(uid);
  assert.equal(loaded.watchlist!.length, 2);
  const edited = loaded.watchlist!.map((w) => (w.symbol === "NVDA" ? { ...w, interest: 5 } : w));
  assert.deepEqual(await savePortfolio(uid, { ...base, watchlist: edited }, 0), { ok: true, revision: 1 });
});

// ---- it never touches holdings, weights, cash or the health score ---------------------------------------------------

test("the watchlist is invisible to holdings: the recorded portfolio value is the positions' alone, whatever is on the list", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-2222-4222-8222-000000000004";
  writeStored(uid, base);
  const many = Array.from({ length: 30 }, (_, i) => item({ id: "w_" + i, symbol: "S" + i, entryPrice: 1 + i }));
  await savePortfolio(uid, { ...base, watchlist: many }, 0);
  const stored = await getPortfolio(uid);
  const today = stored.equityHistory[stored.equityHistory.length - 1];
  assert.equal(today.value, 1000, "10 x 100 - nothing from the 30 watched symbols");
  assert.deepEqual(stored.positions, [POS], "holdings untouched");
  assert.deepEqual(stored.ledger, {});
});

test("the code that computes holdings, weights, cash, health, alerts and returns never mentions the watchlist", () => {
  const src = path.join(__dirname, "..", "src");
  const files = [
    "components/dashboard/evaluatePosition.ts", "lib/portfolioHealth.ts", "lib/alertRules.ts", "lib/returns.ts",
    "lib/equityHistory.ts", "lib/ledger.ts", "lib/priceStatus.ts", "components/dashboard/AllocationCard.tsx",
    "components/dashboard/PortfolioHealthCard.tsx", "components/dashboard/HoldingsSection.tsx",
  ];
  for (const f of files) assert.ok(!/watchlist/i.test(readFileSync(path.join(src, f), "utf8")), f + " must not depend on the watchlist");
});

// ---- 52-week highs (mocked network) ------------------------------------------------------------------------------------

const net = { calls: {} as Record<string, number>, mode: {} as Record<string, "ok" | "not-found">, inflight: 0, maxInflight: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const m = /\/v8\/finance\/chart\/([^?]+)\?/.exec(url);
  if (!url.includes("query1.finance.yahoo.com") || !m) return new Response("{}", { status: 404 });
  const sym = decodeURIComponent(m[1]);
  net.calls[sym] = (net.calls[sym] || 0) + 1;
  net.inflight++; net.maxInflight = Math.max(net.maxInflight, net.inflight);
  try {
    await new Promise((r) => setTimeout(r, 3));
    if ((net.mode[sym] ?? "ok") === "not-found") return new Response("{}", { status: 404 });
    // 380 daily closes ending today (close i is (379 - i) days old): the oldest 10 are 370-379 days old -
    // OUTSIDE the 365-day window - and huge (500); the high inside the window is 180.
    const n = 380;
    const base = Math.floor(Date.now() / 1000) - n * 86_400;
    const closes = Array.from({ length: n }, (_, i) => (i < 10 ? 500 : i === 200 ? 180 : 100 + (i % 50)));
    return new Response(JSON.stringify({ chart: { result: [{ timestamp: closes.map((_, i) => base + (i + 1) * 86_400), indicators: { quote: [{ close: closes }] } }] } }), { status: 200 });
  } finally { net.inflight--; }
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const H = 60 * 60_000;
const T0 = Date.now();

test("52-week high: the highest daily close of the last 52 weeks (an older, bigger one is ignored)", async () => {
  const { getHighs52, resetHighsCache } = await import("../src/lib/watchlistData");
  resetHighsCache();
  const r = await getHighs52(["AMD"], T0);
  assert.equal(r.AMD.high52, 180);
  assert.equal(r.AMD.status, "ok");
  assert.equal(r.AMD.fetchedAt, new Date(T0).toISOString());
  assert.match(r.AMD.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("52-week high: cached and shared (any case, any number of callers), refreshed after its lifetime", async () => {
  const { getHighs52, resetHighsCache, HIGH_CACHE_TTL_MS } = await import("../src/lib/watchlistData");
  resetHighsCache(); net.calls = {};
  await Promise.all([getHighs52(["tsm", "TSM", "Tsm"], T0), getHighs52(["TSM"], T0), getHighs52(["TSM"], T0 + H)]);
  assert.equal(net.calls.TSM, 1, "one fetch for the three callers and three spellings");
  await getHighs52(["TSM"], T0 + HIGH_CACHE_TTL_MS + 1);
  assert.equal(net.calls.TSM, 2);
});

test("52-week high: a symbol with no data is 'missing' (not 0), is not hammered, and does not affect the others", async () => {
  const { getHighs52, resetHighsCache, HIGH_FAILURE_BACKOFF_MS } = await import("../src/lib/watchlistData");
  resetHighsCache(); net.calls = {}; net.mode = { NOPE: "not-found" };
  const r = await getHighs52(["AMD", "NOPE"], T0);
  assert.deepEqual([r.NOPE.high52, r.NOPE.status, r.NOPE.fetchedAt], [null, "missing", null]);
  assert.equal(r.AMD.high52, 180, "the other symbol is fine");
  const first = net.calls.NOPE;
  await getHighs52(["NOPE"], T0 + 2 * 60_000);
  assert.equal(net.calls.NOPE, first, "no new attempt during the back-off");
  net.mode = {};
  const later = await getHighs52(["NOPE"], T0 + HIGH_FAILURE_BACKOFF_MS + 1);
  assert.equal(later.NOPE.high52, 180, "and it recovers on its own");
});

test("52-week high: when a refresh fails the last good value is kept and turns 'stale' once it is old", async () => {
  const { getHighs52, resetHighsCache, HIGH_CACHE_TTL_MS, HIGH_STALE_AFTER_MS } = await import("../src/lib/watchlistData");
  resetHighsCache(); net.mode = {};
  await getHighs52(["MSFT"], T0);
  net.mode = { MSFT: "not-found" };
  const soon = await getHighs52(["MSFT"], T0 + HIGH_CACHE_TTL_MS + 1);
  assert.deepEqual([soon.MSFT.high52, soon.MSFT.status], [180, "ok"]);
  const old = await getHighs52(["MSFT"], T0 + HIGH_STALE_AFTER_MS + 1 + 20 * 60_000);
  assert.deepEqual([old.MSFT.high52, old.MSFT.status], [180, "stale"]);
  net.mode = {};
});

test("52-week high: requests are paced and a bad symbol is 'missing' without being fetched", async () => {
  const { getHighs52, resetHighsCache } = await import("../src/lib/watchlistData");
  resetHighsCache(); net.calls = {}; net.maxInflight = 0;
  const symbols = Array.from({ length: 40 }, (_, i) => "Q" + i);
  const r = await getHighs52([...symbols, "bad symbol!", "../x"], T0);
  assert.ok(symbols.every((s) => r[s].high52 === 180));
  assert.ok(net.maxInflight <= 5, "at most 5 at a time, saw " + net.maxInflight);
  assert.deepEqual([r["BAD SYMBOL!"].status, r["../X"].status], ["missing", "missing"]);
  assert.equal(Object.keys(net.calls).length, 40, "nothing was fetched for the bad ones");
});
