// 0.6 / audit finding H7, case 12: one validation module for browser and server,
// a Hebrew explanation for every refusal, and legacy portfolios with "invalid"
// data still load and save. Server-side checks run in a throwaway temp directory
// - never touching the real data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  validatePosition, validateTrade, validatePortfolio, newErrors, errorsOf, formatRejection, isRealDate, recomputedValue, isValidPortfolioData,
} from "../src/lib/validation";
import type { Position, Trade, PortfolioData } from "../src/lib/portfolioTypes";

const pos = (o: Partial<Position> = {}): Position =>
  ({ id: 1, symbol: "NVDA", qty: 10, price: 100, value: 1000, weight: 0.5, dev: 0, min: 0.05, max: 0.15, dilute: 0.2, ...o });
const trade = (o: Partial<Trade> = {}): Trade =>
  ({ id: 1, date: "2026-01-05", symbol: "NVDA", action: "קנייה", qty: 10, price: 100, value: 1000, fee: -2.5, pnl: null, retPct: null, strategy: null, notes: null, ...o });
const portfolio = (o: Partial<PortfolioData> = {}): PortfolioData =>
  ({ positions: [pos()], trades: [trade()], ledger: {}, nextPositionId: 2, nextTradeId: 2, ...o });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();
const HEBREW = /[֐-׿]/;

// ---- case 12 -----------------------------------------------------------------------

test("case 12: min 0.2 with max 0.1 is rejected, with a Hebrew explanation that names both numbers", () => {
  const issues = validatePosition(pos({ min: 0.2, max: 0.1, dilute: 0.3 }));
  const err = errorsOf(issues);
  assert.deepEqual(codes(err), ["min-gt-max"]);
  assert.ok(HEBREW.test(err[0].message));
  assert.ok(err[0].message.includes("NVDA") && err[0].message.includes("20%") && err[0].message.includes("10%"), err[0].message);
  assert.deepEqual(errorsOf(validatePosition(pos())), [], "a normal position is fine");
  assert.deepEqual(errorsOf(validatePosition(pos({ min: 0.1, max: 0.1, dilute: 0.1 }))), [], "min = max = dilute is allowed");
});

// ---- the rules (everything the audit said still passed) -----------------------------------

test("positions: negative quantity/price/value, range bounds, dilute below max, bad price target", () => {
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ qty: -1 })))), ["qty-negative"]);
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ price: -5 })))), ["price-negative"]);
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ value: -1 })))), ["value-negative"]);
  assert.ok(codes(errorsOf(validatePosition(pos({ max: 1.5, dilute: 2 })))).includes("range-bounds"));
  assert.ok(codes(errorsOf(validatePosition(pos({ min: -0.1 })))).includes("range-bounds"));
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ max: 0.3, dilute: 0.2 })))), ["max-gt-dilute"]);
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ dilute: 2000 })))), ["dilute-bounds"], "20 000% is a typo");
  assert.deepEqual(codes(errorsOf(validatePosition(pos({ priceTarget: 0 })))), ["price-target-invalid"]);
  assert.deepEqual(errorsOf(validatePosition(pos({ priceTarget: null, avgCost: null }))), [], "optional fields may be empty");
  for (const i of validatePosition(pos({ qty: -1, min: 0.5, max: 0.1 }))) assert.ok(HEBREW.test(i.message), "Hebrew message for " + i.code);
});

test("missing is allowed, invalid is not: no price yet / no quantity on a manual row raise no error", () => {
  assert.deepEqual(validatePosition(pos({ price: null, value: 0 })), [], "no price yet");
  assert.deepEqual(validatePosition(pos({ qty: null, price: null, value: 500 })), [], "manually valued row");
  const cash = pos({ symbol: "CASH", qty: null, price: null, value: 1000, min: 0, max: 1, dilute: 1.5 });
  assert.deepEqual(validatePosition(cash), [], "the CASH row the app itself creates (dilute 150%) is valid");
  const negCash = validatePosition({ ...cash, value: -50 });
  assert.deepEqual(codes(negCash), ["cash-negative"]);
  assert.equal(negCash[0].severity, "warning", "negative cash is flagged, not refused (the user may simply not have logged a deposit)");
  assert.deepEqual(codes(validatePosition(pos({ price: 0, value: 0 }))), ["price-zero"]);
});

test("warnings: value that doesn't match qty x price, odd symbol characters", () => {
  assert.deepEqual(codes(validatePosition(pos({ value: 5000 }))), ["value-mismatch"]);
  assert.equal(validatePosition(pos({ value: 5000 }))[0].severity, "warning");
  assert.deepEqual(codes(validatePosition(pos({ symbol: "תל אביב" }))), ["symbol-chars"]);
});

test("trades: real calendar dates only (31 February is rejected), year range, future date is a warning", () => {
  assert.equal(isRealDate("2026-02-28"), true);
  assert.equal(isRealDate("2024-02-29"), true, "leap year");
  assert.equal(isRealDate("2023-02-29"), false);
  assert.equal(isRealDate("2026-02-31"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("2026-00-10"), false);
  const bad = errorsOf(validateTrade(trade({ date: "2026-02-31" })));
  assert.deepEqual(codes(bad), ["date-invalid"]);
  assert.ok(bad[0].message.includes("31 בפברואר") || bad[0].message.includes("2026-02-31"));
  assert.deepEqual(codes(errorsOf(validateTrade(trade({ date: "1980-01-01" })))), ["date-out-of-range"]);
  const future = validateTrade(trade({ date: "2027-01-01" }), { today: "2026-06-01" });
  assert.deepEqual(codes(future), ["date-future"]);
  assert.equal(future[0].severity, "warning");
  assert.deepEqual(validateTrade(trade({ date: "2026-06-02" }), { today: "2026-06-01" }), [], "tomorrow is fine (time zones)");
});

test("trades: quantity and price must be positive; a positive fee is a warning, or an error when typed by hand", () => {
  assert.deepEqual(codes(errorsOf(validateTrade(trade({ qty: 0, value: 0 })))), ["qty-invalid"]);
  assert.deepEqual(codes(errorsOf(validateTrade(trade({ price: -1, value: -10 })))), ["price-invalid"]);
  const fee = validateTrade(trade({ fee: 2.5 }));
  assert.deepEqual(codes(fee), ["fee-positive"]);
  assert.equal(fee[0].severity, "warning", "an imported file with positive commissions must not make the portfolio unsaveable");
  assert.equal(validateTrade(trade({ fee: 2.5 }), { feeSignIsError: true })[0].severity, "error", "but the manual form refuses it");
  assert.deepEqual(validateTrade(trade({ fee: 0, action: "הפקדה" })), []);
});

test("across items: duplicate symbols and ids, and id counters that would hand out a used id", () => {
  const dup = validatePortfolio(portfolio({ positions: [pos({ id: 1 }), pos({ id: 2, symbol: "nvda" })], nextPositionId: 3 }));
  assert.deepEqual(codes(errorsOf(dup)), ["duplicate-symbol"], "symbols compare case-insensitively");
  assert.deepEqual(codes(errorsOf(validatePortfolio(portfolio({ positions: [pos({ id: 1 }), pos({ id: 1, symbol: "AAPL" })] })))), ["duplicate-id"]);
  assert.deepEqual(codes(errorsOf(validatePortfolio(portfolio({ trades: [trade({ id: 1 }), trade({ id: 1 })], nextTradeId: 2 })))), ["duplicate-id"]);
  assert.deepEqual(codes(errorsOf(validatePortfolio(portfolio({ nextPositionId: 1 })))), ["next-position-id"]);
  assert.deepEqual(codes(errorsOf(validatePortfolio(portfolio({ nextTradeId: 1 })))), ["next-trade-id"]);
  assert.deepEqual(errorsOf(validatePortfolio(portfolio())), [], "a normal portfolio has no errors");
  assert.deepEqual(errorsOf(validatePortfolio({ positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0 })), [], "an empty portfolio is valid");
});

test("newErrors: only problems that are not already there count; same rule on the same item is not new", () => {
  const before = validatePortfolio(portfolio({ positions: [pos({ min: 0.2, max: 0.1, dilute: 0.3 })] }));
  const after = validatePortfolio(portfolio({ positions: [pos({ min: 0.3, max: 0.1, dilute: 0.3, qty: 11, value: 1100 })] }));
  assert.deepEqual(newErrors(after, before), [], "still the same min>max problem on the same position - not new");
  const worse = validatePortfolio(portfolio({ positions: [pos({ min: 0.2, max: 0.1, dilute: 0.3, qty: -1 })] }));
  assert.deepEqual(codes(newErrors(worse, before)), ["qty-negative"], "a different problem is new");
  assert.match(formatRejection(newErrors(worse, before)), /^השינויים לא נשמרו/);
  const many = validatePortfolio(portfolio({ positions: Array.from({ length: 6 }, (_, i) => pos({ id: i + 1, symbol: "S" + i, qty: -1 })), nextPositionId: 10 }));
  assert.match(formatRejection(errorsOf(many)), /\(ועוד 3 בעיות\)$/, "shows the first three and counts the rest");
});

test("recomputedValue: qty x price when both are known, else the stored value", () => {
  assert.equal(recomputedValue(pos({ qty: 10, price: 100, value: 999_999 })), 1000);
  assert.equal(recomputedValue(pos({ qty: 10, price: null, value: 750 })), 750);
  assert.equal(recomputedValue(pos({ symbol: "CASH", qty: null, price: null, value: 1234 })), 1234);
});

test("structure check still works from its new home", () => {
  assert.equal(isValidPortfolioData(portfolio()), true);
  assert.equal(isValidPortfolioData({ ...portfolio(), positions: "nope" }), false);
  assert.equal(isValidPortfolioData({ ...portfolio(), trades: [{ ...trade(), date: "5/1/2026" }] }), false);
  assert.equal(isValidPortfolioData(null), false);
});

test("one module for both sides: validation.ts has no Node-only imports (safe in the browser bundle)", () => {
  const src = readFileSync(path.join(__dirname, "..", "src", "lib", "validation.ts"), "utf8");
  const imports = Array.from(src.matchAll(/^import .* from "([^"]+)"/gm)).map((m) => m[1]);
  assert.deepEqual(imports, ["./portfolioTypes"], "only a type import of the shared types");
  assert.ok(!/from "(fs|path|crypto|os|child_process)"|from "node:/.test(src));
});

// ---- the real server save, in a temp data directory ---------------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
mkdirSync(path.join(dir, "data", "portfolios"), { recursive: true });
const writeStored = (uid: string, data: PortfolioData, extra: Record<string, unknown> = {}) =>
  writeFileSync(path.join(dir, "data", "portfolios", uid + ".json"), JSON.stringify({ ...data, equityHistory: [], alertAcks: {}, ...extra }));

test("server: a save with new invalid data is refused with the Hebrew reason, and nothing is written", async () => {
  const { savePortfolio, getPortfolio, currentRevision } = await import("../src/lib/portfolio");
  const uid = "bbbbbbbb-1111-4111-8111-000000000001";
  writeStored(uid, portfolio());
  const bad = portfolio({ positions: [pos({ min: 0.2, max: 0.1, dilute: 0.3 })] });
  const r = await savePortfolio(uid, bad, 0);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === "invalid");
  if (!r.ok && r.reason === "invalid") {
    assert.ok(HEBREW.test(r.message) && r.message.includes("20%") && r.message.includes("10%"), r.message);
    assert.deepEqual(codes(r.issues), ["min-gt-max"]);
  }
  const after = await getPortfolio(uid);
  assert.equal(currentRevision(after), 0, "revision unchanged");
  assert.equal(after.positions[0].min, 0.05, "the stored data is untouched");

  const badDate = await savePortfolio(uid, portfolio({ trades: [trade({ date: "2026-02-31" })] }), 0);
  assert.ok(!badDate.ok && badDate.reason === "invalid");
  const ok = await savePortfolio(uid, portfolio({ positions: [pos({ qty: 12, value: 1200 })] }), 0);
  assert.deepEqual(ok, { ok: true, revision: 1 }, "valid data still saves");
});

test("server: a legacy portfolio with invalid data still loads, and can still be edited and saved", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "bbbbbbbb-1111-4111-8111-000000000002";
  const legacy = portfolio({
    positions: [pos({ id: 1, min: 0.2, max: 0.1, dilute: 0.3 }), pos({ id: 2, symbol: "AAPL", qty: -3, value: -300, price: 100 }), pos({ id: 3, symbol: "nvda" })],
    trades: [trade({ id: 1, date: "2026-02-31" }), trade({ id: 1, symbol: "AAPL" })],
    nextPositionId: 2, // also stale
  });
  writeStored(uid, legacy);

  const loaded = await getPortfolio(uid);
  assert.equal(loaded.positions.length, 3, "loads - nothing is dropped or thrown");
  assert.ok(errorsOf(validatePortfolio(loaded)).length >= 5, "and it really is full of problems");

  // Edit an unrelated field: no NEW problem, so the save goes through.
  const edited: PortfolioData = { ...loaded, positions: loaded.positions.map((p) => (p.id === 3 ? { ...p, qty: 20, value: 2000 } : p)) };
  const saved = await savePortfolio(uid, edited, 0);
  assert.deepEqual(saved, { ok: true, revision: 1 }, "legacy problems do not lock the portfolio");
  const again = await getPortfolio(uid);
  assert.equal(again.positions.find((p) => p.id === 3)!.qty, 20);
  assert.equal(again.positions.find((p) => p.id === 1)!.min, 0.2, "the legacy values are left exactly as they were");

  // But adding a NEW bad value is still refused.
  const worse: PortfolioData = { ...again, positions: [...again.positions, pos({ id: 9, symbol: "TSLA", min: 0.5, max: 0.1, dilute: 0.6 })], nextPositionId: 10 };
  const refused = await savePortfolio(uid, worse, 1);
  assert.ok(!refused.ok && refused.reason === "invalid");
});

test("server: the equity point uses qty x price, not the value the browser sent", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "bbbbbbbb-1111-4111-8111-000000000003";
  writeStored(uid, portfolio());
  const lying = portfolio({ positions: [pos({ qty: 10, price: 100, value: 999_999 })] });
  const r = await savePortfolio(uid, lying, 0);
  assert.equal(r.ok, true, "the mismatch is a warning, not a refusal");
  const history = (await getPortfolio(uid)).equityHistory;
  assert.equal(history[history.length - 1].value, 1000, "recorded 10 x 100, not 999 999");
});
