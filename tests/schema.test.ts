// 0.10 / audit M2: schemaVersion and migrations for the portfolio file. A file without the
// field is version 0; old files are backed up, migrated and saved; a current file is left
// alone; a file from a NEWER version than the code is never opened for writing or
// overwritten. Disk tests run in a throwaway temp directory - never touching the real data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  CURRENT_SCHEMA_VERSION, MIGRATIONS, PortfolioSchemaError, migrateToCurrent, migrateV0toV1, schemaVersionOf, type Migration,
} from "../src/lib/schema";

const HEBREW = /[֐-׿]/;
const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === "object") { for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v); Object.freeze(o); }
  return o;
};

// A realistic version-0 file: no schemaVersion, plus fields a future migration would care about.
const OLD = {
  positions: [{ id: 1, symbol: "NVDA", qty: 10, price: 100, value: 1000, weight: 1, dev: 0, min: 0.05, max: 0.5, dilute: 0.6 }],
  trades: [], ledger: {}, nextPositionId: 2, nextTradeId: 1,
  equityHistory: [{ date: "2026-01-01", value: 1000 }], alertAcks: { x: { value: 1, seenAt: "2026-01-01T00:00:00.000Z" } },
  cashIdleSince: null, rangeWidthPreference: "narrow", revision: 7, someOtherField: { a: [1, 2, 3] },
};

// ---- the pure mechanism -------------------------------------------------------------------

test("the current version is how many migrations there are, and v0 -> v1 is empty", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, MIGRATIONS.length);
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  const input = deepFreeze({ ...OLD });
  assert.deepEqual(migrateV0toV1(input), OLD, "it changes nothing");
});

test("schemaVersionOf: absent = 0; a non-negative integer is itself; anything else is refused", () => {
  assert.equal(schemaVersionOf({}), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 0 }), 0);
  assert.equal(schemaVersionOf({ schemaVersion: 1 }), 1);
  for (const bad of ["1", -1, 1.5, null, NaN, {}, [], true]) {
    assert.throws(() => schemaVersionOf({ schemaVersion: bad }), (e: unknown) => e instanceof PortfolioSchemaError && e.code === "invalid" && HEBREW.test(e.message), "refused: " + JSON.stringify(bad));
  }
});

test("a version-0 file migrates to v1: data unchanged apart from the version, input never modified", () => {
  const input = deepFreeze({ ...OLD });
  const r = migrateToCurrent(input);
  assert.deepEqual([r.from, r.to, r.migrated], [0, 1, true]);
  assert.deepEqual(r.data, { ...OLD, schemaVersion: 1 });
  assert.equal("schemaVersion" in OLD, false, "the original object is intact");
});

test("a v1 file is returned as is (same object, nothing to do)", () => {
  const v1 = { ...OLD, schemaVersion: 1 };
  const r = migrateToCurrent(v1);
  assert.equal(r.migrated, false);
  assert.equal(r.data, v1);
  assert.deepEqual([r.from, r.to], [1, 1]);
});

test("a file from a newer version than the code is refused with a Hebrew explanation, never migrated", () => {
  assert.throws(() => migrateToCurrent({ ...OLD, schemaVersion: 99 }), (e: unknown) =>
    e instanceof PortfolioSchemaError && e.code === "too-new" && e.fileVersion === 99 && HEBREW.test(e.message) && e.message.includes("99") && e.message.includes(String(CURRENT_SCHEMA_VERSION)) && e.message.includes("לא משנה"));
  assert.throws(() => migrateToCurrent({ ...OLD, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }), PortfolioSchemaError, "even one version ahead");
});

test("several migrations run in order, each starting from the previous result; a later start skips the earlier ones", () => {
  const log: string[] = [];
  const m0: Migration = (d) => { log.push("0->1"); return { ...d, items: [] }; };
  const m1: Migration = (d) => { log.push("1->2"); return { ...d, items: [...(d.items as unknown[]), "a"] }; };
  const m2: Migration = (d) => { log.push("2->3"); return { ...d, items: [...(d.items as unknown[]), "b"], renamed: d.old, old: undefined }; };
  const list = [m0, m1, m2];
  const r = migrateToCurrent({ old: "x" }, list);
  assert.deepEqual(log, ["0->1", "1->2", "2->3"]);
  assert.equal(r.to, 3);
  assert.deepEqual(r.data.items, ["a", "b"]);
  assert.equal(r.data.schemaVersion, 3, "stamped by the runner after each step");
  log.length = 0;
  const from2 = migrateToCurrent({ schemaVersion: 2, items: ["a"], old: "x" }, list);
  assert.deepEqual(log, ["2->3"], "only what's missing");
  assert.equal(from2.data.schemaVersion, 3);
  assert.throws(() => migrateToCurrent({ schemaVersion: 4 }, list), PortfolioSchemaError, "newer than this (longer) list");
  // A migration that mutates the object it is given must not reach the caller's data.
  const careless: Migration = (d) => { (d as Record<string, unknown>).touched = true; return d; };
  const original = { a: 1 };
  migrateToCurrent(original, [careless]);
  assert.equal("touched" in original, false);
});

// ---- the file on disk (real functions, temp directory) ---------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // portfolio.ts resolves data/ from cwd at import time
const PORTFOLIOS = path.join(dir, "data", "portfolios");
const PRE = path.join(dir, "data", "pre-migration");
mkdirSync(PORTFOLIOS, { recursive: true });
const fileOf = (uid: string) => path.join(PORTFOLIOS, uid + ".json");
const writeRaw = (uid: string, text: string) => writeFileSync(fileOf(uid), text);
const readRaw = (uid: string) => readFileSync(fileOf(uid), "utf8");
const backupsOf = (uid: string) => (existsSync(PRE) ? readdirSync(PRE).filter((f) => f.startsWith(uid)) : []);
const SAVE_DATA = { positions: OLD.positions, trades: [], ledger: {}, nextPositionId: 2, nextTradeId: 1 };

test("disk: an old file goes up to v1 - with a backup of the exact original made first, and no data changed", async () => {
  const { ensurePortfolioMigrated, loadPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000001";
  const original = JSON.stringify(OLD); // compact on purpose: the backup must be the exact bytes, not a re-formatted copy
  writeRaw(uid, original);

  await ensurePortfolioMigrated(uid);

  const after = JSON.parse(readRaw(uid));
  assert.equal(after.schemaVersion, 1);
  assert.deepEqual({ ...after, schemaVersion: undefined }, { ...OLD, schemaVersion: undefined }, "everything else is exactly as it was");
  const backups = backupsOf(uid);
  assert.equal(backups.length, 1, "one backup");
  assert.match(backups[0], /\.v0\./, "named after the version it came from");
  assert.equal(readFileSync(path.join(PRE, backups[0]), "utf8"), original, "byte-identical to the file before the change");

  // Already current now: a second call and a load change nothing and make no second backup.
  const settled = readRaw(uid);
  await ensurePortfolioMigrated(uid);
  const loaded = await loadPortfolio(uid);
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(readRaw(uid), settled);
  assert.equal(backupsOf(uid).length, 1);
});

test("disk: a v1 file is not touched at all, and no backup is made", async () => {
  const { ensurePortfolioMigrated, loadPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000002";
  const text = JSON.stringify({ ...OLD, schemaVersion: 1 }, null, 4); // unusual formatting: any rewrite would show
  writeRaw(uid, text);
  await ensurePortfolioMigrated(uid);
  await loadPortfolio(uid);
  assert.equal(readRaw(uid), text, "byte-identical");
  assert.equal(backupsOf(uid).length, 0);
});

test("disk: a file from a NEWER version is never overwritten - every writer refuses, the reader says why", async () => {
  const p = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000003";
  const future = JSON.stringify({ ...OLD, schemaVersion: 99, brandNewFeature: { keep: "me" } }, null, 2);
  writeRaw(uid, future);

  await assert.rejects(p.getPortfolio(uid), (e: unknown) => e instanceof PortfolioSchemaError && e.code === "too-new" && HEBREW.test(e.message));
  await assert.rejects(p.loadPortfolio(uid), PortfolioSchemaError);
  const saved = await p.savePortfolio(uid, SAVE_DATA, 7);
  assert.ok(!saved.ok && saved.reason === "invalid" && HEBREW.test(saved.message) && saved.message.includes("99"), "the save is refused with the Hebrew reason");
  await assert.rejects(p.updateAlertAcks(uid, { a: { value: 1 } }), PortfolioSchemaError);
  await assert.rejects(p.saveRangeWidthPreference(uid, "wide"), PortfolioSchemaError);
  await assert.rejects(p.updateDailySnapshot(uid, { equityValue: 5, cashOverThreshold: false }), PortfolioSchemaError);
  await assert.rejects(p.saveEquityHistory(uid, []), PortfolioSchemaError);

  assert.equal(readRaw(uid), future, "after all of that the file is byte-identical");
  assert.equal(backupsOf(uid).length, 0, "and nothing was 'migrated'");
});

test("disk: a nonsensical version is refused the same way and the file is left alone", async () => {
  const p = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000004";
  const text = JSON.stringify({ ...OLD, schemaVersion: "one" });
  writeRaw(uid, text);
  await assert.rejects(p.loadPortfolio(uid), (e: unknown) => e instanceof PortfolioSchemaError && e.code === "invalid");
  const saved = await p.savePortfolio(uid, SAVE_DATA, 7);
  assert.ok(!saved.ok && saved.reason === "invalid");
  assert.equal(readRaw(uid), text);
});

test("disk: saving to an old file migrates it first (backup holds the pre-save original), then saves, stamped v1", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000005";
  const original = JSON.stringify({ ...OLD, revision: 0 });
  writeRaw(uid, original);
  const r = await savePortfolio(uid, { ...SAVE_DATA, nextTradeId: 5 }, 0);
  assert.deepEqual(r, { ok: true, revision: 1 });
  const stored = await getPortfolio(uid);
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.nextTradeId, 5, "the save itself went through");
  const backups = backupsOf(uid);
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(PRE, backups[0]), "utf8"), original, "the backup is the file as it was before ANYTHING changed");
});

test("disk: many concurrent writers on an old file migrate it once", async () => {
  const { ensurePortfolioMigrated, savePortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000006";
  writeRaw(uid, JSON.stringify({ ...OLD, revision: 0 }));
  await Promise.all([ensurePortfolioMigrated(uid), ensurePortfolioMigrated(uid), savePortfolio(uid, SAVE_DATA, 0), savePortfolio(uid, SAVE_DATA, 0), ensurePortfolioMigrated(uid)]);
  assert.equal(backupsOf(uid).length, 1, "one backup, not one per caller");
  assert.equal(JSON.parse(readRaw(uid)).schemaVersion, 1);
});

test("disk: a brand-new user's first save is stamped v1, and a client can't downgrade the version", async () => {
  const { savePortfolio, getPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000007";
  assert.equal(existsSync(fileOf(uid)), false);
  assert.deepEqual(await savePortfolio(uid, SAVE_DATA, 0), { ok: true, revision: 1 });
  assert.equal(JSON.parse(readRaw(uid)).schemaVersion, 1);
  assert.equal(backupsOf(uid).length, 0, "nothing old to back up");
  const r = await savePortfolio(uid, { ...SAVE_DATA, schemaVersion: 0 } as never, 1);
  assert.equal(r.ok, true);
  assert.equal((await getPortfolio(uid)).schemaVersion, 1, "a schemaVersion smuggled into the payload does not stick");
});

test("disk: if the backup can't be made the file is NOT changed, writes refuse, and the data can still be read", async () => {
  const { ensurePortfolioMigrated, savePortfolio, loadPortfolio } = await import("../src/lib/portfolio");
  const uid = "dddddddd-0000-4000-8000-000000000008";
  const original = JSON.stringify({ ...OLD, revision: 0 });
  writeRaw(uid, original);
  // Make the backup folder impossible to create: a plain FILE sits where the folder should be.
  rmSync(PRE, { recursive: true, force: true });
  writeFileSync(PRE, "i am a file, not a folder");
  try {
    await assert.rejects(ensurePortfolioMigrated(uid));
    await assert.rejects(savePortfolio(uid, SAVE_DATA, 0), "no write without a backup");
    assert.equal(readRaw(uid), original, "the original file is exactly as it was");
    const shown = await loadPortfolio(uid);
    assert.equal(shown.positions.length, 1, "the data is still shown (upgraded in memory only)");
    assert.equal(readRaw(uid), original, "and showing it didn't change the file");
  } finally {
    rmSync(PRE, { force: true });
  }
});
