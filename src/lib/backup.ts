import { promises as fs } from "fs";
import path from "path";

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
  await fs.writeFile(META_FILE, JSON.stringify(meta), "utf-8");
}

function timestampSlug(d: Date): string {
  // Filesystem-safe on both Windows and POSIX (":" is the only ISO-8601
  // character invalid in a Windows path); sorts chronologically as a plain
  // string, which listBackupDirs()/pruning relies on.
  return d.toISOString().replace(/:/g, "-");
}

async function copyInto(src: string, destDir: string, filename: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(src, path.join(destDir, filename));
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

  try {
    await copyInto(USERS_FILE, snapshotDir, "users.json");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // no users.json yet - nothing to snapshot
  }

  let portfolioFiles: string[] = [];
  try {
    portfolioFiles = (await fs.readdir(PORTFOLIOS_DIR)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const portfoliosDestDir = path.join(snapshotDir, "portfolios");
  for (const file of portfolioFiles) {
    await copyInto(path.join(PORTFOLIOS_DIR, file), portfoliosDestDir, file);
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
