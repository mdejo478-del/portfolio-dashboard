import { promises as fs } from "fs";
import path from "path";
import { writeFileDurable } from "@/lib/durableFile";
import { withFileLock } from "@/lib/fileLock";

// Snapshots data/users.json and every data/portfolios/*.json into a new
// timestamped folder under data/backups, on the same Railway volume as the
// live data. This protects against the app (or a bug in it) corrupting or
// losing a file - it does NOT protect against losing the volume itself. If
// that matters, these snapshots should eventually also be shipped somewhere
// off-volume (e.g. object storage) - out of scope here, but worth knowing.

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PORTFOLIOS_DIR = path.join(DATA_DIR, "portfolios");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const META_FILE = path.join(BACKUPS_DIR, ".meta.json");
const QUARANTINE_DIR = path.join(DATA_DIR, "corrupted");
const MAX_QUARANTINED_FILES = 10;

// "Once a day" by default, matching the least-frequent option the user asked
// for; kept well under the retention window below so history spans ~2 weeks.
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_BACKUPS_TO_KEEP = 14;

interface BackupMeta {
  lastBackupAt: number;
}

async function readMeta(): Promise<BackupMeta | null> {
  try {
    return JSON.parse(await fs.readFile(META_FILE, "utf-8")) as BackupMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null; // a corrupt/unreadable meta file should never block backups - treat as "never backed up"
  }
}

async function writeMeta(meta: BackupMeta): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  await writeFileDurable(META_FILE, JSON.stringify(meta));
}

function timestampSlug(d: Date): string {
  // Filesystem-safe on both Windows and POSIX (":" is the only ISO-8601
  // character invalid in a Windows path); sorts chronologically as a plain
  // string, which listBackupDirs()/pruning relies on.
  return d.toISOString().replace(/:/g, "-");
}

type BackupKind = "users" | "portfolio";

function isValidFor(kind: BackupKind, parsed: unknown): boolean {
  if (kind === "users") return Array.isArray(parsed);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
}

/** Copies a live data file into a snapshot - but only if it currently parses.
 * A plain file copy would happily snapshot a damaged file (e.g. one zero-filled
 * by an unclean shutdown), and since snapshots rotate, enough poisoned ones
 * would eventually push out the last good copy - the one thing recovery needs.
 * A damaged file is skipped (and reported) instead; older snapshots still hold
 * its last good version. The copy itself is flushed to disk like any save. */
async function copyValidated(src: string, destDir: string, filename: string, kind: BackupKind): Promise<void> {
  let text: string;
  try {
    text = await fs.readFile(src, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  let ok = false;
  try { ok = isValidFor(kind, JSON.parse(text)); } catch { ok = false; }
  if (!ok) {
    console.error("[backup] skipped " + filename + ": the live file is not valid JSON, so it was not copied into the snapshot");
    return;
  }
  await fs.mkdir(destDir, { recursive: true });
  await writeFileDurable(path.join(destDir, filename), text);
}

async function listBackupDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function pruneOldBackups(): Promise<void> {
  const dirs = await listBackupDirs();
  const excess = dirs.length - MAX_BACKUPS_TO_KEEP;
  if (excess <= 0) return;
  for (const name of dirs.slice(0, excess)) {
    await fs.rm(path.join(BACKUPS_DIR, name), { recursive: true, force: true });
  }
}

async function createSnapshot(): Promise<void> {
  const snapshotDir = path.join(BACKUPS_DIR, timestampSlug(new Date()));

  await copyValidated(USERS_FILE, snapshotDir, "users.json", "users"); // no users.json yet - nothing to snapshot

  let portfolioFiles: string[] = [];
  try {
    portfolioFiles = (await fs.readdir(PORTFOLIOS_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const portfoliosDestDir = path.join(snapshotDir, "portfolios");
  for (const file of portfolioFiles) {
    await copyValidated(path.join(PORTFOLIOS_DIR, file), portfoliosDestDir, file, "portfolio");
  }

  await writeMeta({ lastBackupAt: Date.now() });
  await pruneOldBackups();
}

// Concurrency guard: if a backup is already running when another caller asks
// for one (the post-save hook and the periodic timer can land at nearly the
// same moment), they share the same in-flight snapshot instead of racing two
// copies of the same files against each other.
let inFlight: Promise<void> | null = null;

/** Always creates a fresh snapshot right now, regardless of the last one's
 * age. Used by the manual "create backup now" action and by the periodic
 * scheduler (which only calls this once it has itself determined a backup
 * is due - see maybeRunBackup). */
export async function runBackupNow(): Promise<void> {
  if (!inFlight) {
    inFlight = createSnapshot().finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Cheap check-and-maybe-backup: no-ops unless at least MIN_INTERVAL_MS has
 * passed since the last snapshot. Safe to call after every single portfolio
 * save (which can happen many times a minute during active editing) without
 * spamming the disk with near-duplicate snapshots. */
export async function maybeRunBackup(): Promise<void> {
  const meta = await readMeta();
  if (meta && Date.now() - meta.lastBackupAt < MIN_INTERVAL_MS) return;
  await runBackupNow();
}

type LiveRead = { status: "ok"; value: unknown } | { status: "missing" } | { status: "corrupt" };

async function readLive(livePath: string): Promise<LiveRead> {
  let text: string;
  try {
    text = await fs.readFile(livePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw err;
  }
  try { return { status: "ok", value: JSON.parse(text) }; } catch { return { status: "corrupt" }; }
}

async function quarantine(livePath: string): Promise<void> {
  // Keep the damaged file for diagnosis instead of overwriting it, but never
  // let that housekeeping stand in the way of the restore itself.
  try {
    await fs.mkdir(QUARANTINE_DIR, { recursive: true });
    const stamp = timestampSlug(new Date());
    await fs.copyFile(livePath, path.join(QUARANTINE_DIR, path.basename(livePath) + "." + stamp + ".corrupt"));
    const kept = (await fs.readdir(QUARANTINE_DIR)).filter((f) => f.endsWith(".corrupt")).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX_QUARANTINED_FILES))) {
      await fs.rm(path.join(QUARANTINE_DIR, old), { force: true });
    }
  } catch (err) {
    console.error("[recovery] could not quarantine the damaged file:", err);
  }
}

/** Self-heal for a live data file that exists but can't be parsed (zero-filled
 * or truncated after an unclean shutdown): finds the newest snapshot holding a
 * valid copy of the same file, keeps the damaged one aside under data/corrupted,
 * and durably restores the good copy in its place. Returns the restored value,
 * or null if there was nothing valid to restore from (or the file is gone
 * entirely, e.g. a deleted account - a missing file is never "restored").
 *
 * Runs under its own lock key (not the data file's), so it can be called from
 * inside code that already holds the data file's lock without deadlocking, and
 * re-checks the file once it has the lock so two callers hitting the same
 * damage restore it once, not twice - and a save that landed in between is
 * never overwritten with an older snapshot. */
export async function recoverFromBackup(opts: {
  livePath: string;
  relPath: string; // path of the same file inside a snapshot folder, e.g. "portfolios/<id>.json"
  isValid: (parsed: unknown) => boolean;
}): Promise<unknown | null> {
  return withFileLock("recovery:" + opts.livePath, async () => {
    const current = await readLive(opts.livePath);
    if (current.status === "ok" && opts.isValid(current.value)) return current.value;
    if (current.status === "missing") return null;

    const dirs = (await listBackupDirs()).reverse(); // newest first
    for (const name of dirs) {
      let text: string;
      try { text = await fs.readFile(path.join(BACKUPS_DIR, name, opts.relPath), "utf-8"); } catch { continue; }
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { continue; }
      if (!opts.isValid(parsed)) continue;
      await quarantine(opts.livePath);
      await writeFileDurable(opts.livePath, text);
      console.error("[recovery] " + opts.relPath + " was unreadable - restored from snapshot " + name);
      return parsed;
    }
    console.error("[recovery] " + opts.relPath + " is unreadable and no snapshot holds a valid copy");
    return null;
  });
}

/** Removes this user's portfolio file from every existing backup snapshot -
 * used by account deletion, so "delete my data" doesn't leave copies of the
 * portfolio recoverable from a past snapshot. Historical copies of
 * users.json (which also briefly contained this user's record) are left
 * alone: they're whole-table point-in-time snapshots, not per-user data,
 * and age out on their own via the existing rolling retention window. */
/** Removes this user's quarantined copies (data/corrupted/<userId>.json.<time>.corrupt - the
 * damaged file kept aside by a self-heal, which can still hold readable data). Part of
 * account deletion. Only files that belong to this user are touched. */
export async function deleteUserQuarantinedCopies(userId: string): Promise<void> {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId)) throw new Error("מזהה משתמש לא תקין.");
  let names: string[];
  try {
    names = await fs.readdir(QUARANTINE_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    if (name.startsWith(userId + ".json.")) await fs.rm(path.join(QUARANTINE_DIR, name), { force: true });
  }
}

export async function deleteUserPortfolioBackups(userId: string): Promise<void> {
  const dirs = await listBackupDirs();
  for (const name of dirs) {
    const file = path.join(BACKUPS_DIR, name, "portfolios", `${userId}.json`);
    await fs.rm(file, { force: true });
  }
}
