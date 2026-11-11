// 9.1: deleting an account must delete EVERY copy of the user's portfolio - including the
// pre-migration copies made by the schema migration (0.10) and quarantined damaged files -
// and only that user's. Real functions in a throwaway temp directory; the real data/ is
// never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const dir = mkdtempSync(path.join(tmpdir(), "ipms-test-"));
process.chdir(dir); // the data modules resolve data/ from cwd at import time
const DATA = path.join(dir, "data");
const PORTFOLIOS = path.join(DATA, "portfolios");
const PRE = path.join(DATA, "pre-migration");
const CORRUPT = path.join(DATA, "corrupted");
const BACKUPS = path.join(DATA, "backups");
mkdirSync(PORTFOLIOS, { recursive: true });
writeFileSync(path.join(DATA, "users.json"), "[]");

const A = "aaaaaaaa-1111-4111-8111-00000000000a";
const B = "bbbbbbbb-1111-4111-8111-00000000000b";
const C = "cccccccc-1111-4111-8111-00000000000c";
const OLD = (who: string) => JSON.stringify({ positions: [], trades: [], ledger: {}, nextPositionId: 1, nextTradeId: 1, equityHistory: [], alertAcks: {}, owner: who });
const live = (u: string) => path.join(PORTFOLIOS, u + ".json");
const preCopies = (u: string) => (existsSync(PRE) ? readdirSync(PRE).filter((f) => f.startsWith(u + ".")) : []);
const quarantined = (u: string) => (existsSync(CORRUPT) ? readdirSync(CORRUPT).filter((f) => f.startsWith(u + ".json.")) : []);
const snapshotCopies = (u: string) => readdirSync(BACKUPS, { withFileTypes: true }).filter((e) => e.isDirectory()).filter((e) => existsSync(path.join(BACKUPS, e.name, "portfolios", u + ".json"))).length;

test("account deletion removes the portfolio, the backup snapshots, the pre-migration copies and the quarantined copies - of that user only", async () => {
  const { ensurePortfolioMigrated } = await import("../src/lib/portfolio");
  const { runBackupNow } = await import("../src/lib/backup");
  const { deleteUserData } = await import("../src/lib/userData");

  // Three users with old (v0) files; migrating each makes a pre-migration copy.
  for (const u of [A, B, C]) writeFileSync(live(u), OLD(u));
  for (const u of [A, B, C]) await ensurePortfolioMigrated(u);
  await runBackupNow(); // a regular snapshot holding all three
  // Quarantined damaged copies (what a self-heal keeps aside) for A and B.
  mkdirSync(CORRUPT, { recursive: true });
  writeFileSync(path.join(CORRUPT, A + ".json.2026-11-01T00-00-00-000Z.corrupt"), "{ partial data of A");
  writeFileSync(path.join(CORRUPT, B + ".json.2026-11-01T00-00-00-000Z.corrupt"), "{ partial data of B");
  // Files that are NOT A's but look similar - they must survive.
  writeFileSync(path.join(PRE, "README.txt"), "keep");
  writeFileSync(path.join(PRE, A + "x.v0.2026-01-01T00-00-00-000Z.json"), "{}");

  for (const u of [A, B, C]) assert.equal(preCopies(u).length, 1, "a pre-migration copy exists for " + u.slice(0, 1));
  assert.ok(snapshotCopies(A) >= 1 && snapshotCopies(B) >= 1);
  assert.equal(quarantined(A).length, 1);

  await deleteUserData(A);

  assert.equal(existsSync(live(A)), false, "live portfolio gone");
  assert.equal(snapshotCopies(A), 0, "no backup snapshot holds A's portfolio any more");
  assert.deepEqual(preCopies(A), [], "A's pre-migration copies gone");
  assert.deepEqual(quarantined(A), [], "A's quarantined copies gone");
  // ...and nothing of anyone else's.
  assert.equal(existsSync(live(B)), true);
  assert.ok(snapshotCopies(B) >= 1);
  assert.equal(preCopies(B).length, 1);
  assert.equal(quarantined(B).length, 1);
  assert.equal(readFileSync(path.join(PRE, "README.txt"), "utf8"), "keep");
  assert.ok(existsSync(path.join(PRE, A + "x.v0.2026-01-01T00-00-00-000Z.json")), "a similar-looking name is not A's file");

  // Doing it again is harmless.
  await deleteUserData(A);
  assert.equal(preCopies(B).length, 1);
});

test("before this change the deletion left the pre-migration and quarantined copies behind (documented)", async () => {
  const { ensurePortfolioMigrated, deletePortfolio } = await import("../src/lib/portfolio");
  const { deleteUserPortfolioBackups } = await import("../src/lib/backup");
  const { deleteUserData } = await import("../src/lib/userData");
  const u = "dddddddd-1111-4111-8111-00000000000d";
  writeFileSync(live(u), OLD(u));
  await ensurePortfolioMigrated(u);
  writeFileSync(path.join(CORRUPT, u + ".json.2026-11-02T00-00-00-000Z.corrupt"), "{ partial");

  // What deleteAccount used to do:
  await deletePortfolio(u);
  await deleteUserPortfolioBackups(u);
  assert.equal(preCopies(u).length, 1, "a full copy of the portfolio was still on disk");
  assert.equal(quarantined(u).length, 1);

  await deleteUserData(u);
  assert.deepEqual(preCopies(u), []);
  assert.deepEqual(quarantined(u), []);
});

test("nothing to delete is fine (missing folders), and a bad user id deletes nothing", async () => {
  const { deleteUserData } = await import("../src/lib/userData");
  const { deleteUserMigrationBackups } = await import("../src/lib/portfolio");
  const { deleteUserQuarantinedCopies } = await import("../src/lib/backup");
  const keepB = preCopies(B).length;
  const E = "eeeeeeee-1111-4111-8111-00000000000e";
  await deleteUserData(E); // a user with no copies anywhere
  for (const bad of ["../x", "*", "", "aaaaaaaa", B + "/.."]) {
    await assert.rejects(deleteUserData(bad), () => true, "refused: " + JSON.stringify(bad));
    await assert.rejects(deleteUserMigrationBackups(bad));
    await assert.rejects(deleteUserQuarantinedCopies(bad));
  }
  assert.equal(preCopies(B).length, keepB, "B's copy survived the refused calls");
  // The folders don't exist at all (a system that never migrated or quarantined anything).
  rmSync(PRE, { recursive: true, force: true });
  rmSync(CORRUPT, { recursive: true, force: true });
  await deleteUserData(E);
});

test("the deleteAccount action uses it (so no step can be forgotten again)", () => {
  const src = readFileSync(path.join(__dirname, "..", "src", "app", "actions", "auth.ts"), "utf8");
  assert.match(src, /await deleteUserData\(session\.userId\);\s*await deleteUser\(session\.userId\);/, "all of the user's data first, then the user record");
  assert.ok(!/deletePortfolio\(|deleteUserPortfolioBackups\(/.test(src), "the old piecemeal calls are gone");
});
