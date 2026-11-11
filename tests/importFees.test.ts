// M3: a positive fee in an import file used to INCREASE cash (the journal stores fees as
// negative numbers, a cost). The import now detects positive fees, converts them to
// negative ones by default, and lets the user keep them as they are. Trades already in
// the journal are never changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFeeSign, countPositiveFees, effectiveFee } from "../src/lib/importFees";
import { parseTradeFile } from "../src/lib/tradeImport";
import { planImport, type ImportRowInput } from "../src/lib/ledger";
import { splitDuplicates } from "../src/lib/tradeDuplicates";
import { cashEffect, type Trade } from "../src/lib/portfolioTypes";

const BUY = "קנייה";
const row = (date: string, symbol: string, qty: number, price: number, fee: number): ImportRowInput =>
  ({ date, symbol, action: BUY, qty, price, fee, pnlOverride: null, strategy: null, notes: null });

test("positive fees are counted and converted; negative, zero and absent-sign fees are left alone", () => {
  const rows = [{ fee: 2.5 }, { fee: -2.5 }, { fee: 0 }, { fee: 0.01 }];
  assert.equal(countPositiveFees(rows), 2);
  const converted = applyFeeSign(rows, true);
  assert.deepEqual(converted.rows.map((r) => r.fee), [-2.5, -2.5, 0, -0.01]);
  assert.equal(converted.positives, 2);
  const kept = applyFeeSign(rows, false);
  assert.deepEqual(kept.rows.map((r) => r.fee), [2.5, -2.5, 0, 0.01], "switched off: exactly what the file said");
  assert.equal(kept.positives, 2, "and the count is still reported");
  assert.deepEqual(rows, [{ fee: 2.5 }, { fee: -2.5 }, { fee: 0 }, { fee: 0.01 }], "the input rows are not modified");
  assert.equal(effectiveFee(3, true), -3);
  assert.equal(effectiveFee(3, false), 3);
  assert.equal(effectiveFee(-3, true), -3, "already a cost");
  assert.equal(effectiveFee(0, true), 0);
});

test("a real file is parsed and its positive fees are found", () => {
  const csv = "תאריך,סימול,פעולה,כמות,מחיר,עמלה\n2026-02-10,NVDA,קנייה,5,60,2.5\n2026-02-11,AAPL,קנייה,3,150,-1\n2026-02-12,MSFT,קנייה,2,300,0\n2026-02-13,TSLA,קנייה,1,200,1.25\n";
  const parsed = parseTradeFile(csv);
  assert.equal(parsed.fileError, null);
  const valid = parsed.rows.filter((r) => !r.error);
  assert.equal(valid.length, 4);
  assert.deepEqual(valid.map((r) => r.fee), [2.5, -1, 0, 1.25], "the file's own signs are kept by the parser");
  assert.equal(countPositiveFees(valid), 2);
});

test("cash: a positive fee imported as is RAISES cash; converted it lowers cash like any other fee", () => {
  const as_is = planImport([], applyFeeSign([row("2026-02-10", "NVDA", 10, 100, 2.5)], false).rows, 1);
  assert.equal(as_is.cashDelta, -1000 + 2.5, "-997.50: the fee made cash go UP");
  const converted = planImport([], applyFeeSign([row("2026-02-10", "NVDA", 10, 100, 2.5)], true).rows, 1);
  assert.equal(converted.cashDelta, -1000 - 2.5, "-1002.50, as for a fee typed by hand (audit case 6)");
  assert.equal(converted.newTrades[0].fee, -2.5);
  assert.equal(cashEffect({ ...converted.newTrades[0] }), -1002.5);
});

test("trades already in the journal are never changed - not by converting, not by keeping", () => {
  const existing: Trade[] = [{ id: 1, date: "2026-01-05", symbol: "NVDA", action: BUY, qty: 10, price: 100, value: 1000, fee: 1.5, pnl: null, retPct: null, strategy: null, notes: null }];
  const frozen = JSON.stringify(existing);
  for (const convert of [true, false]) {
    const plan = planImport(existing, applyFeeSign([row("2026-02-10", "AAPL", 1, 10, 2)], convert).rows, 2);
    assert.equal(plan.newTrades.length, 1, "only the new rows come back");
    assert.equal(JSON.stringify(existing), frozen, "the journal's own positive fee (1.5) is untouched");
  }
});

test("duplicate detection ignores the fee, so converting can't make a row look new", () => {
  const journal: Trade[] = [{ id: 1, date: "2026-02-10", symbol: "NVDA", action: BUY, qty: 10, price: 100, value: 1000, fee: -2.5, pnl: null, retPct: null, strategy: null, notes: null }];
  const fileRow = row("2026-02-10", "NVDA", 10, 100, 2.5);   // the same trade, fee written positive
  assert.equal(splitDuplicates(journal, [fileRow]).duplicates.length, 1);
  assert.equal(splitDuplicates(journal, applyFeeSign([fileRow], true).rows).duplicates.length, 1);
});
