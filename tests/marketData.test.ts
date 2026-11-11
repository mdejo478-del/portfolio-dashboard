// The market data layer with a MOCKED network (nothing real is called): the VIX, the VIX3M and the
// S&P 500 from Yahoo and the own-calculation pressure index built from them; the cache shared by all
// users; what happens when a source is unavailable; the daily history file; the daily-snapshot hook;
// the owner's settings; and that CNN is never contacted. Disk work runs in a throwaway temp directory -
// never touching the real data/.
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
type Mode = "ok" | "not-found" | "network";
const net = {
  vix: "ok" as Mode, vix3m: "ok" as Mode, spx: "ok" as Mode,
  vixCloses: [19.46, 17.63], vix3mCloses: [19.8, 19.41],
  calls: { vix: 0, vix3m: 0, spx: 0 }, other: [] as string[],
};
// S&P 500: 250 closes at 100, then 49 at 120, then a last close of 108 (300 trading days ending today):
// 52-week high 120, last 108 (10% below it), 125-day average (75x100 + 49x120 + 108) / 125 = 107.904.
const SPX_CLOSES = [...Array(250).fill(100), ...Array(49).fill(120), 108];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const chart = (closes: number[]) => {
    const base = Math.floor(Date.now() / 1000) - closes.length * 86_400;
    return json({ chart: { result: [{ timestamp: closes.map((_, i) => base + (i + 1) * 86_400), indicators: { quote: [{ close: closes }] } }] } });
  };
  const serve = (key: "vix" | "vix3m" | "spx", closes: number[]) => {
    net.calls[key]++;
    if (net[key] === "network") throw new TypeError("fetch failed");
    if (net[key] === "not-found") return new Response("{}", { status: 404 });
    return chart(closes);
  };
  if (url.includes("query1.finance.yahoo.com")) {
    if (url.includes("%5EVIX3M?")) return serve("vix3m", net.vix3mCloses);
    if (url.includes("%5EVIX?")) return serve("vix", net.vixCloses);
    if (url.includes("%5EGSPC?")) return serve("spx", SPX_CLOSES);
  }
  net.other.push(url);
  return new Response("{}", { status: 404 });
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const MIN = 60_000;
const T0 = Date.parse("2026-03-10T15:00:00.000Z");

beforeEach(async () => {
  const { resetMarketCache } = await import("../src/lib/marketData");
  resetMarketCache();
  Object.assign(net, { vix: "ok", vix3m: "ok", spx: "ok", vixCloses: [19.46, 17.63], vix3mCloses: [19.8, 19.41], other: [] });
  net.calls.vix = 0; net.calls.vix3m = 0; net.calls.spx = 0;
  if (existsSync(HISTORY)) writeFileSync(HISTORY, JSON.stringify({ days: {} }));
});

// ---- the three Yahoo series and the index built from them --------------------------------------------------

test("VIX: value, yesterday's close, source and reliability come from Yahoo's daily closes", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const { vix } = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(vix.value, 17.63);
  assert.equal(vix.previous, 19.46);
  assert.equal(vix.source, "Yahoo Finance");
  assert.equal(vix.status, "ok");
  assert.equal(vix.fetchedAt, new Date(T0).toISOString());
  assert.ok(vix.asOf && !Number.isNaN(Date.parse(vix.asOf)), "the data point's own time");
});

test("the pressure index is built from VIX, VIX3M and the S&P 500 series - checked against the hand-worked numbers", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const { pressure } = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual(pressure.components.map((c) => c.id), ["vix", "term", "drawdown", "trend"]);
  const by = Object.fromEntries(pressure.components.map((c) => [c.id, c]));
  assert.equal(by.vix.raw, 17.63);
  assert.ok(Math.abs((by.term.raw as number) - 17.63 / 19.41) < 1e-9, "VIX / VIX3M");
  assert.ok(Math.abs((by.drawdown.raw as number) - 0.1) < 1e-9, "10% below the 52-week high of 120");
  assert.ok(Math.abs((by.trend.raw as number) - (108 / 107.904 - 1)) < 1e-9, "vs the 125-day average 107.904");
  assert.ok(Math.abs((by.vix.score as number) - 20.10714) < 1e-4);
  assert.ok(Math.abs((by.drawdown.score as number) - 50) < 1e-9);
  assert.equal(pressure.value, 32.5);
  assert.deepEqual([pressure.available, pressure.missing, pressure.status], [4, 0, "ok"]);
  assert.ok(pressure.components.every((c) => c.status === "ok" && c.source === "Yahoo Finance" && c.fetchedAt === new Date(T0).toISOString()), "each component carries source, time and status");
});

test("backwardation: VIX above VIX3M is flagged on the ratio component", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  net.vixCloses = [20, 24]; net.vix3mCloses = [21, 21];
  const { pressure } = await getMarketSnapshot({ nowMs: T0 });
  const term = pressure.components.find((c) => c.id === "term")!;
  assert.equal(term.backwardation, true);
  assert.ok((term.score as number) > 50);
});

test("a source that is unavailable leaves out only the components that need it, and nothing throws", async () => {
  const { getMarketSnapshot, resetMarketCache } = await import("../src/lib/marketData");
  net.vix3m = "not-found";
  const a = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(a.vix.status, "ok", "the VIX panel is unaffected");
  assert.deepEqual([a.pressure.available, a.pressure.missing], [3, 1]);
  assert.equal(a.pressure.components.find((c) => c.id === "term")!.status, "missing");
  assert.equal(a.pressure.value, 34.3, "the average of the three that exist - the missing one is not a 0");

  resetMarketCache();
  net.vix3m = "ok"; net.spx = "not-found";
  const b = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([b.pressure.available, b.pressure.missing], [2, 2]);
  assert.deepEqual(b.pressure.components.map((c) => c.status), ["ok", "ok", "missing", "missing"]);

  resetMarketCache();
  net.vix = "network"; net.vix3m = "network"; net.spx = "network";
  const c = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([c.vix.status, c.vix.value, c.pressure.value, c.pressure.available, c.pressure.status], ["missing", null, null, 0, "missing"], "everything down: still no exception");
});

test("CNN is never contacted - and nothing in the source still refers to its data endpoint", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  await getMarketSnapshot({ nowMs: T0 });
  await getMarketSnapshot({ nowMs: T0 + 20 * MIN, force: true });
  assert.deepEqual(net.other, [], "only Yahoo's chart API is called");
  const root = path.join(__dirname, "..", "src");
  const offenders: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /dataviz\.cnn\.io|fearandgreed\/graphdata|fetchFearGreed|parseFearGreed/.test(readFileSync(p, "utf8"))) offenders.push(p);
    }
  })(root);
  assert.deepEqual(offenders, [], "no call to CNN's endpoint remains in the code");
});

// ---- the shared cache -----------------------------------------------------------------------------------------

test("served from the shared cache within its lifetime, fetched again after it (each series on its own clock)", async () => {
  const { getMarketSnapshot, MARKET_CACHE_TTL_MS } = await import("../src/lib/marketData");
  await getMarketSnapshot({ nowMs: T0 });
  await getMarketSnapshot({ nowMs: T0 + MIN });
  await getMarketSnapshot({ nowMs: T0 + 4 * MIN });
  assert.deepEqual([net.calls.vix, net.calls.vix3m, net.calls.spx], [1, 1, 1], "three users' requests, one fetch per series");
  await getMarketSnapshot({ nowMs: T0 + MARKET_CACHE_TTL_MS.vix + 1 });
  assert.deepEqual([net.calls.vix, net.calls.vix3m, net.calls.spx], [2, 2, 1], "the VIXes are refreshed after 5 minutes, the S&P (10 minutes) is not yet");
  await getMarketSnapshot({ nowMs: T0 + MARKET_CACHE_TTL_MS.spx + 1 });
  assert.equal(net.calls.spx, 2);
});

test("concurrent callers share a single fetch per series", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  await Promise.all(Array.from({ length: 8 }, () => getMarketSnapshot({ nowMs: T0 })));
  assert.deepEqual([net.calls.vix, net.calls.vix3m, net.calls.spx], [1, 1, 1]);
});

test("a series that failed is not hammered: no new attempt during the back-off, a new one after it, and it recovers", async () => {
  const { getMarketSnapshot, MARKET_FAILURE_BACKOFF_MS } = await import("../src/lib/marketData");
  net.spx = "not-found";
  await getMarketSnapshot({ nowMs: T0 });
  const afterFirst = net.calls.spx;
  await getMarketSnapshot({ nowMs: T0 + MIN });
  await getMarketSnapshot({ nowMs: T0 + 3 * MIN });
  assert.equal(net.calls.spx, afterFirst, "every refresh of every user would otherwise hit it");
  net.spx = "ok";
  const later = await getMarketSnapshot({ nowMs: T0 + MARKET_FAILURE_BACKOFF_MS.spx + 1 });
  assert.equal(net.calls.spx, afterFirst + 1);
  assert.equal(later.pressure.available, 4, "and it recovers on its own");
});

test("when a refresh fails the last good values are kept - 'ok' while recent, 'stale' once they age - per component", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  const first = await getMarketSnapshot({ nowMs: T0 });
  assert.equal(first.vix.value, 17.63);
  net.vix = "not-found"; net.vix3m = "not-found"; net.spx = "not-found";
  const soon = await getMarketSnapshot({ nowMs: T0 + 10 * MIN });
  assert.deepEqual([soon.vix.value, soon.vix.status], [17.63, "ok"]);
  assert.equal(soon.vix.fetchedAt, new Date(T0).toISOString(), "its time did NOT move - it was not re-fetched");
  assert.equal(soon.pressure.value, 32.5, "the index is still built from the last good values");
  const later = await getMarketSnapshot({ nowMs: T0 + 45 * MIN });
  assert.equal(later.vix.status, "stale");
  assert.deepEqual(later.pressure.components.map((c) => c.status), ["stale", "stale", "ok", "ok"], "the VIX-based components aged out, the S&P ones (3 hours) did not");
  assert.equal(later.pressure.status, "stale");
  const muchLater = await getMarketSnapshot({ nowMs: T0 + 4 * 3600_000 });
  assert.ok(muchLater.pressure.components.every((c) => c.status === "stale"));
  net.vix = "ok"; net.vix3m = "ok"; net.spx = "ok"; net.vixCloses = [17.63, 21.0];
  const back = await getMarketSnapshot({ nowMs: T0 + 6 * 3600_000 });
  assert.deepEqual([back.vix.value, back.vix.status, back.pressure.status], [21.0, "ok", "ok"]);
});

// ---- the daily history (shared, not per portfolio) -------------------------------------------------------------

type Day = { vix: number | null; pressure: number | null; pressureComponents?: number; components?: Record<string, { raw: number; score: number }>; fearGreed?: number | null };
const readHist = () => JSON.parse(readFileSync(HISTORY, "utf8")) as { days: Record<string, Day> };

test("history: one record per day, a missing value never overwrites a recorded one, bad dates are refused", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  await recordMarketHistory("2026-03-01", { vix: 18.2, pressure: 40, pressureComponents: 4 });
  await recordMarketHistory("2026-03-01", { vix: null });                       // nothing new this time
  await recordMarketHistory("2026-03-02", { vix: 21.5 });
  const h = readHist();
  assert.deepEqual([h.days["2026-03-01"].vix, h.days["2026-03-01"].pressure], [18.2, 40], "nothing lost");
  assert.deepEqual([h.days["2026-03-02"].vix, h.days["2026-03-02"].pressure], [21.5, null]);
  await recordMarketHistory("2026-03-03", { vix: null, pressure: null });
  assert.equal("2026-03-03" in readHist().days, false, "nothing to record, nothing written");
  await assert.rejects(recordMarketHistory("03/04/2026", { vix: 1 }));
});

test("history: an entry written by the first version (with a Fear & Greed value) is kept, never dropped", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  writeFileSync(HISTORY, JSON.stringify({ days: { "2026-03-01": { vix: 18, fearGreed: 41, recordedAt: "x" } } }));
  await recordMarketHistory("2026-03-01", { vix: 18.5, pressure: 33, pressureComponents: 4 });
  const d = readHist().days["2026-03-01"];
  assert.deepEqual([d.vix, d.pressure, d.fearGreed], [18.5, 33, 41]);
});

test("history: a day recorded from MORE components is not replaced by a later run that managed fewer", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  const comp = (n: number) => Object.fromEntries(["vix", "term", "drawdown", "trend"].slice(0, n).map((id) => [id, { raw: 1, score: 10 }]));
  await recordMarketHistory("2026-03-05", { vix: 18, pressure: 30, pressureComponents: 2, components: comp(2) });
  await recordMarketHistory("2026-03-05", { pressure: 35, pressureComponents: 4, components: comp(4) });
  assert.deepEqual([readHist().days["2026-03-05"].pressure, readHist().days["2026-03-05"].pressureComponents], [35, 4], "a better one replaces");
  await recordMarketHistory("2026-03-05", { pressure: 20, pressureComponents: 3, components: comp(3) });
  assert.deepEqual([readHist().days["2026-03-05"].pressure, readHist().days["2026-03-05"].pressureComponents], [35, 4], "a worse one does not");
  assert.equal(Object.keys(readHist().days["2026-03-05"].components!).length, 4, "and the components stay in step with the index");
});

test("history: keeps about ten years, dropping the oldest days", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  const days: Record<string, unknown> = {};
  const start = Date.parse("2010-01-01T00:00:00Z");
  for (let i = 0; i < 3650; i++) days[new Date(start + i * 86_400_000).toISOString().slice(0, 10)] = { vix: 15, pressure: 30, recordedAt: "x" };
  writeFileSync(HISTORY, JSON.stringify({ days }));
  await recordMarketHistory("2026-03-10", { vix: 17 });
  const keys = Object.keys(readHist().days).sort();
  assert.equal(keys.length, 3650);
  assert.equal(keys[0], "2010-01-02", "the oldest day went");
  assert.equal(keys[keys.length - 1], "2026-03-10");
});

test("history: an unreadable file with no snapshot to restore from is set aside (not silently overwritten) and a new one is started", async () => {
  const { recordMarketHistory, readMarketHistory } = await import("../src/lib/marketData");
  writeFileSync(HISTORY, "{ this is not json");
  assert.deepEqual(await readMarketHistory(), { days: {} });
  assert.equal(existsSync(HISTORY), false, "moved away");
  assert.ok(readdirSync(path.join(DATA, "corrupted")).some((f) => f.startsWith("market-history.json.") && f.endsWith(".corrupt")), "kept for diagnosis");
  await recordMarketHistory("2026-03-10", { vix: 17 });
  assert.equal(readHist().days["2026-03-10"].vix, 17);
});

test("history: the daily record holds the VIX, the pressure index and each component's raw input and score", async () => {
  const { recordDailyMarketHistory } = await import("../src/lib/marketData");
  await recordDailyMarketHistory("2026-03-10");
  const day = readHist().days["2026-03-10"];
  assert.equal(day.vix, 17.63);
  assert.equal(day.pressure, 32.5);
  assert.equal(day.pressureComponents, 4);
  assert.deepEqual(Object.keys(day.components!).sort(), ["drawdown", "term", "trend", "vix"]);
  assert.ok(Math.abs(day.components!.drawdown.raw - 0.1) < 1e-9 && Math.abs(day.components!.drawdown.score - 50) < 1e-9);
  assert.equal("fearGreed" in day, false, "no Fear & Greed is recorded any more");
});

test("history: only values obtained NOW are recorded - never a stale fallback - and a partial day is replaced by a fuller one", async () => {
  const { recordDailyMarketHistory } = await import("../src/lib/marketData");
  net.spx = "not-found";                                                       // the S&P series is unavailable this run
  await recordDailyMarketHistory("2026-03-10");
  let day = readHist().days["2026-03-10"];
  assert.deepEqual([day.vix, day.pressureComponents, Object.keys(day.components!).sort()], [17.63, 2, ["term", "vix"]], "the index of the two components that exist");
  net.spx = "ok";                                                              // a later run the same day has all four
  await recordDailyMarketHistory("2026-03-10");
  day = readHist().days["2026-03-10"];
  assert.deepEqual([day.pressure, day.pressureComponents], [32.5, 4]);
  const before = readFileSync(HISTORY, "utf8");
  net.vix = "not-found"; net.vix3m = "not-found"; net.spx = "not-found";        // everything down, an hour later
  await recordDailyMarketHistory("2026-03-11", Date.now() + 60 * MIN);
  assert.equal(readFileSync(HISTORY, "utf8"), before, "the hour-old values (still 'ok' for the S&P) are NOT filed under a new date");
});

test("after a restart with no live data, the last recorded day is shown as 'stale', with its date and components", async () => {
  const { getMarketSnapshot } = await import("../src/lib/marketData");
  writeFileSync(HISTORY, JSON.stringify({ days: {
    "2026-03-07": { vix: 18.0, pressure: 30, pressureComponents: 4, recordedAt: "x" },
    "2026-03-09": { vix: 20.5, pressure: 41.5, pressureComponents: 2, components: { vix: { raw: 20.5, score: 30.4 }, term: { raw: 1.02, score: 55 } }, recordedAt: "x" },
  } }));
  net.vix = "not-found"; net.vix3m = "not-found"; net.spx = "not-found";
  const { vix, pressure } = await getMarketSnapshot({ nowMs: T0 });
  assert.deepEqual([vix.value, vix.previous, vix.status, vix.fetchedAt, vix.asOf], [20.5, 18.0, "stale", null, "2026-03-09"]);
  assert.equal(pressure.status, "stale");
  assert.deepEqual([pressure.available, pressure.missing], [2, 2]);
  assert.deepEqual(pressure.components.map((c) => c.status), ["stale", "stale", "missing", "missing"]);
  assert.equal(pressure.components[1].asOf, "2026-03-09");
});

test("the daily snapshot job records the market once per run, and failing sources never stop it", async () => {
  const { maybeRunDailySnapshot } = await import("../src/lib/dailySnapshot");
  const today = new Date().toISOString().slice(0, 10);
  net.vix3m = "not-found";
  await maybeRunDailySnapshot();
  assert.equal(readHist().days[today].vix, 17.63, "recorded by the real daily job");
  assert.equal(readHist().days[today].pressureComponents, 3);
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
  const mine = { vixZones: { calmBelow: 16, alertBelow: 22, buyBelow: 28, panicUpTo: 36 }, pressureExtremeAbove: 60 };
  await saveMarketSettings(uid, mine);
  assert.deepEqual(await getMarketSettings(uid), mine);
  assert.equal(currentRevision(await getPortfolio(uid)), 3, "not part of the client's data: the revision is untouched");
  assert.deepEqual(await getMarketSettings(other), DEFAULT_MARKET_SETTINGS, "another user is unaffected");

  assert.deepEqual(await savePortfolio(uid, base, 3), { ok: true, revision: 4 });
  assert.deepEqual(await getMarketSettings(uid), mine, "an ordinary save leaves them alone");

  // Settings saved by the first version (a Fear & Greed threshold): the VIX zones survive, the new threshold is the default.
  const raw = JSON.parse(readFileSync(path.join(DATA, "portfolios", uid + ".json"), "utf8"));
  writeFileSync(path.join(DATA, "portfolios", uid + ".json"), JSON.stringify({ ...raw, marketSettings: { vixZones: mine.vixZones, fearGreedExtremeBelow: 25 } }));
  assert.deepEqual(await getMarketSettings(uid), { vixZones: mine.vixZones, pressureExtremeAbove: 75 });

  // A corrupted stored value never breaks the card.
  writeFileSync(path.join(DATA, "portfolios", uid + ".json"), JSON.stringify({ ...raw, marketSettings: { vixZones: { calmBelow: 50, alertBelow: 40, buyBelow: 30, panicUpTo: 20 }, pressureExtremeAbove: 999 } }));
  assert.deepEqual(await getMarketSettings(uid), DEFAULT_MARKET_SETTINGS);
});
