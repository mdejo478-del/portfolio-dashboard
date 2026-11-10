// rebuildEquityHistory must value held positions even when the trade journal
// has no trades for them (audit finding H4 / case 10). Network is mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildEquityHistory } from "../src/lib/equityHistory";

const now = Math.floor(Date.now() / 1000);
globalThis.fetch = (async () => {
  const timestamp: number[] = []; const close: number[] = [];
  for (let d = 30; d >= 0; d--) { timestamp.push(now - d * 86400); close.push(100); }
  return new Response(JSON.stringify({ chart: { result: [{ timestamp, indicators: { quote: [{ close }] } }] } }), { status: 200 });
}) as typeof fetch;

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const trade = (id: number, date: string, symbol: string, action: string, qty: number, price: number) =>
  ({ id, date, symbol, action, qty, price, value: qty * price, fee: 0, pnl: null, retPct: null, strategy: null, notes: null });
const pos = (id: number, symbol: string, qty: number | null, value: number) =>
  ({ id, symbol, qty, price: qty ? value / qty : null, value, weight: 0, dev: 0, min: 0, max: 1, dilute: 1 });

test("held position with no trades is included in the rebuilt value", async () => {
  const trades = [trade(1, day(20), "CASH", "הפקדה", 1, 1000), trade(2, day(10), "AAA", "קנייה", 5, 100)];
  const positions = [pos(1, "CASH", null, 500), pos(2, "AAA", 5, 500), pos(3, "NOTRADES", 10, 1000)];
  const { history } = await rebuildEquityHistory(trades, positions);
  assert.equal(history[history.length - 1].value, 2000);
});

test("symbols beyond the cap are reported, not silently dropped", async () => {
  const trades = [trade(1, day(5), "CASH", "הפקדה", 1, 100)];
  const positions = [pos(0, "CASH", null, 100), ...Array.from({ length: 61 }, (_, i) => pos(i + 1, "S" + i, 1, 100))];
  const { warnings } = await rebuildEquityHistory(trades, positions);
  assert.ok(warnings.some((w) => w.includes("S60")), "expected a warning naming the excluded symbol");
});
