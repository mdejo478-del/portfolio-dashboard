// The daily snapshot marks an equity point that was valued partly at last-known
// prices (audit H6). Runs in a throwaway temp directory - never touches data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
mkdirSync(path.join(dir, "data", "portfolios"), { recursive: true });
const seed = (uid: string, equityHistory: unknown[] = []) =>
  writeFileSync(path.join(dir, "data", "portfolios", uid + ".json"), JSON.stringify({
    positions: [{ id: 1, symbol: "NVDA", qty: 10, price: 100, value: 1000, weight: 1, dev: 0, min: 0.1, max: 0.5, dilute: 0.6 }],
    trades: [], ledger: {}, nextPositionId: 2, nextTradeId: 0, equityHistory, alertAcks: {},
  }));

test("a snapshot valued at last-known prices records which symbols, a clean one records nothing extra", async () => {
  const { updateDailySnapshot, getPortfolio, savePortfolio, currentRevision } = await import("../src/lib/portfolio");
  const today = new Date().toISOString().slice(0, 10);

  const a = "aaaaaaaa-1111-4111-8111-000000000001";
  seed(a);
  await updateDailySnapshot(a, { equityValue: 1234.5, staleSymbols: ["NVDA"], cashOverThreshold: false });
  const withStale = (await getPortfolio(a)).equityHistory;
  assert.deepEqual(withStale, [{ date: today, value: 1234.5, staleSymbols: ["NVDA"] }]);

  const b = "aaaaaaaa-1111-4111-8111-000000000002";
  seed(b);
  await updateDailySnapshot(b, { equityValue: 999, staleSymbols: [], cashOverThreshold: false });
  assert.deepEqual((await getPortfolio(b)).equityHistory, [{ date: today, value: 999 }], "no staleSymbols key when everything was priced");

  // A later save from the dashboard (live prices in hand) replaces today's point and drops the estimate marker.
  const p = await getPortfolio(a);
  const saved = await savePortfolio(a, { positions: p.positions, trades: p.trades, ledger: p.ledger, nextPositionId: p.nextPositionId, nextTradeId: p.nextTradeId }, currentRevision(p));
  assert.equal(saved.ok, true);
  const after = (await getPortfolio(a)).equityHistory;
  assert.equal(after.length, 1);
  assert.equal(after[0].staleSymbols, undefined, "the dashboard's own value for today is not an estimate");
});
