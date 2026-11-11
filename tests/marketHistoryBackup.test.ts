// 10.1: the shared market-history file is part of the regular daily backup, with the same
// "only copy it if it is valid" check as the other files - and an unreadable live file is
// restored from the newest valid snapshot instead of being replaced by an empty one.
// Real functions in a throwaway temp directory; the real data/ is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // the data modules resolve data/ from cwd at import time
const DATA = path.join(dir, "data");
const BACKUPS = path.join(DATA, "backups");
const HISTORY = path.join(DATA, "market-history.json");
mkdirSync(path.join(DATA, "portfolios"), { recursive: true });
writeFileSync(path.join(DATA, "users.json"), "[]");
writeFileSync(path.join(DATA, "portfolios", "aaaaaaaa-1111-4111-8111-00000000000a.json"), JSON.stringify({ positions: [], trades: [] }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snapshots = () => (existsSync(BACKUPS) ? readdirSync(BACKUPS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const newest = () => snapshots()[snapshots().length - 1];
const copyIn = (snap: string) => path.join(BACKUPS, snap, "market-history.json");
const hist = (days: Record<string, unknown>) => JSON.stringify({ days });
const GOOD = hist({ "2026-03-09": { vix: 20.5, pressure: 41.2, recordedAt: "x" }, "2026-03-10": { vix: 17.6, pressure: 33.0, recordedAt: "x" } });

async function snapshotNow() {
  const { runBackupNow } = await import("../src/lib/backup");
  await sleep(5); // snapshot folders are named by the millisecond
  await runBackupNow();
  return newest();
}

test("a valid history file is copied into the daily snapshot, byte for byte, next to the other files", async () => {
  const { recordMarketHistory } = await import("../src/lib/marketData");
  await recordMarketHistory("2026-03-10", { vix: 17.6 }); // written by the real code, so the path is the one the app uses
  const live = readFileSync(HISTORY, "utf8");
  const snap = await snapshotNow();
  assert.equal(readFileSync(copyIn(snap), "utf8"), live, "same bytes as the live file");
  assert.ok(existsSync(path.join(BACKUPS, snap, "users.json")), "users are still backed up");
  assert.equal(readdirSync(path.join(BACKUPS, snap, "portfolios")).length, 1, "and so are portfolios");
});

test("no history file yet is fine: nothing copied, nothing breaks", async () => {
  const { rmSync } = await import("fs");
  rmSync(HISTORY, { force: true });
  const snap = await snapshotNow();
  assert.equal(existsSync(copyIn(snap)), false);
  assert.ok(existsSync(path.join(BACKUPS, snap, "users.json")));
});

test("a damaged history file is NOT copied (so it can't push out the last good copy) and is reported; the rest still backs up", async () => {
  writeFileSync(HISTORY, GOOD);
  const good = await snapshotNow();
  assert.equal(readFileSync(copyIn(good), "utf8"), GOOD);

  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  const bad: Array<[string, string]> = [
    ["not JSON", "{ this is not json"],
    ["zero-filled", "\0\0\0\0\0\0"],
    ["a list", "[]"],
    ["no days", JSON.stringify({ something: 1 })],
    ["days is a list", JSON.stringify({ days: [] })],
    ["a bare string", JSON.stringify("hello")],
  ];
  try {
    for (const [label, content] of bad) {
      writeFileSync(HISTORY, content);
      const snap = await snapshotNow();
      assert.equal(existsSync(copyIn(snap)), false, "not copied: " + label);
      assert.ok(existsSync(path.join(BACKUPS, snap, "users.json")), "users still backed up: " + label);
    }
  } finally {
    console.error = realError;
  }
  assert.equal(errors.filter((e) => e.includes("[backup] skipped market-history.json")).length, bad.length, "every skip is reported");
  assert.equal(readFileSync(copyIn(good), "utf8"), GOOD, "the last good copy is untouched");
});

test("an unreadable live file is restored from the newest VALID snapshot, and the damaged one is kept aside", async () => {
  const { readMarketHistory } = await import("../src/lib/marketData");
  // The newest snapshots hold no copy (they were taken while the file was damaged); an older one does.
  writeFileSync(HISTORY, "{ damaged beyond repair");
  const restored = await readMarketHistory();
  assert.deepEqual(restored, JSON.parse(GOOD), "the last good copy, not an empty history");
  assert.equal(readFileSync(HISTORY, "utf8"), GOOD, "and the live file is repaired");
  const aside = readdirSync(path.join(DATA, "corrupted")).filter((f) => f.startsWith("market-history.json.") && f.endsWith(".corrupt"));
  assert.equal(aside.length, 1, "the damaged file is kept for diagnosis");
  assert.equal(readFileSync(path.join(DATA, "corrupted", aside[0]), "utf8"), "{ damaged beyond repair");
});

test("a live file with a valid shape is trusted as is (no needless restore)", async () => {
  const { readMarketHistory } = await import("../src/lib/marketData");
  const current = hist({ "2026-03-11": { vix: 18, pressure: 40, recordedAt: "x" } });
  writeFileSync(HISTORY, current);
  assert.deepEqual(await readMarketHistory(), JSON.parse(current));
  assert.equal(readFileSync(HISTORY, "utf8"), current);
});

test("with no valid snapshot at all the damaged file is set aside and a new history starts (nothing is lost silently)", async () => {
  const { rmSync } = await import("fs");
  const { readMarketHistory, recordMarketHistory } = await import("../src/lib/marketData");
  rmSync(BACKUPS, { recursive: true, force: true });
  writeFileSync(HISTORY, "{ nope");
  const before = readdirSync(path.join(DATA, "corrupted")).length;
  assert.deepEqual(await readMarketHistory(), { days: {} });
  assert.equal(existsSync(HISTORY), false, "moved away");
  assert.equal(readdirSync(path.join(DATA, "corrupted")).length, before + 1, "kept aside");
  await recordMarketHistory("2026-03-12", { vix: 19 });
  assert.equal(JSON.parse(readFileSync(HISTORY, "utf8")).days["2026-03-12"].vix, 19);
});

test("history copies follow the normal rotation (the oldest snapshot, and its copy, are dropped)", async () => {
  const { rmSync } = await import("fs");
  rmSync(BACKUPS, { recursive: true, force: true });
  writeFileSync(HISTORY, GOOD);
  for (let i = 0; i < 16; i++) await snapshotNow();
  assert.equal(snapshots().length, 14, "the existing limit of 14 snapshots applies");
  assert.ok(snapshots().every((s) => existsSync(copyIn(s))), "every kept snapshot has its history copy");
});
