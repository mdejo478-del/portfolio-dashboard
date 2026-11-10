// Stale-tab protection in savePortfolio (audit finding C1). Runs in a
// throwaway temp directory - never touches the real data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
const uid = "11111111-2222-3333-4444-555555555555";
const data = (qty: number) => ({
  positions: [{ id: 1, symbol: "NVDA", qty, price: 100, value: qty * 100, weight: 1, dev: 0, min: 0.1, max: 0.5, dilute: 0.6 }],
  trades: [], ledger: {}, nextPositionId: 2, nextTradeId: 0,
});

test("stale writer is refused; server-side writes don't bump revision", async () => {
  const { savePortfolio, getPortfolio, updateAlertAcks, currentRevision } = await import("../src/lib/portfolio");
  mkdirSync(path.join(dir, "data", "portfolios"), { recursive: true });
  writeFileSync(path.join(dir, "data", "portfolios", uid + ".json"), JSON.stringify({ ...data(10), equityHistory: [], alertAcks: {} }));

  assert.equal(currentRevision(await getPortfolio(uid)), 0, "legacy file = revision 0");
  const a = await savePortfolio(uid, data(20), 0);
  assert.deepEqual(a, { ok: true, revision: 1 });
  const stale = await savePortfolio(uid, data(10), 0);
  assert.deepEqual(stale, { ok: false, reason: "conflict", currentRevision: 1 });
  assert.equal((await getPortfolio(uid)).positions[0].qty, 20, "newer data survived");

  await updateAlertAcks(uid, { x: { value: 1 } });
  assert.deepEqual(await savePortfolio(uid, data(25), 1), { ok: true, revision: 2 });

  const [r1, r2] = await Promise.all([savePortfolio(uid, data(30), 2), savePortfolio(uid, data(31), 2)]);
  assert.equal([r1.ok, r2.ok].filter(Boolean).length, 1, "exactly one concurrent save wins");
});
