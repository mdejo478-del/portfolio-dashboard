// 9.2 - the market-status card's rules: VIX zones (every zone and edge), the Fear & Greed
// extreme-fear rule, custom thresholds, settings validation (Hebrew), and the reliability
// status of a reading. Pure logic; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MARKET_SETTINGS, DEFAULT_VIX_ZONES, FEAR_GREED_STALE_AFTER_MS, VIX_STALE_AFTER_MS, VIX_ZONE_LABEL,
  changeOf, fearGreedRatingHe, gaugeFraction, isExtremeFear, missingReading, normalizeMarketSettings, readingStatus,
  validateMarketSettings, vixGaugeMax, vixGaugeSegments, vixZone, type VixZoneId,
} from "../src/lib/marketStatus";

const HEBREW = /[֐-׿]/;

// ---- VIX zones: under 20 calm, 20-25 alert, 25-30 buying zone, 30-40 panic, above 40 extreme -------

test("VIX: a value in every zone, with the default rules", () => {
  const cases: Array<[number, VixZoneId]> = [[9, "calm"], [14.5, "calm"], [22, "alert"], [27, "buy"], [35, "panic"], [45, "extreme"], [80, "extreme"]];
  for (const [v, zone] of cases) assert.equal(vixZone(v), zone, "VIX " + v);
});

test("VIX: the edges - on an edge the HIGHER zone, except 40 itself which is still panic", () => {
  const edges: Array<[number, VixZoneId]> = [
    [19.99, "calm"], [20, "alert"], [24.99, "alert"], [25, "buy"], [29.99, "buy"], [30, "panic"], [40, "panic"], [40.01, "extreme"],
  ];
  for (const [v, zone] of edges) assert.equal(vixZone(v), zone, "VIX " + v);
});

test("VIX zones have Hebrew names", () => {
  assert.deepEqual(VIX_ZONE_LABEL, { calm: "רגוע", alert: "דריכות", buy: "אזור קנייה", panic: "פאניקה", extreme: "פאניקה קיצונית" });
});

test("VIX: custom thresholds move the zones", () => {
  const custom = { calmBelow: 15, alertBelow: 22, buyBelow: 28, panicUpTo: 35 };
  assert.equal(vixZone(17.63, DEFAULT_VIX_ZONES), "calm");
  assert.equal(vixZone(17.63, custom), "alert", "the same value is a different zone under the owner's own thresholds");
  assert.equal(vixZone(14.99, custom), "calm");
  assert.equal(vixZone(15, custom), "alert");
  assert.equal(vixZone(35, custom), "panic");
  assert.equal(vixZone(35.5, custom), "extreme");
  assert.equal(vixZone(23, { ...custom, alertBelow: 24 }), "alert");
});

test("Fear & Greed: below the threshold is extreme fear (default 25), the threshold itself is not", () => {
  assert.equal(isExtremeFear(24.9), true);
  assert.equal(isExtremeFear(10), true);
  assert.equal(isExtremeFear(25), false);
  assert.equal(isExtremeFear(60), false);
  assert.equal(isExtremeFear(29, 30), true, "a custom threshold");
  assert.equal(isExtremeFear(30, 30), false);
});

// ---- settings --------------------------------------------------------------------------------------

test("settings: the defaults are valid, and valid custom settings are accepted as given", () => {
  assert.deepEqual(DEFAULT_MARKET_SETTINGS, { vixZones: { calmBelow: 20, alertBelow: 25, buyBelow: 30, panicUpTo: 40 }, fearGreedExtremeBelow: 25 });
  const ok = validateMarketSettings(DEFAULT_MARKET_SETTINGS);
  assert.ok(ok.ok);
  const custom = { vixZones: { calmBelow: 14.5, alertBelow: 21, buyBelow: 27.5, panicUpTo: 36 }, fearGreedExtremeBelow: 30 };
  const r = validateMarketSettings(custom);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.settings, custom);
});

test("settings: every kind of bad input is refused with a Hebrew explanation", () => {
  const z = (o: object) => ({ vixZones: { ...DEFAULT_VIX_ZONES, ...o }, fearGreedExtremeBelow: 25 });
  const bad: unknown[] = [
    null, "x", 5, {},                                           // not settings
    { fearGreedExtremeBelow: 25 },                              // no zones
    z({ calmBelow: "20" }), z({ alertBelow: NaN }), z({ buyBelow: null }), z({ panicUpTo: Infinity }),   // not numbers
    z({ calmBelow: 0 }), z({ calmBelow: -5 }),                  // first threshold must be > 0
    z({ calmBelow: 25 }), z({ alertBelow: 20 }), z({ buyBelow: 25 }), z({ panicUpTo: 30 }), z({ panicUpTo: 10 }),   // not strictly ascending
    z({ panicUpTo: 151 }),                                      // absurd
    { ...z({}), fearGreedExtremeBelow: 0 }, { ...z({}), fearGreedExtremeBelow: 100 }, { ...z({}), fearGreedExtremeBelow: -3 },
    { ...z({}), fearGreedExtremeBelow: "25" }, { ...z({}), fearGreedExtremeBelow: NaN }, { vixZones: DEFAULT_VIX_ZONES },
  ];
  for (const input of bad) {
    const r = validateMarketSettings(input);
    assert.equal(r.ok, false, "refused: " + JSON.stringify(input));
    if (!r.ok) assert.ok(HEBREW.test(r.message), "Hebrew message for " + JSON.stringify(input));
  }
  const order = validateMarketSettings(z({ buyBelow: 22 }));
  assert.ok(!order.ok && order.message.includes("לעלות"), "the ordering rule is explained");
});

test("settings: stored junk falls back to the defaults and never breaks the card; the defaults are never shared", () => {
  for (const junk of [undefined, null, 7, "x", {}, { vixZones: { calmBelow: 30, alertBelow: 20, buyBelow: 10, panicUpTo: 5 }, fearGreedExtremeBelow: 25 }]) {
    assert.deepEqual(normalizeMarketSettings(junk), DEFAULT_MARKET_SETTINGS);
  }
  const custom = { vixZones: { calmBelow: 18, alertBelow: 24, buyBelow: 29, panicUpTo: 38 }, fearGreedExtremeBelow: 20 };
  assert.deepEqual(normalizeMarketSettings(custom), custom);
  const copy = normalizeMarketSettings(undefined);
  copy.vixZones.calmBelow = 1;
  assert.equal(DEFAULT_MARKET_SETTINGS.vixZones.calmBelow, 20, "mutating a result doesn't change the defaults");
});

// ---- reliability status ---------------------------------------------------------------------------------

test("reading status: ok while fresh, stale once older than allowed, missing without a value", () => {
  const NOW = Date.parse("2026-03-10T15:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  assert.equal(readingStatus(17, ago(60_000), NOW, VIX_STALE_AFTER_MS), "ok");
  assert.equal(readingStatus(17, ago(VIX_STALE_AFTER_MS), NOW, VIX_STALE_AFTER_MS), "ok", "exactly at the limit");
  assert.equal(readingStatus(17, ago(VIX_STALE_AFTER_MS + 1), NOW, VIX_STALE_AFTER_MS), "stale");
  assert.equal(readingStatus(50, ago(4 * 3600_000), NOW, FEAR_GREED_STALE_AFTER_MS), "ok", "Fear & Greed is allowed to be older");
  assert.equal(readingStatus(50, ago(7 * 3600_000), NOW, FEAR_GREED_STALE_AFTER_MS), "stale");
  assert.equal(readingStatus(null, ago(1), NOW, VIX_STALE_AFTER_MS), "missing");
  assert.equal(readingStatus(NaN, ago(1), NOW, VIX_STALE_AFTER_MS), "missing");
  assert.equal(readingStatus(17, null, NOW, VIX_STALE_AFTER_MS), "stale", "known only from the stored history");
  assert.equal(readingStatus(17, "garbage", NOW, VIX_STALE_AFTER_MS), "stale");
  const m = missingReading("CNN", true);
  assert.deepEqual([m.value, m.status, m.unofficial, m.source], [null, "missing", true, "CNN"]);
});

test("change since yesterday: absolute and percent, and nothing when there is no yesterday", () => {
  const c = changeOf({ value: 17.63, previous: 19.46 });
  assert.ok(c && Math.abs(c.abs - -1.83) < 1e-9 && c.pct !== null && Math.abs(c.pct - (-1.83 / 19.46)) < 1e-9);
  assert.deepEqual(changeOf({ value: 20, previous: 0 }), { abs: 20, pct: null }, "no percent from zero");
  assert.equal(changeOf({ value: 20, previous: null }), null);
  assert.equal(changeOf({ value: null, previous: 20 }), null);
});

test("CNN's rating word is translated, and an unknown one is not shown", () => {
  assert.equal(fearGreedRatingHe("extreme fear"), "פחד קיצוני");
  assert.equal(fearGreedRatingHe("Extreme_Fear"), "פחד קיצוני");
  assert.equal(fearGreedRatingHe("fear"), "פחד");
  assert.equal(fearGreedRatingHe("neutral"), "ניטרלי");
  assert.equal(fearGreedRatingHe("greed"), "חמדנות");
  assert.equal(fearGreedRatingHe("extreme greed"), "חמדנות קיצונית");
  assert.equal(fearGreedRatingHe("who knows"), null);
  assert.equal(fearGreedRatingHe(null), null);
});

test("gauge: segments cover the scale without gaps, the position is clamped", () => {
  assert.equal(vixGaugeMax(DEFAULT_VIX_ZONES), 50);
  assert.equal(vixGaugeMax({ calmBelow: 30, alertBelow: 45, buyBelow: 60, panicUpTo: 80 }), 100, "grows with the thresholds");
  const segs = vixGaugeSegments(DEFAULT_VIX_ZONES);
  assert.deepEqual(segs.map((s) => s.id), ["calm", "alert", "buy", "panic", "extreme"]);
  assert.equal(segs[0].from, 0);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].from, segs[i - 1].to, "no gap before " + segs[i].id);
  assert.equal(segs[4].to, 50);
  assert.equal(gaugeFraction(25, 50), 0.5);
  assert.equal(gaugeFraction(-3, 50), 0);
  assert.equal(gaugeFraction(500, 50), 1);
  assert.equal(gaugeFraction(NaN, 50), 0);
});
