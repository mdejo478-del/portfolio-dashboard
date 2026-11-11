// Ledger anchors: a starting point (qty, avgCost, asOf) per symbol for holdings bought
// before the journal (e.g. at a previous broker). The ledger starts from the anchor and
// applies only trades dated AFTER asOf. A symbol without an anchor behaves as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  buildLedger, ledgerBefore, sellContextBefore, suggestSellPnl, planImport, planAnchorsFromHoldings, type ImportRowInput,
} from "../src/lib/ledger";
import { isValidPortfolioData, validatePortfolio, errorsOf, newErrors } from "../src/lib/validation";
import type { LedgerAnchors, PortfolioData, Trade } from "../src/lib/portfolioTypes";

const BUY = "קנייה";
const SELL = "מכירה";
const T = (id: number, date: string, symbol: string, action: string, qty: number, price: number): Trade =>
  ({ id, date, symbol, action, qty, price, value: qty * price, fee: 0, pnl: null, retPct: null, strategy: null, notes: null });
const row = (date: string, symbol: string, action: string, qty: number, price: number): ImportRowInput =>
  ({ date, symbol, action, qty, price, fee: 0, pnlOverride: null, strategy: null, notes: null });
const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);
const HEBREW = /[֐-׿]/;

// Held 10 @ 100 on 2026-01-31, bought at a previous broker - no trades for it in the journal
// (lastTradeId 0: the journal held trades up to id 0 when the anchor was set).
// A trade moves the ledger only if its id is above lastTradeId AND it is dated on/after asOf.
const anchors: LedgerAnchors = { NVDA: { qty: 10, avgCost: 100, asOf: "2026-01-31", lastTradeId: 0 } };

// ---- the requested behavior ---------------------------------------------------------------

test("anchor + a buy after asOf: correct weighted average", () => {
  const { ledger, issues } = buildLedger([T(1, "2026-02-10", "NVDA", BUY, 10, 200)], anchors);
  assert.deepEqual(ledger, { NVDA: { qty: 20, avgCost: 150 } });
  assert.equal(issues.length, 0);
  const second = buildLedger([T(1, "2026-02-10", "NVDA", BUY, 10, 200), T(2, "2026-02-12", "NVDA", BUY, 5, 130)], anchors).ledger;
  near(second.NVDA.qty, 25);
  near(second.NVDA.avgCost, (10 * 100 + 10 * 200 + 5 * 130) / 25);
});

test("anchor + a sell: profit is measured against the anchor's average cost", () => {
  const r = buildLedger([T(1, "2026-02-15", "NVDA", SELL, 4, 150)], anchors);
  assert.deepEqual(r.ledger, { NVDA: { qty: 6, avgCost: 100 } }, "average cost is unchanged by a sell");
  assert.deepEqual(r.sellContext.get(1), { heldQty: 10, avgCost: 100 });
  assert.equal(suggestSellPnl(r.sellContext.get(1), 150, 4).pnl, 200, "(150 - 100) x 4");
  assert.equal(r.issues.length, 0, "the sell is explained by the anchor - without it this would be 'no history'");
  assert.equal(buildLedger([T(1, "2026-02-15", "NVDA", SELL, 4, 150)]).issues.length, 1, "(and without the anchor it is not)");
  // Through an import: same profit, nothing left unresolved.
  const plan = planImport([], [row("2026-02-15", "NVDA", SELL, 4, 150)], 1, anchors);
  assert.equal(plan.newTrades[0].pnl, 200);
  assert.equal(plan.unresolvedSells.length, 0);
  // Selling more than the anchor holds is still flagged.
  const over = buildLedger([T(1, "2026-02-15", "NVDA", SELL, 15, 150)], anchors);
  assert.equal(over.issues[0].kind, "exceeds-holding");
  assert.deepEqual(over.ledger, {});
});

// ---- the three cases of the id + date rule --------------------------------------------------------

// The anchor was set on 2026-03-01 when the journal's highest trade id was 5.
const NOW = "2026-03-01";
const set: LedgerAnchors = { NVDA: { qty: 10, avgCost: 100, asOf: NOW, lastTradeId: 5 } };

test("rule case 1: trades already in the journal when the anchor was set are not counted twice", () => {
  // Whatever their dates - before, on, or even after asOf - they are part of the holdings the anchor describes.
  const existing = [
    T(3, "2026-02-10", "NVDA", BUY, 4, 90),
    T(4, "2026-03-01", "NVDA", BUY, 6, 95),     // dated the very day of the anchor
    T(5, "2026-03-05", "NVDA", SELL, 2, 140),   // future-dated, but already entered
  ];
  const r = buildLedger(existing, set);
  assert.deepEqual(r.ledger, { NVDA: { qty: 10, avgCost: 100 } }, "the anchor alone");
  assert.equal(r.issues.length, 0);
  assert.equal(r.sellContext.size, 0, "an already-counted sell is not re-measured");
  // Without lastTradeId the same trades dated after asOf WOULD count - which is exactly the double count.
  assert.notDeepEqual(buildLedger(existing, { NVDA: { qty: 10, avgCost: 100, asOf: NOW } }).ledger, r.ledger);
});

test("rule case 2: a new trade from today (dated on asOf) is counted", () => {
  const trades = [T(3, "2026-02-10", "NVDA", BUY, 4, 90), T(6, NOW, "NVDA", BUY, 10, 200)];   // id 6 > lastTradeId 5, date == asOf
  assert.deepEqual(buildLedger(trades, set).ledger, { NVDA: { qty: 20, avgCost: 150 } }, "only the new trade is added to the anchor");
  // A new sell from today is measured against the anchor.
  const sell = buildLedger([T(6, NOW, "NVDA", SELL, 4, 150)], set);
  assert.deepEqual(sell.ledger, { NVDA: { qty: 6, avgCost: 100 } });
  assert.equal(suggestSellPnl(sell.sellContext.get(6), 150, 4).pnl, 200);
  // And a later day counts too.
  assert.deepEqual(buildLedger([T(6, "2026-03-02", "NVDA", BUY, 10, 200)], set).ledger, { NVDA: { qty: 20, avgCost: 150 } });
  // Through an import and through the "what is this trade measured against" lookups.
  const plan = planImport([], [row(NOW, "NVDA", SELL, 4, 150)], 6, set);
  assert.equal(plan.newTrades[0].pnl, 200);
  assert.equal(plan.unresolvedSells.length, 0);
  assert.deepEqual(ledgerBefore([], { date: NOW, id: Infinity }, null, set), { NVDA: { qty: 10, avgCost: 100 } }, "a new trade today sees the anchor");
});

test("rule case 3: a trade entered later with an OLD date stays in the journal but does not move the ledger", () => {
  const backdated = [T(6, "2026-02-20", "NVDA", BUY, 10, 50)];   // id 6 > lastTradeId, but dated before asOf
  assert.deepEqual(buildLedger(backdated, set).ledger, { NVDA: { qty: 10, avgCost: 100 } }, "ledger unchanged");
  const sold = buildLedger([T(6, "2026-02-20", "NVDA", SELL, 3, 80)], set);
  assert.deepEqual(sold.ledger, { NVDA: { qty: 10, avgCost: 100 } });
  assert.equal(sold.issues.length, 0, "not reported as an unexplained sell");
  // No earlier state is invented for it: a profit has to be entered by hand.
  assert.deepEqual(ledgerBefore([], { date: "2026-02-20", id: Infinity }, null, set), {});
  assert.deepEqual(sellContextBefore([], { date: "2026-02-20", id: Infinity }, "NVDA", null, set), { heldQty: 0, avgCost: null });
  assert.equal(suggestSellPnl(sellContextBefore([], { date: "2026-02-20", id: Infinity }, "NVDA", null, set), 80, 3).pnl, null);
  // Through an import: kept, no computed profit, reported as needing one.
  const plan = planImport([], [row("2026-02-20", "NVDA", SELL, 2, 90)], 6, set);
  assert.equal(plan.newTrades.length, 1);
  assert.equal(plan.newTrades[0].pnl, null);
  assert.equal(plan.unresolvedSells.length, 1);
  assert.deepEqual(plan.ledger, { NVDA: { qty: 10, avgCost: 100 } });
  // Editing a trade that was already journaled when the anchor was set: it is part of the anchor, so no earlier state either.
  assert.deepEqual(ledgerBefore([T(4, "2026-03-03", "NVDA", BUY, 1, 1)], { date: "2026-03-03", id: 4 }, 4, set), {});
});

test("an anchor in the first format (no lastTradeId) keeps counting trades dated after asOf", () => {
  const legacy: LedgerAnchors = { NVDA: { qty: 10, avgCost: 100, asOf: "2026-01-31" } };
  assert.deepEqual(buildLedger([T(1, "2026-01-10", "NVDA", BUY, 10, 50), T(2, "2026-01-31", "NVDA", BUY, 7, 120)], legacy).ledger, { NVDA: { qty: 10, avgCost: 100 } }, "on or before asOf: ignored");
  assert.deepEqual(buildLedger([T(1, "2026-02-01", "NVDA", BUY, 10, 200)], legacy).ledger, { NVDA: { qty: 20, avgCost: 150 } }, "after asOf: counted");
  assert.deepEqual(buildLedger([T(1, "2026-01-10", "NVDA", BUY, 10, 50)], { NVDA: { qty: 10, avgCost: 100, asOf: "2026-01-31", lastTradeId: NaN } }).ledger, { NVDA: { qty: 10, avgCost: 50 } }, "a broken lastTradeId makes the anchor unusable");
});

test("a symbol without an anchor behaves exactly as today", () => {
  const trades = [
    T(1, "2026-01-05", "AAPL", BUY, 10, 100), T(2, "2026-01-06", "AAPL", BUY, 10, 200), T(3, "2026-01-07", "AAPL", SELL, 5, 300),
    T(4, "2026-02-01", "MSFT", SELL, 3, 50),
  ];
  assert.deepEqual(buildLedger(trades, {}), buildLedger(trades), "an empty anchor set changes nothing");
  const withOther = buildLedger(trades, anchors);
  const plain = buildLedger(trades);
  assert.deepEqual(withOther.ledger.AAPL, plain.ledger.AAPL, "AAPL has no anchor: same result");
  assert.deepEqual(withOther.ledger.AAPL, { qty: 15, avgCost: 150 });
  assert.deepEqual(withOther.issues, plain.issues, "MSFT's sell without a buy is still reported");
  assert.deepEqual(withOther.sellContext.get(3), plain.sellContext.get(3));
  assert.deepEqual(withOther.ledger.NVDA, { qty: 10, avgCost: 100 }, "while NVDA comes from its anchor");
});

// ---- more behavior ----------------------------------------------------------------------------

test("a flat anchor (qty 0) drops the symbol and ignores its earlier trades; a later buy starts fresh", () => {
  const flat: LedgerAnchors = { OKLO: { qty: 0, avgCost: 0, asOf: "2026-02-01", lastTradeId: 1 } };
  const trades = [T(1, "2026-01-05", "OKLO", BUY, 3, 20)];
  assert.deepEqual(buildLedger(trades).ledger, { OKLO: { qty: 3, avgCost: 20 } });
  assert.deepEqual(buildLedger(trades, flat).ledger, {}, "removed");
  assert.deepEqual(buildLedger([...trades, T(2, "2026-02-05", "OKLO", BUY, 2, 30)], flat).ledger, { OKLO: { qty: 2, avgCost: 30 } }, "a new position, not mixed with the old");
});

test("an unusable anchor is ignored instead of corrupting the ledger", () => {
  const trades = [T(1, "2026-01-05", "NVDA", BUY, 10, 100)];
  const plain = buildLedger(trades).ledger;
  for (const bad of [
    { qty: 10, avgCost: 0, asOf: "2026-01-31" },
    { qty: -1, avgCost: 100, asOf: "2026-01-31" },
    { qty: 10, avgCost: 100, asOf: "31/01/2026" },
    { qty: NaN, avgCost: 100, asOf: "2026-01-31" },
  ]) assert.deepEqual(buildLedger(trades, { NVDA: bad }).ledger, plain);
});

test("the ledger as of a trade's own position: a date on/before the anchor has no earlier state", () => {
  const trades = [T(1, "2026-02-10", "NVDA", BUY, 10, 200)];
  assert.deepEqual(ledgerBefore(trades, { date: "2026-02-15", id: Infinity }, null, anchors), { NVDA: { qty: 20, avgCost: 150 } });
  assert.deepEqual(ledgerBefore(trades, { date: "2026-02-10", id: 1 }, 1, anchors), { NVDA: { qty: 10, avgCost: 100 } }, "editing the 02-10 buy: it is measured against the anchor");
  assert.deepEqual(ledgerBefore(trades, { date: "2026-01-20", id: Infinity }, null, anchors), {}, "before the anchor the state is unknown - no number is made up");
  assert.deepEqual(ledgerBefore(trades, { date: "2026-01-31", id: Infinity }, null, anchors), { NVDA: { qty: 10, avgCost: 100 } }, "a NEW trade dated on the anchor day is measured against it");
  assert.deepEqual(sellContextBefore(trades, { date: "2026-01-20", id: Infinity }, "NVDA", null, anchors), { heldQty: 0, avgCost: null });
  assert.equal(suggestSellPnl(sellContextBefore(trades, { date: "2026-01-20", id: Infinity }, "NVDA", null, anchors), 90, 2).pnl, null, "so an old-dated sell asks for a manual profit");
});

// ---- planning from the holdings table ----------------------------------------------------------------

test("update from holdings: anchors for held symbols with qty and avgCost, flat anchors for the rest of the ledger, missing avgCost reported", () => {
  const holdings = [
    { symbol: "CASH", qty: null, avgCost: null },
    { symbol: "NVDA", qty: 10, avgCost: 100 },
    { symbol: "AAPL", qty: 5, avgCost: null },        // held, no average cost
    { symbol: "TSLA", qty: 3, avgCost: 0 },           // 0 is "not set"
    { symbol: "GONE", qty: 0, avgCost: 50 },          // a zero row is not held
  ];
  const stored = { NVDA: { qty: 22, avgCost: 95 }, OKLO: { qty: 3, avgCost: 20 }, VOO: { qty: 2, avgCost: 400 }, "25": { qty: 1, avgCost: 10 }, GONE: { qty: 0, avgCost: 1 } };
  const rebuilt = { NVDA: { qty: 4, avgCost: 90 }, OKLO: { qty: 3, avgCost: 20 }, AAPL: { qty: 2, avgCost: 150 } };
  const current: LedgerAnchors = { MSFT: { qty: 1, avgCost: 10, asOf: "2025-12-01" } };
  const plan = planAnchorsFromHoldings(holdings, stored, rebuilt, current, "2026-03-01", 42);

  assert.deepEqual(plan.anchored, ["NVDA"]);
  assert.deepEqual(plan.flattened, ["25", "OKLO", "VOO"], "in the ledger but not held (GONE has a ~0 entry and is not listed)");
  assert.deepEqual(plan.missingAvgCost, ["AAPL", "TSLA"]);
  assert.deepEqual(plan.anchors.NVDA, { qty: 10, avgCost: 100, asOf: "2026-03-01", lastTradeId: 42 }, "the journal's highest trade id at that moment is stored");
  assert.deepEqual(plan.anchors.OKLO, { qty: 0, avgCost: 0, asOf: "2026-03-01", lastTradeId: 42 });
  assert.deepEqual(plan.anchors.MSFT, current.MSFT, "an unrelated existing anchor is kept");
  assert.equal(plan.anchors.AAPL, undefined, "no avgCost: no anchor, left to the trades");
  assert.equal(plan.anchors.CASH, undefined);
  assert.deepEqual(current, { MSFT: { qty: 1, avgCost: 10, asOf: "2025-12-01" } }, "the input is not modified");

  // The resulting ledger: the holdings win for anchored symbols, the others drop out, AAPL stays by its trades.
  const trades = [T(1, "2026-01-05", "NVDA", BUY, 4, 90), T(2, "2026-01-06", "OKLO", BUY, 3, 20), T(3, "2026-01-07", "AAPL", BUY, 2, 150), T(4, "2026-01-08", "VOO", BUY, 2, 400)];
  assert.deepEqual(buildLedger(trades, plan.anchors).ledger, { AAPL: { qty: 2, avgCost: 150 }, MSFT: { qty: 1, avgCost: 10 }, NVDA: { qty: 10, avgCost: 100 } });
});

test("update from holdings: the trades table, the holdings and cash are inputs only - nothing is modified", () => {
  const trades = [{ ...T(1, "2026-01-05", "NVDA", SELL, 2, 150), pnl: 123.45, retPct: 0.5 }];
  const frozen = JSON.stringify(trades);
  planAnchorsFromHoldings([{ symbol: "NVDA", qty: 10, avgCost: 100 }], {}, buildLedger(trades).ledger, {}, "2026-03-01", 1);
  buildLedger(trades, { NVDA: { qty: 10, avgCost: 100, asOf: "2026-03-01", lastTradeId: 1 } });
  assert.equal(JSON.stringify(trades), frozen, "saved pnl/retPct on old trades are untouched");
});

// ---- validation -----------------------------------------------------------------------------------------

const portfolio = (o: Partial<PortfolioData> = {}): PortfolioData =>
  ({ positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 1, ...o });

test("validation: anchors are optional, must be well-formed, and have Hebrew explanations", () => {
  assert.equal(isValidPortfolioData(portfolio()), true, "files without anchors are fine");
  assert.equal(isValidPortfolioData(portfolio({ ledgerAnchors: anchors })), true);
  assert.equal(isValidPortfolioData({ ...portfolio(), ledgerAnchors: "x" }), false);
  assert.equal(isValidPortfolioData({ ...portfolio(), ledgerAnchors: { NVDA: { qty: 1, avgCost: 1 } } }), false, "asOf is required");
  assert.equal(isValidPortfolioData({ ...portfolio(), ledgerAnchors: { NVDA: { qty: 1, avgCost: 1, asOf: "1/2/2026" } } }), false);
  assert.equal(isValidPortfolioData({ ...portfolio(), ledgerAnchors: { NVDA: { qty: 1, avgCost: 1, asOf: "2026-02-01", lastTradeId: "7" } } }), false, "lastTradeId must be a number");
  assert.equal(isValidPortfolioData({ ...portfolio(), ledgerAnchors: { NVDA: { qty: 1, avgCost: 1, asOf: "2026-02-01" } } }), true, "and may be absent (first format)");
  const badId = errorsOf(validatePortfolio(portfolio({ ledgerAnchors: { NVDA: { qty: 1, avgCost: 1, asOf: "2026-02-01", lastTradeId: 1.5 } } })));
  assert.deepEqual(badId.map((i) => i.code), ["anchor-last-trade-id"]);
  assert.ok(HEBREW.test(badId[0].message));
  assert.deepEqual(errorsOf(validatePortfolio(portfolio({ ledgerAnchors: { NVDA: { qty: 1, avgCost: 1, asOf: "2026-02-01", lastTradeId: -1 } } }))), [], "-1 = the journal was empty");
  assert.deepEqual(errorsOf(validatePortfolio(portfolio({ ledgerAnchors: anchors }))), []);
  const flat = errorsOf(validatePortfolio(portfolio({ ledgerAnchors: { OKLO: { qty: 0, avgCost: 0, asOf: "2026-02-01" } } })));
  assert.deepEqual(flat, [], "a flat anchor (qty 0, avgCost 0) is valid");
  const bad = errorsOf(validatePortfolio(portfolio({ ledgerAnchors: {
    A: { qty: 5, avgCost: 0, asOf: "2026-02-01" }, B: { qty: -1, avgCost: 10, asOf: "2026-02-01" }, C: { qty: 1, avgCost: 10, asOf: "2026-02-31" },
  } })));
  assert.deepEqual(bad.map((i) => i.code).sort(), ["anchor-avgcost-invalid", "anchor-date-invalid", "anchor-qty-negative"]);
  assert.ok(bad.every((i) => HEBREW.test(i.message) && i.symbol !== null));
  assert.equal(new Set(bad.map((i) => i.key)).size, 3, "each symbol's problem has its own key");
  const before = validatePortfolio(portfolio({ ledgerAnchors: { A: { qty: 5, avgCost: 0, asOf: "2026-02-01" } } }));
  const after = validatePortfolio(portfolio({ ledgerAnchors: { A: { qty: 5, avgCost: 0, asOf: "2026-02-01" }, B: { qty: 5, avgCost: 0, asOf: "2026-02-01" } } }));
  assert.equal(newErrors(after, before).length, 1, "a problem on ANOTHER symbol is new, not hidden by the existing one");
});

// ---- saved through the existing revision mechanism ------------------------------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
mkdirSync(path.join(dir, "data", "portfolios"), { recursive: true });
const writeStored = (uid: string, data: Record<string, unknown>) =>
  writeFileSync(path.join(dir, "data", "portfolios", uid + ".json"), JSON.stringify({ equityHistory: [], alertAcks: {}, ...data }));
const base = { positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 1 };

test("server: anchors are saved with the portfolio, bump the revision, and survive a client that doesn't send them", async () => {
  const { savePortfolio, getPortfolio, currentRevision } = await import("../src/lib/portfolio");
  const uid = "cccccccc-1111-4111-8111-000000000001";
  writeStored(uid, base); // a file from before anchors existed
  const loaded = await getPortfolio(uid);
  assert.equal(loaded.ledgerAnchors, undefined, "an old file loads fine without the field");

  const r1 = await savePortfolio(uid, { ...base, ledgerAnchors: anchors }, 0);
  assert.deepEqual(r1, { ok: true, revision: 1 }, "an anchor change is a normal save and bumps the revision");
  assert.deepEqual((await getPortfolio(uid)).ledgerAnchors, anchors);

  // A stale tab (still on revision 0) cannot overwrite them.
  const stale = await savePortfolio(uid, { ...base, ledgerAnchors: {} }, 0);
  assert.deepEqual(stale, { ok: false, reason: "conflict", currentRevision: 1 });
  assert.deepEqual((await getPortfolio(uid)).ledgerAnchors, anchors, "the newer anchors survived");

  // A save that doesn't mention anchors at all leaves them alone.
  const r2 = await savePortfolio(uid, { ...base }, 1);
  assert.deepEqual(r2, { ok: true, revision: 2 });
  assert.deepEqual((await getPortfolio(uid)).ledgerAnchors, anchors);
  assert.equal(currentRevision(await getPortfolio(uid)), 2);

  // Clearing them is an explicit empty object.
  await savePortfolio(uid, { ...base, ledgerAnchors: {} }, 2);
  assert.deepEqual((await getPortfolio(uid)).ledgerAnchors, {});
});

test("server: an invalid anchor is refused with a Hebrew reason, and nothing is written", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "cccccccc-1111-4111-8111-000000000002";
  writeStored(uid, base);
  const r = await savePortfolio(uid, { ...base, ledgerAnchors: { NVDA: { qty: 5, avgCost: 0, asOf: "2026-02-01" } } }, 0);
  assert.ok(!r.ok && r.reason === "invalid");
  if (!r.ok && r.reason === "invalid") assert.ok(HEBREW.test(r.message) && r.message.includes("NVDA"), r.message);
  assert.equal((await getPortfolio(uid)).ledgerAnchors, undefined);
});
