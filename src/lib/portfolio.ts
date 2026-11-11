import { promises as fs } from "fs";
import path from "path";
import { withFileLock } from "@/lib/fileLock";
import { writeFileDurable } from "@/lib/durableFile";
import { recoverFromBackup } from "@/lib/backup";
// This file does Node-only file I/O and must never be imported from client
// components. cashEffect/types live in portfolioTypes.ts (no Node imports)
// specifically so client code can import them without pulling in fs/path -
// re-exported here so existing `from "@/lib/portfolio"` imports keep working.
import { CURRENT_SCHEMA_VERSION, PortfolioSchemaError, migrateToCurrent } from "@/lib/schema";
import { normalizeMarketSettings, type MarketSettings } from "@/lib/marketStatus";
import { isValidPortfolioData, validatePortfolio, newErrors, formatRejection, recomputedValue } from "@/lib/validation";
import { cashEffect, type PortfolioData, type EquityPoint, type StoredPortfolioData, type AlertAck, type HealthScoreAck, type MorningBriefData, type RangeWidthPreference, type SavePortfolioResult } from "@/lib/portfolioTypes";
export { cashEffect };
export type { RawPosition, Position, RawTrade, Trade, LedgerEntry, Ledger, PortfolioData, EquityPoint, StoredPortfolioData, AlertAck, HealthScoreAck, EarningsEntry, NewsHeadline, MorningBriefData, RangeWidthPreference, RiskTolerance, ConcentrationPreference, SavePortfolioResult } from "@/lib/portfolioTypes";
export { suggestedPositionRange, equalWeightTarget, deriveRangeWidthPreference } from "@/lib/portfolioTypes";

const PORTFOLIOS_DIR = path.join(process.cwd(), "data", "portfolios");
const MAX_EQUITY_POINTS = 3_650; // ~10 years of daily snapshots

// userId always comes from a server-signed session token (never directly from
// client input), but this guard is a cheap belt-and-suspenders check so a
// malformed/unexpected id can never be used to build a file path outside the
// portfolios directory.
const USER_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The structural validators (isValidPortfolioData and its helpers) live in
// lib/validation.ts together with the semantic rules, so the browser and the
// server enforce one set of rules. Re-exported here for existing importers.
export { isValidPortfolioData };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function emptyPortfolio(): StoredPortfolioData {
  return { positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0, equityHistory: [], alertAcks: {}, cashIdleSince: null, schemaVersion: CURRENT_SCHEMA_VERSION };
}

function portfolioPath(userId: string): string {
  if (!USER_ID_RE.test(userId)) {
    throw new Error("מזהה משתמש לא תקין.");
  }
  return path.join(PORTFOLIOS_DIR, `${userId}.json`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// What a snapshot copy must look like before it's trusted as a restore source:
// stricter than the live-file check on purpose (an old snapshot with no
// positions/trades arrays is not a portfolio worth restoring).
function looksLikeSavedPortfolio(v: unknown): boolean {
  return isPlainObject(v) && Array.isArray(v.positions) && Array.isArray(v.trades);
}

// Users whose file has been confirmed to be at the current schema version in this process,
// so the version check before a write costs nothing after the first time. Cleared when a
// file is restored from a backup (the restored copy may be an older version).
const migrationChecked = new Set<string>();

const PORTFOLIO_UNREADABLE_MESSAGE = "קובץ התיק פגום ולא נמצא גיבוי תקין לשחזור. הנתונים לא נמחקו - פנה לבעל המערכת.";

/** Reads and parses one user's portfolio file. A file that exists but can't be
 * parsed (zero-filled or truncated by an unclean shutdown) is restored from
 * the newest valid snapshot instead of taking the whole app down; with no
 * valid snapshot it fails loudly and leaves the file alone. A *missing* file
 * (ENOENT) is not an error here - the caller treats it as a new user. */
async function readPortfolioFile(userId: string): Promise<Partial<StoredPortfolioData>> {
  const file = portfolioPath(userId);
  const raw = await fs.readFile(file, "utf-8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed as Partial<StoredPortfolioData>;
  } catch {
    // fall through to recovery
  }
  const recovered = await recoverFromBackup({ livePath: file, relPath: "portfolios/" + userId + ".json", isValid: looksLikeSavedPortfolio });
  if (isPlainObject(recovered)) {
    migrationChecked.delete(userId);
    return recovered as Partial<StoredPortfolioData>;
  }
  throw new Error(PORTFOLIO_UNREADABLE_MESSAGE);
}

/** Reads one user's portfolio, brought up to the current schema IN MEMORY (see
 * lib/schema.ts). It never writes: a file from an older version is upgraded on disk by
 * ensurePortfolioMigrated (with a backup first), and a file from a NEWER version than this
 * code, or with a nonsensical version, throws PortfolioSchemaError instead of being read
 * as if it were current. */
export async function getPortfolio(userId: string): Promise<StoredPortfolioData> {
  try {
    const raw = await readPortfolioFile(userId);
    const parsed = migrateToCurrent(raw as Record<string, unknown>).data as Partial<StoredPortfolioData>;
    // Older saved files predate equityHistory/alertAcks - default them rather than crash.
    return {
      ...emptyPortfolio(),
      ...parsed,
      equityHistory: Array.isArray(parsed.equityHistory) ? parsed.equityHistory : [],
      alertAcks: parsed.alertAcks && typeof parsed.alertAcks === "object" ? parsed.alertAcks : {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyPortfolio();
    throw err;
  }
}

// Temp file + fsync + rename (see writeFileDurable): rename alone keeps the name
// atomic but does not stop a power loss from leaving the new file at full size
// with zero-filled contents - the data must be flushed to disk first.
async function writeStoredPortfolio(userId: string, stored: StoredPortfolioData): Promise<void> {
  await fs.mkdir(PORTFOLIOS_DIR, { recursive: true });
  // Always stamped with the version this code writes, whatever the object carried (a
  // client can't downgrade it). Nothing newer or invalid ever gets here - getPortfolio
  // refuses such a file before any writer reaches this point.
  await writeFileDurable(portfolioPath(userId), JSON.stringify({ ...stored, schemaVersion: CURRENT_SCHEMA_VERSION }, null, 2));
}

// ---- schema migration on disk ------------------------------------------------------------

const PRE_MIGRATION_DIR = path.join(process.cwd(), "data", "pre-migration");

/** Saves the file's exact current text before a migration changes it, and checks the
 * copy reads back identical. A separate folder, outside the rotating daily snapshots, so
 * it is never pruned. Returns the path. Throws if the copy can't be made or verified -
 * and then the migration must not go ahead. */
async function backupBeforeMigration(userId: string, rawText: string, fromVersion: number): Promise<string> {
  await fs.mkdir(PRE_MIGRATION_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(PRE_MIGRATION_DIR, userId + ".v" + fromVersion + "." + stamp + ".json");
  await writeFileDurable(dest, rawText);
  if ((await fs.readFile(dest, "utf-8")) !== rawText) {
    throw new Error("הגיבוי שנוצר לפני שדרוג מבנה הנתונים אינו זהה למקור, ולכן השדרוג בוטל.");
  }
  return dest;
}

/** Brings the user's portfolio FILE up to the current schema version: if it is older, a
 * backup of the file is made first, the migrations run, and the result is saved. A file
 * already at the current version is not touched; a file from a newer version (or with an
 * invalid one) throws PortfolioSchemaError and is not touched either; a missing file is
 * nothing to do. If the backup can't be made this throws and the file stays as it was.
 * It takes the portfolio's lock itself, so it must be called OUTSIDE it (see
 * withPortfolioLock); concurrent callers migrate once. */
export async function ensurePortfolioMigrated(userId: string): Promise<void> {
  if (migrationChecked.has(userId)) return;
  const file = portfolioPath(userId);
  await withFileLock(file, async () => {
    let raw: Partial<StoredPortfolioData>;
    try {
      raw = await readPortfolioFile(userId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // no file yet: nothing to migrate
      throw err;
    }
    const result = migrateToCurrent(raw as Record<string, unknown>); // throws for too-new / invalid
    if (result.migrated) {
      const backup = await backupBeforeMigration(userId, await fs.readFile(file, "utf-8"), result.from);
      await writeFileDurable(file, JSON.stringify(result.data, null, 2));
      console.log("[migration] " + userId + ": schema v" + result.from + " -> v" + result.to + ", original saved to " + backup);
    }
    migrationChecked.add(userId);
  });
}

/** Reads a portfolio for display: upgrades the file first when it is old. If the upgrade
 * itself fails (e.g. the backup can't be written) the data is still shown, upgraded in
 * memory only - writes will refuse until the cause is fixed, but nothing is lost. A newer
 * or invalid schema version is never swallowed. */
export async function loadPortfolio(userId: string): Promise<StoredPortfolioData> {
  try {
    await ensurePortfolioMigrated(userId);
  } catch (err) {
    if (err instanceof PortfolioSchemaError) throw err;
    console.error("[migration] could not upgrade the file for " + userId + " - showing it without saving:", err);
  }
  return getPortfolio(userId);
}

/** The lock every portfolio writer runs under: the file is first brought up to the
 * current schema (outside the lock - the lock is not re-entrant), then the writer
 * runs serialized with every other writer of that file. */
async function withPortfolioLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await ensurePortfolioMigrated(userId);
  return withFileLock(portfolioPath(userId), fn);
}

function rollInEquityPoint(history: EquityPoint[], today: string, value: number, staleSymbols?: string[]): EquityPoint[] {
  const next = history.slice();
  const last = next[next.length - 1];
  const point: EquityPoint = staleSymbols && staleSymbols.length > 0 ? { date: today, value, staleSymbols } : { date: today, value };
  if (last && last.date === today) {
    next[next.length - 1] = point;
  } else {
    next.push(point);
    if (next.length > MAX_EQUITY_POINTS) next.splice(0, next.length - MAX_EQUITY_POINTS);
  }
  return next;
}

function computeCashIdleSince(positions: PortfolioData["positions"], total: number, previous: string | null | undefined, today: string): string | null {
  const cashPos = positions.find((p) => p.symbol === "CASH");
  const overThreshold = Boolean(cashPos && total > 0 && cashPos.value / total > cashPos.max);
  return overThreshold ? (previous ?? today) : null;
}

/** The revision a stored portfolio is currently at (0 for files written
 * before revisions existed). */
export function currentRevision(p: Pick<StoredPortfolioData, "revision">): number {
  return typeof p.revision === "number" && Number.isInteger(p.revision) && p.revision >= 0 ? p.revision : 0;
}

export async function savePortfolio(userId: string, data: PortfolioData, baseRevision: number): Promise<SavePortfolioResult> {
  // Locked per-user so two near-simultaneous saves (autosave firing from two
  // open tabs, say) can't both read the same "existing" snapshot and then
  // have the second write silently clobber fields the first one set.
  // A file from a newer version of the system is never overwritten: say so, in Hebrew.
  try {
    await ensurePortfolioMigrated(userId);
  } catch (err) {
    if (err instanceof PortfolioSchemaError) return { ok: false, reason: "invalid", message: err.message, issues: [] } as const;
    throw err;
  }
  return withFileLock(portfolioPath(userId), async () => {
    const existing = await getPortfolio(userId);
    // The lock alone serializes writes but can't stop a *stale* writer: a tab
    // (or second device) still holding yesterday's state would otherwise
    // overwrite today's edits on its next autosave. Refuse any save that
    // wasn't based on the revision currently on disk.
    const onDisk = currentRevision(existing);
    if (baseRevision !== onDisk) {
      return { ok: false, reason: "conflict", currentRevision: onDisk } as const;
    }
    // Refuse data that doesn't make sense (negative quantity, min above max,
    // 31 February, duplicate ids...) - but only problems that are NEW compared
    // with what is already stored. A portfolio that already contains one (from
    // before these checks existed) stays editable and saveable; it is never
    // locked out. The refusal is returned, not thrown, so the Hebrew
    // explanation reliably reaches the user.
    const introduced = newErrors(validatePortfolio(data), validatePortfolio(existing));
    if (introduced.length > 0) {
      return { ok: false, reason: "invalid", message: formatRejection(introduced), issues: introduced } as const;
    }
    // Roll in today's equity snapshot server-side (server clock, not the
    // client's) - update today's point in place if it already exists so
    // repeated saves within the same day refine it, otherwise append a new one.
    // The total uses qty x price recomputed here, not the browser's own
    // arithmetic, so a wrong value sent by a client can't land in the history.
    const total = data.positions.reduce((sum, p) => sum + recomputedValue(p), 0);
    const today = new Date().toISOString().slice(0, 10);
    const history = rollInEquityPoint(existing.equityHistory, today, total);
    // Also re-checked here (not just in the daily snapshot job) so cash
    // crossing its target via an actual trade is caught immediately instead
    // of waiting for the next once-a-day check.
    const cashIdleSince = computeCashIdleSince(data.positions, total, existing.cashIdleSince, today);

    // Spread `existing` first so server-maintained fields the client never
    // submits (alertAcks, healthScoreAck, cashIdleSince) survive a save
    // instead of being silently dropped - `data` only overrides
    // positions/trades/ledger/nextPositionId/nextTradeId.
    const revision = onDisk + 1;
    await writeStoredPortfolio(userId, { ...existing, ...data, equityHistory: history, cashIdleSince, revision });
    return { ok: true, revision } as const;
  });
}

const MAX_ALERT_ACKS = 500;
const MAX_ACKS_PER_REQUEST = 100;
const MAX_ALERT_ID_LEN = 200;

/** Runtime guard for the ackAlerts server action's payload - same spirit as
 * isValidPortfolioData: the network boundary needs a real check, TypeScript
 * types alone don't survive it. */
export function isValidAckPayload(data: unknown): data is { acks: Record<string, { value: number }>; healthScoreAck?: { score: number; rangeRatio: number; cashHealth: number; breachScore: number } } {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (!o.acks || typeof o.acks !== "object" || Array.isArray(o.acks)) return false;
  const entries = Object.entries(o.acks as Record<string, unknown>);
  if (entries.length > MAX_ACKS_PER_REQUEST) return false;
  const acksValid = entries.every(([id, v]) => {
    if (id.length === 0 || id.length > MAX_ALERT_ID_LEN) return false;
    if (!v || typeof v !== "object") return false;
    return isFiniteNumber((v as Record<string, unknown>).value);
  });
  if (!acksValid) return false;
  if (o.healthScoreAck !== undefined) {
    if (!o.healthScoreAck || typeof o.healthScoreAck !== "object") return false;
    const h = o.healthScoreAck as Record<string, unknown>;
    if (!isFiniteNumber(h.score) || !isFiniteNumber(h.rangeRatio) || !isFiniteNumber(h.cashHealth) || !isFiniteNumber(h.breachScore)) return false;
  }
  return true;
}

/** Merges the given alert acknowledgements into storage (bell opened or an
 * alert explicitly dismissed) - additive, never removes an id the caller
 * didn't mention. Also updates the health-score ack when provided, since it
 * needs its own richer shape (see HealthScoreAck). Timestamps are always
 * stamped with the server clock, never trusting a client-supplied one. */
export async function updateAlertAcks(
  userId: string,
  acks: Record<string, { value: number }>,
  healthBreakdown?: { score: number; rangeRatio: number; cashHealth: number; breachScore: number },
): Promise<void> {
  await withPortfolioLock(userId, async () => {
    const existing = await getPortfolio(userId);
    const seenAt = new Date().toISOString();
    const newAcks: Record<string, AlertAck> = Object.fromEntries(
      Object.entries(acks).map(([id, { value }]) => [id, { value, seenAt }]),
    );
    const merged = { ...existing.alertAcks, ...newAcks };
    const keys = Object.keys(merged);
    if (keys.length > MAX_ALERT_ACKS) {
      // Drop the oldest entries by seenAt so the map can't grow unbounded -
      // in practice this only matters for a portfolio with an implausibly
      // large number of distinct symbols/occurrences.
      const sorted = keys.sort((a, b) => merged[a].seenAt.localeCompare(merged[b].seenAt));
      for (const k of sorted.slice(0, keys.length - MAX_ALERT_ACKS)) delete merged[k];
    }
    const healthScoreAck: HealthScoreAck | undefined = healthBreakdown ? { ...healthBreakdown, seenAt } : existing.healthScoreAck;
    await writeStoredPortfolio(userId, { ...existing, alertAcks: merged, healthScoreAck });
  });
}

/** Sets the user's saved range-width preference (from the onboarding
 * questionnaire, or re-answered later in settings) - independent of the
 * regular savePortfolio flow since it isn't part of client-submitted
 * PortfolioData, same as alertAcks/cashIdleSince. */
export async function saveRangeWidthPreference(userId: string, pref: RangeWidthPreference): Promise<void> {
  await withPortfolioLock(userId, async () => {
    const existing = await getPortfolio(userId);
    await writeStoredPortfolio(userId, { ...existing, rangeWidthPreference: pref });
  });
}

/** The user's thresholds for the market-status card, always valid: anything missing or
 * invalid in the file falls back to the defaults. */
export async function getMarketSettings(userId: string): Promise<MarketSettings> {
  return normalizeMarketSettings((await getPortfolio(userId)).marketSettings);
}

/** Saves the user's market-status thresholds (already validated by the caller). A server-managed
 * field like rangeWidthPreference: it is not part of the client-submitted portfolio data and does
 * not bump the revision, so it can never make an open tab look stale. */
export async function saveMarketSettings(userId: string, settings: MarketSettings): Promise<void> {
  await withPortfolioLock(userId, async () => {
    const existing = await getPortfolio(userId);
    await writeStoredPortfolio(userId, { ...existing, marketSettings: settings });
  });
}

/** Called from the daily snapshot job (not a user action) so passive market
 * movement is still captured: rolls in today's equity point using live
 * prices, sets/clears cashIdleSince based on whether cash is currently over
 * its own target, and optionally refreshes the cached Morning Brief data
 * (earnings/news) - all independent of whether the user touched the app
 * today. See dailySnapshot.ts. */
export async function updateDailySnapshot(
  userId: string,
  params: { equityValue: number; staleSymbols?: string[]; cashOverThreshold: boolean; morningBrief?: MorningBriefData; healthScoreAck?: HealthScoreAck }
): Promise<void> {
  await withPortfolioLock(userId, async () => {
    const existing = await getPortfolio(userId);
    const today = new Date().toISOString().slice(0, 10);
    const history = rollInEquityPoint(existing.equityHistory, today, params.equityValue, params.staleSymbols);
    const cashIdleSince = params.cashOverThreshold ? (existing.cashIdleSince ?? today) : null;
    const morningBrief = params.morningBrief ?? existing.morningBrief;
    // Seed-only: never overwrites an ack that already exists (from the user
    // dismissing the alert, or an earlier daily run) - see the comment where
    // this is computed in dailySnapshot.ts for why a baseline needs seeding
    // at all.
    const healthScoreAck = existing.healthScoreAck ?? params.healthScoreAck;
    await writeStoredPortfolio(userId, { ...existing, equityHistory: history, cashIdleSince, morningBrief, healthScoreAck });
  });
}

/** Overwrites just the equity history, keeping positions/trades/ledger as
 * currently stored - used by the "rebuild from trade journal" action. */
export async function saveEquityHistory(userId: string, history: EquityPoint[]): Promise<void> {
  await withPortfolioLock(userId, async () => {
    const existing = await getPortfolio(userId);
    const trimmed = history.length > MAX_EQUITY_POINTS ? history.slice(history.length - MAX_EQUITY_POINTS) : history;
    // The day-by-day snapshots being replaced were real recorded values that
    // can't be regenerated; keep them aside instead of discarding them, so a
    // bad rebuild (missing prices, unadjusted splits) is never irreversible.
    // An existing non-empty backup is kept as is: it is the original, and the
    // series being replaced now may itself be the output of an earlier (maybe
    // partial) rebuild - overwriting would lose the real data on a second click.
    const original = existing.equityHistoryBeforeRebuild && existing.equityHistoryBeforeRebuild.length > 0
      ? existing.equityHistoryBeforeRebuild
      : existing.equityHistory;
    await writeStoredPortfolio(userId, { ...existing, equityHistory: trimmed, equityHistoryBeforeRebuild: original });
  });
}

/** Every userId with a portfolio file on disk - used by the daily snapshot
 * job to iterate all users without going through users.json (a user with no
 * portfolio yet has nothing for that job to do anyway). */
export async function listPortfolioUserIds(): Promise<string[]> {
  try {
    const files = await fs.readdir(PORTFOLIOS_DIR);
    return files
      .filter((f) => f.endsWith(".json") && USER_ID_RE.test(f.slice(0, -".json".length)))
      .map((f) => f.slice(0, -".json".length));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Removes this user's pre-migration copies (data/pre-migration/<userId>.v<n>.<time>.json,
 * see backupBeforeMigration) - each is a full copy of the portfolio file, so account
 * deletion must remove them too or "delete my data" would leave the data behind. Only
 * files that belong to this user are touched; a missing folder is nothing to do. */
export async function deleteUserMigrationBackups(userId: string): Promise<void> {
  portfolioPath(userId); // refuses anything that is not a real user id
  let names: string[];
  try {
    names = await fs.readdir(PRE_MIGRATION_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    // Named `<userId>.v<n>.<timestamp>.json` (or its unfinished `.tmp`); the id is a fixed-length
    // UUID, so "starts with <userId>." can only ever be this user's.
    if (name.startsWith(userId + ".")) await fs.rm(path.join(PRE_MIGRATION_DIR, name), { force: true });
  }
}

/** Permanently removes this user's live portfolio file (positions, trades,
 * ledger, equity history) - used by account deletion. Does not touch
 * historical backup snapshots (deleteUserPortfolioBackups in backup.ts) or
 * pre-migration copies (deleteUserMigrationBackups above); deleteUserData in
 * userData.ts removes all of it together. */
export async function deletePortfolio(userId: string): Promise<void> {
  migrationChecked.delete(userId);
  await fs.rm(portfolioPath(userId), { force: true });
}
