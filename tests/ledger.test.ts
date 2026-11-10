// Trade-journal ledger (audit findings H1-H3). Cases 1-7 mirror the seven ways
// the old incremental ledger went wrong; each is stated as what the user did and
// what the ledger must say afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, ledgerBefore, suggestSellPnl, retPctFor, diffLedgers, planImport, type ImportRowInput } from "../src/lib/ledger";
import { splitDuplicates, tradeFingerprint } from "../src/lib/tradeDuplicates";
import type { Trade } from "../src/lib/portfolioTypes";

const BUY = "קנייה";
const SELL = "מכירה";
const T = (id: number, date: string, symbol: string, action: string, qty: number, price: number, pnl: number | null = null): Trade =>
  ({ id, date, symbol, action, qty, price, value: qty * price, fee: 0, pnl, retPct: null, strategy: null, notes: null });
const row = (date: string, symbol: string, action: string, qty: number, price: number, pnlOverride: number | null = null): ImportRowInput =>
  ({ date, symbol, action, qty, price, fee: 0, pnlOverride, strategy: null, notes: null });
const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

// ---- H1 -------------------------------------------------------------------

test("case 1: editing a buy replaces it (10 edited to 12 = 12, not 22)", () => {
  const before = [T(1, "2026-01-05", "NVDA", BUY, 10, 100)];
  const edited = before.map((t) => (t.id === 1 ? { ...t, qty: 12, value: 1200 } : t));
  assert.deepEqual(buildLedger(edited).ledger, { NVDA: { qty: 12, avgCost: 100 } });
});

test("case 2: deleting a trade is reflected in the ledger", () => {
  const trades = [T(1, "2026-01-05", "NVDA", BUY, 10, 100), T(2, "2026-01-06", "NVDA", BUY, 10, 200)];
  assert.deepEqual(buildLedger(trades).ledger, { NVDA: { qty: 20, avgCost: 150 } });
  assert.deepEqual(buildLedger(trades.filter((t) => t.id !== 2)).ledger, { NVDA: { qty: 10, avgCost: 100 } });
  assert.deepEqual(buildLedger([]).ledger, {}, "deleting everything leaves an empty ledger");
});

test("case 3: a trade dated in the past is applied at its date, not at the end", () => {
  // Entered in this order (ids), but dated out of order.
  const trades = [
    T(1, "2026-03-01", "NVDA", BUY, 10, 100),
    T(2, "2026-02-01", "NVDA", BUY, 10, 50),   // backdated
    T(3, "2026-02-15", "NVDA", SELL, 5, 80),   // backdated
  ];
  const r = buildLedger(trades);
  assert.equal(r.issues.length, 0, "the sell is covered by the earlier buy");
  near(r.ledger.NVDA.qty, 15);
  near(r.ledger.NVDA.avgCost, (5 * 50 + 10 * 100) / 15);
  assert.deepEqual(r.sellContext.get(3), { heldQty: 10, avgCost: 50 }, "the sell is measured against the Feb position");
  assert.equal(suggestSellPnl(r.sellContext.get(3), 80, 5).pnl, 150);
  // Order of the array must not matter, only dates and ids.
  assert.deepEqual(buildLedger([...trades].reverse()).ledger, r.ledger);
});

test("case 4: importing an old file slots its trades in by date", () => {
  const existing = [T(1, "2026-03-01", "NVDA", BUY, 10, 100)]; // pnl null, must stay untouched
  const plan = planImport(existing, [row("2026-02-15", "NVDA", SELL, 5, 80), row("2026-02-01", "NVDA", BUY, 10, 50)], 2);
  assert.deepEqual(plan.newTrades.map((t) => [t.id, t.date, t.action]), [[2, "2026-02-01", BUY], [3, "2026-02-15", SELL]], "chronological, consecutive ids");
  assert.equal(plan.newTrades[1].pnl, 150, "profit measured against the Feb position (avg 50), not the later March buy");
  near(plan.ledger.NVDA.qty, 15);
  near(plan.ledger.NVDA.avgCost, (5 * 50 + 10 * 100) / 15);
  assert.equal(existing[0].pnl, null, "existing trades are not modified");
  near(plan.cashDelta, -500 + 400);
});

// ---- H2 -------------------------------------------------------------------

test("case 5: a sell with no buy history gets no profit (null, not 0) and no ledger entry", () => {
  const trades = [T(1, "2026-01-05", "AAPL", SELL, 5, 100)];
  const r = buildLedger(trades);
  assert.deepEqual(r.ledger, {}, "no entry, no negative quantity");
  assert.deepEqual(r.issues, [{ tradeId: 1, symbol: "AAPL", kind: "no-history", heldQty: 0, soldQty: 5 }]);
  assert.deepEqual(suggestSellPnl(r.sellContext.get(1), 100, 5), { pnl: null, warning: "no-history", heldQty: 0 });
  assert.deepEqual(suggestSellPnl(undefined, 100, 5), { pnl: null, warning: "no-history", heldQty: 0 });
  assert.equal(retPctFor(null, 500), null);
  // Through import: unresolved unless the file supplies the profit.
  const plan = planImport([], [row("2026-01-05", "AAPL", SELL, 5, 100)], 1);
  assert.equal(plan.newTrades[0].pnl, null);
  assert.equal(plan.newTrades[0].retPct, null);
  assert.equal(plan.unresolvedSells.length, 1);
  const withOverride = planImport([], [row("2026-01-05", "AAPL", SELL, 5, 100, 42)], 1);
  assert.equal(withOverride.newTrades[0].pnl, 42, "a profit from the file still wins");
  assert.equal(withOverride.unresolvedSells.length, 0);
});

test("case 6: selling more than held never drives the quantity negative", () => {
  const trades = [T(1, "2026-01-05", "NVDA", BUY, 10, 100), T(2, "2026-01-06", "NVDA", SELL, 15, 120)];
  const r = buildLedger(trades);
  assert.deepEqual(r.ledger, {}, "position emptied, not -5");
  assert.deepEqual(r.issues, [{ tradeId: 2, symbol: "NVDA", kind: "exceeds-holding", heldQty: 10, soldQty: 15 }]);
  assert.deepEqual(suggestSellPnl(r.sellContext.get(2), 120, 15), { pnl: null, warning: "exceeds-holding", heldQty: 10 });
  // A covered partial sell is unaffected.
  const partial = buildLedger([trades[0], T(2, "2026-01-06", "NVDA", SELL, 4, 120)]);
  assert.deepEqual(partial.ledger, { NVDA: { qty: 6, avgCost: 100 } });
  assert.equal(suggestSellPnl(partial.sellContext.get(2), 120, 4).pnl, 80);
});

// ---- H3 -------------------------------------------------------------------

test("case 7: importing the same file twice adds nothing the second time", () => {
  const file = [row("2026-02-01", "NVDA", BUY, 10, 50), row("2026-02-15", "NVDA", SELL, 5, 80)];
  const first = splitDuplicates([], file);
  assert.equal(first.fresh.length, 2);
  const journal = planImport([], first.fresh, 1).newTrades;
  const second = splitDuplicates(journal, file);
  assert.equal(second.fresh.length, 0, "nothing new");
  assert.equal(second.duplicates.length, 2, "both rows reported as already present");
});

test("case 7b: identical separate fills are kept (matching is by count, not by set)", () => {
  const fill = row("2026-02-01", "NVDA", BUY, 10, 50);
  assert.equal(splitDuplicates([], [fill, fill]).fresh.length, 2, "empty journal: both fills import");
  assert.deepEqual(
    (({ fresh, duplicates }) => [fresh.length, duplicates.length])(splitDuplicates([T(1, "2026-02-01", "NVDA", BUY, 10, 50)], [fill, fill])),
    [1, 1], "journal has one of the two: one skipped, one added");
  assert.equal(splitDuplicates([T(1, "2026-02-01", "NVDA", BUY, 10, 50), T(2, "2026-02-01", "NVDA", BUY, 10, 50)], [fill, fill]).fresh.length, 0, "journal has both: both skipped");
});

test("fingerprint ignores symbol case/whitespace and float noise, but not a different price or date", () => {
  const base = { date: "2026-02-01", symbol: "NVDA", action: BUY, qty: 3, price: 0.3 };
  assert.equal(tradeFingerprint({ ...base, symbol: " nvda ", price: 0.1 + 0.2 }), tradeFingerprint(base));
  assert.notEqual(tradeFingerprint({ ...base, price: 0.31 }), tradeFingerprint(base));
  assert.notEqual(tradeFingerprint({ ...base, date: "2026-02-02" }), tradeFingerprint(base));
});

// ---- supporting behavior ------------------------------------------------------

test("ledgerBefore measures a new/edited trade against what came before it", () => {
  const trades = [T(1, "2026-02-01", "NVDA", BUY, 10, 50), T(2, "2026-03-01", "NVDA", BUY, 10, 100)];
  assert.deepEqual(ledgerBefore(trades, { date: "2026-02-15", id: Infinity }), { NVDA: { qty: 10, avgCost: 50 } });
  assert.deepEqual(ledgerBefore(trades, { date: "2026-03-01", id: 2 }, 2), { NVDA: { qty: 10, avgCost: 50 } }, "editing trade 2 excludes it");
  assert.deepEqual(ledgerBefore(trades, { date: "2026-01-01", id: Infinity }), {}, "before any trade");
});

test("diffLedgers reports drift per symbol, ignores empties, and flags negative quantities", () => {
  const rebuilt = { NVDA: { qty: 12, avgCost: 100 } };
  assert.deepEqual(diffLedgers({ NVDA: { qty: 12, avgCost: 100 } }, rebuilt), []);
  assert.deepEqual(diffLedgers({ NVDA: { qty: 12, avgCost: 100 + 1e-12 }, GONE: { qty: 0, avgCost: 5 } }, rebuilt), [], "float noise and closed positions are not drift");
  assert.deepEqual(diffLedgers({ NVDA: { qty: 22, avgCost: 100 } }, rebuilt), [{ symbol: "NVDA", stored: { qty: 22, avgCost: 100 }, rebuilt: { qty: 12, avgCost: 100 } }]);
  assert.deepEqual(diffLedgers({ NVDA: { qty: 12, avgCost: 100 }, AAPL: { qty: -5, avgCost: 90 } }, rebuilt), [{ symbol: "AAPL", stored: { qty: -5, avgCost: 90 }, rebuilt: null }], "a saved negative quantity is drift");
  assert.deepEqual(diffLedgers({}, rebuilt), [{ symbol: "NVDA", stored: null, rebuilt: { qty: 12, avgCost: 100 } }]);
  const stored = { NVDA: { qty: 22, avgCost: 100 } };
  diffLedgers(stored, rebuilt);
  assert.deepEqual(stored, { NVDA: { qty: 22, avgCost: 100 } }, "inputs are never modified");
});

test("CASH rows, deposits and other actions never enter the ledger", () => {
  const r = buildLedger([T(1, "2026-01-01", "CASH", "הפקדה", 1, 1000), T(2, "2026-01-02", "CASH", BUY, 1, 5), T(3, "2026-01-03", "NVDA", "אחר", 5, 10)]);
  assert.deepEqual(r.ledger, {});
  assert.equal(r.issues.length, 0);
});
