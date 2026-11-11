// 10.2 - the own-calculation market pressure index: known values for every component, a missing
// component (left out, never counted as 0), backwardation, status, and the owner's extreme rule.
// Pure logic; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRESSURE_ANCHORS, buildPressureComponents, buildPressureIndex, computePressureIndex, drawdownFromHigh, highestCloseWithin,
  isBackwardation, isExtremePressure, lineScore, missingComponent, pressureFormulaLines, scoreDrawdown, scoreTermStructure,
  scoreTrend, scoreVix, simpleMovingAverage, termRatio, trendVsAverage, type InputReading, type SpxInput,
} from "../src/lib/marketPressure";

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const NOW = "2026-03-10T15:00:00.000Z";
const ok = (value: number): InputReading => ({ value, status: "ok", fetchedAt: NOW, asOf: NOW });
const gone: InputReading = { value: null, status: "missing", fetchedAt: null, asOf: null };
const spx = (value: number | null, high52: number | null, ma125: number | null, status: InputReading["status"] = "ok"): SpxInput =>
  ({ value, high52, ma125, status: value === null ? "missing" : status, fetchedAt: value === null ? null : NOW, asOf: value === null ? null : NOW });

// ---- each component, at its anchors, at its middle, and beyond ------------------------------------------

test("line scores: 0 at the calm anchor, 100 at the panic anchor, a straight line between, clamped outside", () => {
  assert.equal(lineScore(10, 10, 20), 0);
  assert.equal(lineScore(20, 10, 20), 100);
  assert.equal(lineScore(15, 10, 20), 50);
  assert.equal(lineScore(-5, 10, 20), 0);
  assert.equal(lineScore(99, 10, 20), 100);
  assert.equal(lineScore(0.05, 0.05, -0.1), 0, "works when the panic anchor is the smaller number");
  assert.equal(lineScore(-0.1, 0.05, -0.1), 100);
});

test("component 1 - VIX level: 12 -> 0, 40 -> 100", () => {
  assert.equal(scoreVix(12), 0);
  assert.equal(scoreVix(26), 50);
  assert.equal(scoreVix(40), 100);
  assert.equal(scoreVix(9), 0, "below the calm anchor");
  assert.equal(scoreVix(80), 100, "above the panic anchor");
  near(scoreVix(17.63), (17.63 - 12) / 28 * 100);
});

test("component 2 - VIX / VIX3M: 0.80 -> 0, 1.00 -> 50, 1.20 -> 100; above 1 is backwardation", () => {
  assert.equal(scoreTermStructure(0.8), 0);
  assert.equal(scoreTermStructure(1.0), 50);
  assert.equal(scoreTermStructure(1.2), 100);
  assert.equal(scoreTermStructure(0.7), 0);
  assert.equal(scoreTermStructure(1.6), 100);
  near(scoreTermStructure(0.9), 25);
  near(termRatio(17.63, 19.41), 17.63 / 19.41);
  assert.equal(termRatio(null, 19), null);
  assert.equal(termRatio(17, null), null);
  assert.equal(termRatio(17, 0), null, "no division by zero");
  assert.equal(termRatio(0, 19), null);
  assert.equal(isBackwardation(1.0001), true);
  assert.equal(isBackwardation(1), false, "equal is flat, not backwardation");
  assert.equal(isBackwardation(0.93), false);
});

test("component 3 - S&P 500 below its 52-week high: at the high -> 0, 10% below -> 50, 20% below -> 100", () => {
  assert.equal(scoreDrawdown(0), 0);
  assert.equal(scoreDrawdown(0.1), 50);
  assert.equal(scoreDrawdown(0.2), 100);
  assert.equal(scoreDrawdown(0.35), 100);
  near(drawdownFromHigh(108, 120), 0.1);
  assert.equal(drawdownFromHigh(120, 120), 0);
  assert.equal(drawdownFromHigh(125, 120), 0, "a new high can't be a negative drawdown");
  assert.equal(drawdownFromHigh(0, 120), null);
  assert.equal(drawdownFromHigh(100, 0), null);
});

test("component 4 - S&P 500 vs its 125-day average: 5% above -> 0, 2.5% below -> 50, 10% below -> 100", () => {
  assert.equal(scoreTrend(0.05), 0);
  assert.equal(scoreTrend(0.2), 0, "far above the average: no pressure");
  near(scoreTrend(-0.025), 50);
  assert.equal(scoreTrend(-0.1), 100);
  assert.equal(scoreTrend(-0.3), 100);
  near(scoreTrend(0), (0.05 / 0.15) * 100);
  near(trendVsAverage(108, 107.904), 108 / 107.904 - 1);
  assert.equal(trendVsAverage(0, 100), null);
});

test("moving average and 52-week high are computed from the daily closes", () => {
  assert.equal(simpleMovingAverage([1, 2, 3, 4, 5], 3), 4, "the LAST 3");
  assert.equal(simpleMovingAverage([1, 2], 3), null, "not enough data is missing, not a guess");
  assert.equal(simpleMovingAverage([5], 1), 5);
  const day = 86_400;
  const now = 1_800_000_000;
  const t = [now - 400 * day, now - 300 * day, now - 100 * day, now - 1 * day];
  const c = [500, 120, 110, 115];
  assert.equal(highestCloseWithin(t, c, now, 365), 120, "the 500 from 400 days ago is outside the 52 weeks");
  assert.equal(highestCloseWithin(t, c, now, 30), 115);
  assert.equal(highestCloseWithin([], [], now, 365), null);
});

// ---- the index ---------------------------------------------------------------------------------------------

test("the index is the average of the four components - a known case worked by hand", () => {
  // VIX 17.63, VIX3M 19.41, S&P 108 with a 52-week high of 120 and a 125-day average of 107.904
  const components = buildPressureComponents({ vix: ok(17.63), vix3m: ok(19.41), spx: spx(108, 120, 107.904) });
  assert.deepEqual(components.map((c) => c.id), ["vix", "term", "drawdown", "trend"]);
  near(components[0].score, 20.10714, 1e-4);
  near(components[1].score, 27.07375, 1e-4);
  near(components[2].score, 50);
  near(components[3].score, 32.74021, 1e-4);
  near(components[1].raw, 17.63 / 19.41);
  assert.equal(components[1].backwardation, false);
  const idx = buildPressureIndex({ vix: ok(17.63), vix3m: ok(19.41), spx: spx(108, 120, 107.904) });
  assert.equal(idx.value, 32.5, "mean (20.107 + 27.074 + 50 + 32.740) / 4 = 32.48, rounded to one decimal");
  assert.deepEqual([idx.available, idx.missing, idx.status], [4, 0, "ok"]);
});

test("a calm market and a panic market sit at the two ends of the scale", () => {
  const calm = buildPressureIndex({ vix: ok(11), vix3m: ok(15), spx: spx(110, 110, 100) });
  assert.equal(calm.value, 0);
  const panic = buildPressureIndex({ vix: ok(45), vix3m: ok(36), spx: spx(70, 100, 100) });
  assert.equal(panic.value, 100);
});

test("backwardation (short-term VIX above the 3-month VIX) is flagged and pushes the ratio component above 50", () => {
  const c = buildPressureComponents({ vix: ok(24), vix3m: ok(21), spx: spx(100, 100, 100) });
  assert.equal(c[1].backwardation, true);
  near(c[1].raw, 24 / 21);
  near(c[1].score, (24 / 21 - 0.8) / 0.4 * 100);
  assert.ok((c[1].score as number) > 50);
  assert.equal(c[0].backwardation || c[2].backwardation || c[3].backwardation, false, "only the ratio component can be");
});

test("a missing component is left out - it is NOT counted as 0 - and the index says how many it is built from", () => {
  // VIX3M unavailable: the ratio component is missing, the other three carry on.
  const idx = buildPressureIndex({ vix: ok(17.63), vix3m: gone, spx: spx(108, 120, 107.904) });
  assert.deepEqual([idx.available, idx.missing], [3, 1]);
  assert.equal(idx.value, 34.3, "mean of the three: (20.107 + 50 + 32.740) / 3 = 34.28");
  const withZero = (20.10714 + 0 + 50 + 32.74021) / 4;
  assert.ok(Math.abs((idx.value as number) - withZero) > 5, "counting the missing one as 0 would have given " + withZero.toFixed(1));
  const term = idx.components.find((c) => c.id === "term")!;
  assert.deepEqual([term.status, term.score, term.raw], ["missing", null, null]);

  // The S&P series gone: both its components are missing, the VIX ones remain.
  const noSpx = buildPressureIndex({ vix: ok(17.63), vix3m: ok(19.41), spx: spx(null, null, null) });
  assert.deepEqual([noSpx.available, noSpx.missing], [2, 2]);
  near(noSpx.value, Math.round(((20.10714 + 27.07375) / 2) * 10) / 10, 1e-9);

  // The S&P price is there but too little history for the 125-day average: only that component is missing.
  const young = buildPressureIndex({ vix: ok(17), vix3m: ok(19), spx: spx(100, 110, null) });
  assert.deepEqual(young.components.map((c) => c.status), ["ok", "ok", "ok", "missing"]);

  // Everything missing: no number at all.
  const none = buildPressureIndex({ vix: gone, vix3m: gone, spx: spx(null, null, null) });
  assert.deepEqual([none.value, none.available, none.missing, none.status], [null, 0, 4, "missing"]);
  assert.deepEqual(computePressureIndex([]).value, null);
});

test("reliability: every component carries its own status; the index is stale if any component in use is", () => {
  const idx = buildPressureIndex({ vix: ok(17), vix3m: ok(19), spx: spx(100, 110, 99, "stale") });
  assert.deepEqual(idx.components.map((c) => c.status), ["ok", "ok", "stale", "stale"]);
  assert.equal(idx.status, "stale");
  // A ratio built from one fresh and one stale input is stale, and carries the OLDER time.
  const older = "2026-03-10T13:00:00.000Z";
  const c = buildPressureComponents({ vix: ok(17), vix3m: { value: 19, status: "stale", fetchedAt: older, asOf: older }, spx: spx(100, 110, 99) });
  assert.equal(c[1].status, "stale");
  assert.equal(c[1].fetchedAt, older);
  assert.equal(c[0].status, "ok", "the VIX component itself is unaffected");
  // A stale component still counts (it is shown as stale); a missing one never does.
  assert.equal(computePressureIndex([{ ...missingComponent("vix") }, { ...missingComponent("term") }]).status, "missing");
});

test("the owner's rule: pressure ABOVE the threshold is extreme", () => {
  assert.equal(isExtremePressure(75.1, 75), true);
  assert.equal(isExtremePressure(75, 75), false);
  assert.equal(isExtremePressure(10, 75), false);
  assert.equal(isExtremePressure(61, 60), true, "a custom threshold");
});

test("the formulas shown to the user come from the same anchors as the code", () => {
  const text = pressureFormulaLines().join("\n");
  assert.ok(text.includes(String(PRESSURE_ANCHORS.vix.calm)) && text.includes(String(PRESSURE_ANCHORS.vix.panic)));
  assert.ok(text.includes("backwardation") && text.includes("125") && text.includes("52"));
  assert.ok(text.includes("לא נספר כ-0"));
});
