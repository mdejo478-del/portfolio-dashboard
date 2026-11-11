// The market-status card's rules: VIX zones (every zone and edge), custom thresholds, settings
// validation (Hebrew) including the pressure-index threshold, and the reliability status of a
// reading. Pure logic; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MARKET_SETTINGS, DEFAULT_PRESSURE_EXTREME_ABOVE, DEFAULT_VIX_ZONES, SPX_STALE_AFTER_MS, VIX_STALE_AFTER_MS, VIX_ZONE_LABEL,
  changeOf, gaugeFraction, missingReading, normalizeMarketSettings, readingStatus,
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

// ---- settings --------------------------------------------------------------------------------------

test("settings: the defaults are valid, and valid custom settings are accepted as given", () => {
  assert.deepEqual(DEFAULT_MARKET_SETTINGS, { vixZones: { calmBelow: 20, alertBelow: 25, buyBelow: 30, panicUpTo: 40 }, pressureExtremeAbove: 75 });
  assert.equal(DEFAULT_PRESSURE_EXTREME_ABOVE, 75);
  const ok = validateMarketSettings(DEFAULT_MARKET_SETTINGS);
  assert.ok(ok.ok);
  const custom = { vixZones: { calmBelow: 14.5, alertBelow: 21, buyBelow: 27.5, panicUpTo: 36 }, pressureExtremeAbove: 60 };
  const r = validateMarketSettings(custom);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.settings, custom);
});

test("settings: every kind of bad input is refused with a Hebrew explanation", () => {
  const z = (o: object) => ({ vixZones: { ...DEFAULT_VIX_ZONES, ...o }, pressureExtremeAbove: 75 });
  const bad: unknown[] = [
    null, "x", 5, {},                                           // not settings
    { pressureExtremeAbove: 75 },                               // no zones
    z({ calmBelow: "20" }), z({ alertBelow: NaN }), z({ buyBelow: null }), z({ panicUpTo: Infinity }),   // not numbers
    z({ calmBelow: 0 }), z({ calmBelow: -5 }),                  // first threshold must be > 0
    z({ calmBelow: 25 }), z({ alertBelow: 20 }), z({ buyBelow: 25 }), z({ panicUpTo: 30 }), z({ panicUpTo: 10 }),   // not strictly ascending
    z({ panicUpTo: 151 }),                                      // absurd
    { ...z({}), pressureExtremeAbove: 0 }, { ...z({}), pressureExtremeAbove: 100 }, { ...z({}), pressureExtremeAbove: -3 },
    { ...z({}), pressureExtremeAbove: "75" }, { ...z({}), pressureExtremeAbove: NaN }, { vixZones: DEFAULT_VIX_ZONES },
    { vixZones: DEFAULT_VIX_ZONES, fearGreedExtremeBelow: 25 },  // the removed CNN setting is not a substitute
  ];
  for (const input of bad) {
    const r = validateMarketSettings(input);
    assert.equal(r.ok, false, "refused: " + JSON.stringify(input));
    if (!r.ok) assert.ok(HEBREW.test(r.message), "Hebrew message for " + JSON.stringify(input));
  }
  const order = validateMarketSettings(z({ buyBelow: 22 }));
  assert.ok(!order.ok && order.message.includes("לעלות"), "the ordering rule is explained");
  const pressure = validateMarketSettings({ ...z({}), pressureExtremeAbove: 120 });
  assert.ok(!pressure.ok && pressure.message.includes("מדד הלחץ") && pressure.message.includes("75"), "the pressure threshold rule is explained");
});

test("settings: stored junk falls back to the defaults and never breaks the card; the defaults are never shared", () => {
  for (const junk of [undefined, null, 7, "x", {}, { vixZones: { calmBelow: 30, alertBelow: 20, buyBelow: 10, panicUpTo: 5 }, pressureExtremeAbove: 500 }]) {
    assert.deepEqual(normalizeMarketSettings(junk), DEFAULT_MARKET_SETTINGS);
  }
  const custom = { vixZones: { calmBelow: 18, alertBelow: 24, buyBelow: 29, panicUpTo: 38 }, pressureExtremeAbove: 80 };
  assert.deepEqual(normalizeMarketSettings(custom), custom);
  const copy = normalizeMarketSettings(undefined);
  copy.vixZones.calmBelow = 1;
  assert.equal(DEFAULT_MARKET_SETTINGS.vixZones.calmBelow, 20, "mutating a result doesn't change the defaults");
});

test("settings: a part that is fine is kept when another part is not - VIX zones saved before the pressure threshold existed", () => {
  const zones = { calmBelow: 16, alertBelow: 22, buyBelow: 28, panicUpTo: 36 };
  // What the first version stored (a Fear & Greed threshold, no pressure threshold): the owner's zones survive.
  assert.deepEqual(normalizeMarketSettings({ vixZones: zones, fearGreedExtremeBelow: 25 }), { vixZones: zones, pressureExtremeAbove: 75 });
  assert.deepEqual(normalizeMarketSettings({ vixZones: zones }), { vixZones: zones, pressureExtremeAbove: 75 });
  // The reverse: a good pressure threshold with broken zones.
  assert.deepEqual(normalizeMarketSettings({ vixZones: { calmBelow: 9, alertBelow: 8, buyBelow: 7, panicUpTo: 6 }, pressureExtremeAbove: 60 }), { vixZones: DEFAULT_VIX_ZONES, pressureExtremeAbove: 60 });
});

// ---- reliability status ---------------------------------------------------------------------------------

test("reading status: ok while fresh, stale once older than allowed, missing without a value", () => {
  const NOW = Date.parse("2026-03-10T15:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  assert.equal(readingStatus(17, ago(60_000), NOW, VIX_STALE_AFTER_MS), "ok");
  assert.equal(readingStatus(17, ago(VIX_STALE_AFTER_MS), NOW, VIX_STALE_AFTER_MS), "ok", "exactly at the limit");
  assert.equal(readingStatus(17, ago(VIX_STALE_AFTER_MS + 1), NOW, VIX_STALE_AFTER_MS), "stale");
  assert.equal(readingStatus(7600, ago(2 * 3600_000), NOW, SPX_STALE_AFTER_MS), "ok", "the S&P 500 series is allowed to be older");
  assert.equal(readingStatus(7600, ago(4 * 3600_000), NOW, SPX_STALE_AFTER_MS), "stale");
  assert.equal(readingStatus(null, ago(1), NOW, VIX_STALE_AFTER_MS), "missing");
  assert.equal(readingStatus(NaN, ago(1), NOW, VIX_STALE_AFTER_MS), "missing");
  assert.equal(readingStatus(17, null, NOW, VIX_STALE_AFTER_MS), "stale", "known only from the stored history");
  assert.equal(readingStatus(17, "garbage", NOW, VIX_STALE_AFTER_MS), "stale");
  const m = missingReading("Yahoo Finance");
  assert.deepEqual([m.value, m.status, m.source], [null, "missing", "Yahoo Finance"]);
});

test("change since yesterday: absolute and percent, and nothing when there is no yesterday", () => {
  const c = changeOf({ value: 17.63, previous: 19.46 });
  assert.ok(c && Math.abs(c.abs - -1.83) < 1e-9 && c.pct !== null && Math.abs(c.pct - (-1.83 / 19.46)) < 1e-9);
  assert.deepEqual(changeOf({ value: 20, previous: 0 }), { abs: 20, pct: null }, "no percent from zero");
  assert.equal(changeOf({ value: 20, previous: null }), null);
  assert.equal(changeOf({ value: null, previous: 20 }), null);
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
