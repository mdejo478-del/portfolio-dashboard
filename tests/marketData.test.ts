// 9.2 - the market data layer with a MOCKED network (nothing real is called): VIX from Yahoo,
// Fear & Greed from CNN's unofficial endpoint, the cache shared by all users, what happens when a
// source is unavailable, the daily history file, the daily-snapshot hook, and the owner's settings.
// Disk work runs in a throwaway temp directory - never touching the real data/.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // the data modules resolve data/ from cwd at import time
const DATA = path.join(dir, "data");
const HISTORY = path.join(DATA, "market-history.json");
mkdirSync(path.join(DATA, "portfolios"), { recursive: true });
delete process.env.FINNHUB_API_KEY; // the daily snapshot's earnings/news calls then return nothing without a network call

// ---- the mocked network --------------------------------------------------------------------------------
type CnnMode = "ok" | "teapot" | "error500" | "malformed" | "out-of-range" | "no-field" | "network";
type YahooMode = "ok" | "not-found" | "network";
const net = { cnn: "ok" as CnnMode, yahoo: "ok" as YahooMode, cnnScore: 22.4, cnnPrev: 31.2, cnnRating: "extreme fear", vixCloses: [19.46, 17.63], calls: { cnn: 0, yahoo: 0 } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.includes("production.dataviz.cnn.io")) {
    net.calls.cnn++;
    switch (net.cnn) {
      case "teapot": return new Response("I'm a teapot. You're a bot.", { status: 418 });
      case "error500": return new Response("boom", { status: 500 });
      case "malformed": return new Response("<html>not json</html>", { status: 200 });
      case "out-of-range": return json({ fear_and_greed: { score: 340, rating: "greed" } });
      case "no-field": return json({ something_else: 1 });
      case "network": throw new TypeError("fetch failed");
      default: return json({ fear_and_greed: { score: net.cnnScore, rating: net.cnnRating, timestamp: "2026-03-10T14:55:00+00:00", previous_close: net.cnnPrev, previous_1_week: 40 } });
    }
  }
  if (url.includes("query1.finance.yahoo.com") && url.includes("%5EVIX")) {
    net.calls.yahoo++;
    if (net.yahoo === "network") throw new TypeError("fetch failed");
    if (net.yahoo === "not-found") return new Response("{}", { status: 404 });
    const closes = net.vixCloses;
    const base = Math.floor(Date.now() / 1000) - closes.length * 86_400;
    return json({ chart: { result: [{ timestamp: closes.map((_, i) => base + (i + 1) * 86_400), indicators: { quote: [{ close: closes }] } }] } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const MIN = 60_000;
const T0 = Date.parse("2026-03-10T15:00:00.000Z");

beforeEach(async () => {
  const { resetMarketCache } = await import("../src/lib/marketData");
  resetMarketCache();
  Object.assign(net, { cnn: "ok", yahoo: "ok", cnnScore: 22.4, cnnPrev: 31.2, cnnRating: "extreme fear", vixCloses: [19.46, 17.63] });
  net.calls.cnn = 0; net.calls.yahoo = 0;
  if (existsSync(HISTORY)) writeFileSync(HISTORY, JSON.stringify({ days: {} }));
});

// ---- the two sources --------------------------------------------------------------------------------------

test("VIX: value, yesterday's close, source and reliability come from Yahoo's daily closes", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const { vix } = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(vix.value, 17.63);
  assert.equal(vix.previous, 19.46);
  assert.equal(vix.source, "Yahoo Finance");
  assert.equal(vix.unofficial, false);
  assert.equal(vix.status, "ok");
  assert.equal(vix.fetchedAt, new Date(T0).toISOString());
  assert.ok(vix.asOf && !Number.isNaN(Date.parse(vix.asOf)), "the data point's own time");
});

test("Fear & Greed: score, yesterday, CNN's rating and the 'unofficial' flag", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const { fearGreed } = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(fearGreed.value, 22.4);
  assert.equal(fearGreed.previous, 31.2);
  assert.equal(fearGreed.rating, "extreme fear");
  assert.equal(fearGreed.source, "CNN");
  assert.equal(fearGreed.unofficial, true, "always labeled as unofficial");
  assert.equal(fearGreed.status, "ok");
  assert.equal(fearGreed.asOf, "2026-03-10T14:55:00.000Z");
});

test("a source that is unavailable gives 'missing' - and the OTHER indicator is unaffected, nothing throws", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  net.cnn = "teapot"; // what the real endpoint answers an automated request with: HTTP 418
  const a = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([a.fearGreed.value, a.fearGreed.status, a.fearGreed.unofficial], [null, "missing", true]);
  assert.equal(a.vix.status, "ok", "the card still has the VIX");

  const { resetMarketCache } = await import("../src/lib/marketData");
  resetMarketCache();
  net.cnn = "ok"; net.yahoo = "not-found";
  const b = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([b.vix.value, b.vix.status], [null, "missing"]);
  assert.equal(b.fearGreed.status, "ok");

  resetMarketCache();
  net.yahoo = "network"; net.cnn = "network";
  const c = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([c.vix.status, c.fearGreed.status], ["missing", "missing"], "everything down: still no exception");
});

test("CNN answering with junk is 'missing', never a crash or a made-up number", async () => {
  const { getMarketSnapshot, resetMarketCache, parseFearGreed } = await import("../src/lib/marketData");
  for (const mode of ["malformed", "out-of-range", "no-field", "error500"] as const) {
    resetMarketCache();
    net.cnn = mode;
    const { fearGreed } = await getMarketSnapshot({ nowMs: T0 });
    assert.deepEqual([fearGreed.value, fearGreed.status], [null, "missing"], mode);
  }
  for (const junk of [null, undefined, 5, "x", {}, { fear_and_greed: null }, { fear_and_greed: { score: "abc" } }, { fear_and_greed: { score: -1 } }, { fear_and_greed: { score: 101 } }]) {
    assert.equal(parseFearGreed(junk).status, "missing", JSON.stringify(junk));
  }
  assert.equal(parseFearGreed({ fear_and_greed: { score: "55.5" } }).value, 55.5, "a numeric string is fine");
  assert.equal(parseFearGreed({ fear_and_greed: { score: 50, previous_close: 999 } }).previous, null, "an impossible 'yesterday' is dropped");
});

test("a refusing endpoint (418) is asked ONCE - 4xx isn't retried - and a 5xx once more", async () => {
  const { getMarketSnapshot, resetMarketCache } = await import("../src/lib/marketData");
  net.cnn = "teapot";
  await getMarketSnapshot({ nowMs: T0 });
  assert.equal(net.calls.cnn, 1);
  resetMarketCache(); net.calls.cnn = 0;
  net.cnn = "error500";
  await getMarketSnapshot({ nowMs: T0 });
  assert.equal(net.calls.cnn, 2, "one retry for a server error");
});

// ---- the shared cache -----------------------------------------------------------------------------------------

test("served from the shared cache within its lifetime, fetched again after it", async () => {
  const { getMarketSnapshot, MARKET_CACHE_TTL_MS } = await import("../src/lib/marketData");
  await getMarketSnapshot({ nowMs: T0 });
  await getMarketSnapshot({ nowMs: T0 + MIN });
  await getMarketSnapshot({ nowMs: T0 + 4 * MIN });
  assert.deepEqual([net.calls.yahoo, net.calls.cnn], [1, 1], "three users' requests, one fetch each");
  await getMarketSnapshot({ nowMs: T0 + MARKET_CACHE_TTL_MS.vix + 1 });
  assert.deepEqual([net.calls.yahoo, net.calls.cnn], [2, 1], "the VIX is refreshed after 5 minutes, Fear & Greed (15 minutes) is not yet");
  await getMarketSnapshot({ nowMs: T0 + MARKET_CACHE_TTL_MS.fearGreed + 1 });
  assert.equal(net.calls.cnn, 2);
});

test("concurrent callers share a single fetch", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  await Promise.all(Array.from({ length: 8 }, () => getMarketSnapshot({ nowMs: T0 })));
  assert.deepEqual([net.calls.yahoo, net.calls.cnn], [1, 1]);
});

test("a source that failed is not hammered: no new attempt during the back-off, a new one after it", async () => {
  const { getMarketSnapshot, MARKET_FAILURE_BACKOFF_MS } = await import("../src/lib/marketData");
  net.cnn = "teapot";
  await getMarketSnapshot({ nowMs: T0 });
  await getMarketSnapshot({ nowMs: T0 + MIN });
  await getMarketSnapshot({ nowMs: T0 + 5 * MIN });
  assert.equal(net.calls.cnn, 1, "every refresh of every user would otherwise hit it");
  net.cnn = "ok";
  const later = await getMarketSnapshot({ nowMs: T0 + MARKET_FAILURE_BACKOFF_MS.fearGreed + 1 });
  assert.equal(net.calls.cnn, 2);
  assert.equal(later.fearGreed.status, "ok", "and it recovers on its own");
});

test("when a refresh fails the last good value is kept - 'ok' while recent, 'stale' once it ages", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const first = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(first.vix.value, 17.63);
  net.yahoo = "not-found";
  const soon = await getMarketSnapshot({ nowMs: T0 + 10 * MIN });          // refresh fails, the value is 10 minutes old
  assert.deepEqual([soon.vix.value, soon.vix.status], [17.63, "ok"]);
  assert.equal(soon.vix.fetchedAt, new Date(T0).toISOString(), "its time did NOT move - it was not re-fetched");
  const later = await getMarketSnapshot({ nowMs: T0 + 45 * MIN });          // 45 minutes old
  assert.deepEqual([later.vix.value, later.vix.status], [17.63, "stale"]);
  net.yahoo = "ok"; net.vixCloses = [17.63, 21.0];
  const back = await getMarketSnapshot({ nowMs: T0 + 3 * 60 * MIN });
  assert.deepEqual([back.vix.value, back.vix.status], [21.0, "ok"]);
});

// ---- the daily history (shared, not per portfolio) -------------------------------------------------------------

const readHist = () => JSON.parse(readFileSync(HISTORY, "utf8")) as { days: Record<string, { vix: number | null; fearGreed: number | null }> };

test("history: one record per day, a missing value never overwrites a recorded one, bad dates are refused", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  await recordMarketHistory("2026-03-01", { vix: 18.2, fearGreed: 40 });
  await recordMarketHistory("2026-03-01", { vix: null, fearGreed: 33 });       // Fear & Greed updated, VIX not available now
  await recordMarketHistory("2026-03-02", { vix: 21.5 });
  const h = readHist();
  assert.deepEqual([h.days["2026-03-01"].vix, h.days["2026-03-01"].fearGreed], [18.2, 33], "merged, nothing lost");
  assert.deepEqual([h.days["2026-03-02"].vix, h.days["2026-03-02"].fearGreed], [21.5, null]);
  await recordMarketHistory("2026-03-03", { vix: null, fearGreed: null });
  assert.equal("2026-03-03" in readHist().days, false, "nothing to record, nothing written");
  await assert.rejects(recordMarketHistory("03/04/2026", { vix: 1 }));
});

test("history: keeps about ten years, dropping the oldest days", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  const days: Record<string, unknown> = {};
  const start = Date.parse("2010-01-01T00:00:00Z");
  for (let i = 0; i < 3650; i++) days[new Date(start + i * 86_400_000).toISOString().slice(0, 10)] = { vix: 15, fearGreed: 50, recordedAt: "x" };
  writeFileSync(HISTORY, JSON.stringify({ days }));
  await recordMarketHistory("2026-03-10", { vix: 17 });
  const keys = Object.keys(readHist().days).sort();
  assert.equal(keys.length, 3650);
  assert.equal(keys[0], "2010-01-02", "the oldest day went");
  assert.equal(keys[keys.length - 1], "2026-03-10");
});

test("history: an unreadable file is set aside (not silently overwritten) and a new one is started", async () => {
  const { recordMarketHistory, readMarketHistory } = await import("../src/lib/marketData");
  writeFileSync(HISTORY, "{ this is not json");
  assert.deepEqual(await readMarketHistory(), { days: {} });
  assert.equal(existsSync(HISTORY), false, "moved away");
  assert.ok(readdirSync(path.join(DATA, "corrupted")).some((f) => f.startsWith("market-history.json.") && f.endsWith(".corrupt")), "kept for diagnosis");
  await recordMarketHistory("2026-03-10", { vix: 17 });
  assert.equal(readHist().days["2026-03-10"].vix, 17);
});

test("history: only values obtained NOW are recorded - never a stale fallback - and both indicators merge over runs", async () => {
  const { recordDailyMarketHistory } = await import("../src/lib/marketData");
  net.cnn = "teapot";                                                          // Fear & Greed unavailable this run
  await recordDailyMarketHistory("2026-03-10");
  let day = readHist().days["2026-03-10"];
  assert.deepEqual([day.vix, day.fearGreed], [17.63, null]);
  net.cnn = "ok";                                                              // a later run the same day gets it
  await recordDailyMarketHistory("2026-03-10");
  day = readHist().days["2026-03-10"];
  assert.deepEqual([day.vix, day.fearGreed], [17.63, 22.4], "merged");
  const before = readFileSync(HISTORY, "utf8");
  net.cnn = "teapot"; net.yahoo = "not-found";                                 // everything down, an hour later
  await recordDailyMarketHistory("2026-03-11", Date.now() + 60 * MIN);
  assert.equal(readFileSync(HISTORY, "utf8"), before, "the hour-old values (still 'ok' for Fear & Greed) are NOT filed under a new date");
});

test("after a restart with no live data, the last recorded day is shown as 'stale', with its date", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  writeFileSync(HISTORY, JSON.stringify({ days: {
    "2026-03-07": { vix: 18.0, fearGreed: 45, recordedAt: "x" },
    "2026-03-08": { vix: 19.0, fearGreed: null, recordedAt: "x" },
    "2026-03-09": { vix: 20.5, fearGreed: 38, recordedAt: "x" },
  } }));
  net.yahoo = "not-found"; net.cnn = "teapot";
  const { vix, fearGreed } = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([vix.value, vix.previous, vix.status, vix.fetchedAt, vix.asOf], [20.5, 19.0, "stale", null, "2026-03-09"]);
  assert.deepEqual([fearGreed.value, fearGreed.previous, fearGreed.status, fearGreed.unofficial], [38, 45, "stale", true]);
});

test("the daily snapshot job records the market once per run, and a failing market never stops it", async () => {
  const { maybeRunDailySnapshot } = await import("../src/lib/dailySnapshot");
  const today = new Date().toISOString().slice(0, 10);
  net.cnn = "teapot";
  await maybeRunDailySnapshot();
  assert.equal(readHist().days[today].vix, 17.63, "recorded by the real daily job");
  assert.equal(readHist().days[today].fearGreed, null);
  assert.ok(existsSync(path.join(DATA, "daily-snapshot-meta.json")), "and the job itself completed");
  // History is one shared file - not inside any user's portfolio.
  assert.deepEqual(readdirSync(path.join(DATA, "portfolios")), []);
});

// ---- the owner's settings ---------------------------------------------------------------------------------------

test("settings: per user, saved with the portfolio, validated on read, no revision bump, survive a normal save", async () => {
  const { getMarketSettings, saveMarketSettings, savePortfolio, getPortfolio, currentRevision } = await import("../src/lib/portfolio");
  const { DEFAULT_MARKET_SETTINGS } = await import("../src/lib/marketStatus");
  const uid = "ffffffff-1111-4111-8111-000000000001";
  const other = "ffffffff-1111-4111-8111-000000000002";
  const base = { positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 1 };
  writeFileSync(path.join(DATA, "portfolios", uid + ".json"), JSON.stringify({ ...base, equityHistory: [], alertAcks: {}, revision: 3 }));

  assert.deepEqual(await getMarketSettings(uid), DEFAULT_MARKET_SETTINGS, "defaults until the owner changes them");
  const mine = { vixZones: { calmBelow: 16, alertBelow: 22, buyBelow: 28, panicUpTo: 36 }, fearGreedExtremeBelow: 30 };
  await saveMarketSettings(uid, mine);
  assert.deepEqual(await getMarketSettings(uid), mine);
  assert.equal(currentRevision(await getPortfolio(uid)), 3, "not part of the client's data: the revision is untouched");
  assert.deepEqual(await getMarketSettings(other), DEFAULT_MARKET_SETTINGS, "another user is unaffected");

  assert.deepEqual(await savePortfolio(uid, base, 3), { ok: true, revision: 4 });
  assert.deepEqual(await getMarketSettings(uid), mine, "an ordinary save leaves them alone");

  // A corrupted stored value never breaks the card.
  const raw = JSON.parse(readFileSync(path.join(DATA, "portfolios", uid + ".json"), "utf8"));
  writeFileSync(path.join(DATA, "portfolios", uid + ".json"), JSON.stringify({ ...raw, marketSettings: { vixZones: { calmBelow: 50, alertBelow: 40, buyBelow: 30, panicUpTo: 20 }, fearGreedExtremeBelow: 25 } }));
  assert.deepEqual(await getMarketSettings(uid), DEFAULT_MARKET_SETTINGS);
});
