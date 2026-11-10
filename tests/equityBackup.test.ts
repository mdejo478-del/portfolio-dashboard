// saveEquityHistory keeps the ORIGINAL recorded history aside across repeated
// rebuilds. Runs in a throwaway temp directory - never touches the real data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
mkdirSync(path.join(dir, "data", "portfolios"), { recursive: true });
const base = { positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 0, alertAcks: {} };
const seed = (uid: string, equityHistory: Array<{ date: string; value: number }>) =>
  writeFileSync(path.join(dir, "data", "portfolios", uid + ".json"), JSON.stringify({ ...base, equityHistory }));

const REAL = [{ date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: 110 }];
const REBUILD_1 = [{ date: "2026-01-01", value: 1 }];
const REBUILD_2 = [{ date: "2026-01-01", value: 2 }, { date: "2026-01-02", value: 3 }];

test("a second rebuild does not overwrite the original recorded history", async () => {
  const { saveEquityHistory, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "aaaaaaaa-0000-4000-8000-000000000001";
  seed(uid, REAL);

  await saveEquityHistory(uid, REBUILD_1);
  let p = await getPortfolio(uid);
  assert.deepEqual(p.equityHistory, REBUILD_1);
  assert.deepEqual(p.equityHistoryBeforeRebuild, REAL, "first rebuild stores the original");

  await saveEquityHistory(uid, REBUILD_2);
  p = await getPortfolio(uid);
  assert.deepEqual(p.equityHistory, REBUILD_2);
  assert.deepEqual(p.equityHistoryBeforeRebuild, REAL, "second rebuild must keep the original, not rebuild #1");
});

test("an empty backup (first rebuild had nothing recorded) doesn't block a later real backup", async () => {
  const { saveEquityHistory, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "aaaaaaaa-0000-4000-8000-000000000002";
  seed(uid, []);

  await saveEquityHistory(uid, REBUILD_1);
  assert.deepEqual((await getPortfolio(uid)).equityHistoryBeforeRebuild, []);

  await saveEquityHistory(uid, REBUILD_2);
  assert.deepEqual((await getPortfolio(uid)).equityHistoryBeforeRebuild, REBUILD_1, "empty backup is replaced by the series being overwritten");
});
