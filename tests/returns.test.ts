// Known-answer tests for src/lib/returns.ts (audit cases 8 and 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { externalFlowsByDate, timeWeightedReturn, performanceDrawdown } from "../src/lib/returns";

const T = (date: string, action: string, value: number, fee = 0) => ({ date, action, value, fee });
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

test("deposit is not counted as profit (TWR = 10.25%, not 62.75%)", () => {
  // +5% on 10,000 -> 10,500, then a 5,000 deposit (15,500), then +5% -> 16,275.
  const points = [{ date: "2026-01-01", value: 10_000 }, { date: "2026-01-15", value: 15_500 }, { date: "2026-01-30", value: 16_275 }];
  const flows = externalFlowsByDate([T("2026-01-15", "הפקדה", 5_000)]);
  close(timeWeightedReturn(points, flows), 0.1025);
});

test("withdrawal does not register as a drawdown or a loss", () => {
  const points = [{ date: "2026-02-01", value: 10_000 }, { date: "2026-02-02", value: 8_500 }];
  const flows = externalFlowsByDate([T("2026-02-02", "משיכה", 1_500)]);
  close(timeWeightedReturn(points, flows), 0);
  assert.equal(performanceDrawdown(points, flows), 0);
});

test("a real market drop is still a drawdown", () => {
  const points = [{ date: "2026-03-01", value: 10_000 }, { date: "2026-03-02", value: 11_000 }, { date: "2026-03-03", value: 9_680 }];
  close(performanceDrawdown(points, new Map()), -0.12);
});

test("no flows: TWR equals simple return", () => {
  const points = [{ date: "2026-04-01", value: 2_000 }, { date: "2026-04-10", value: 2_500 }];
  close(timeWeightedReturn(points, new Map()), 0.25);
});

test("deposits on or before the first point are starting capital", () => {
  const points = [{ date: "2026-05-01", value: 10_000 }, { date: "2026-05-02", value: 11_000 }];
  const flows = externalFlowsByDate([T("2026-04-20", "הפקדה", 10_000)]);
  close(timeWeightedReturn(points, flows), 0.1);
});

test("transfer fee is part of the flow (matches cashEffect)", () => {
  const flows = externalFlowsByDate([T("2026-06-01", "הפקדה", 1_000, -5), T("2026-06-01", "קנייה", 500, -2.5)]);
  assert.equal(flows.get("2026-06-01"), 995);
  assert.equal(flows.size, 1);
});

test("single point has no return yet", () => {
  assert.equal(timeWeightedReturn([{ date: "2026-07-01", value: 1 }], new Map()), null);
});
