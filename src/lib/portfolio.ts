import { promises as fs } from "fs";
import path from "path";
import { withFileLock } from "@/lib/fileLock";
import { writeFileDurable } from "@/lib/durableFile";
import { recoverFromBackup } from "@/lib/backup";
// This file does Node-only file I/O and must never be imported from client
// components. cashEffect/types live in portfolioTypes.ts (no Node imports)
// specifically so client code can import them without pulling in fs/path -
// re-exported here so existing `from "@/lib/portfolio"` imports keep working.
import { cashEffect, type Position, type Trade, type Ledger, type PortfolioData, type EquityPoint, type StoredPortfolioData, type AlertAck, type HealthScoreAck, type MorningBriefData, type RangeWidthPreference, type SavePortfolioResult } from "@/lib/portfolioTypes";
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

const MAX_POSITIONS = 300;
const MAX_TRADES = 20_000;
const MAX_LEDGER_ENTRIES = 1_000;
const MAX_SYMBOL_LEN = 20;
const MAX_SHORT_STRING_LEN = 500;
const MAX_NOTES_LEN = 5_000;
const VALID_ACTIONS = new Set(["קנייה", "מכירה", "הפקדה", "משיכה", "אחר"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isFiniteNumberOrNull(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}
function isNonEmptyShortString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}
function isShortStringOrNull(v: unknown, maxLen: number): v is string | null {
  return v === null || (typeof v === "string" && v.length <= maxLen);
}

function isValidPosition(p: unknown): p is Position {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    isFiniteNumber(o.id) &&
    isNonEmptyShortString(o.symbol, MAX_SYMBOL_LEN) &&
    isFiniteNumberOrNull(o.qty) &&
    isFiniteNumberOrNull(o.price) &&
    isFiniteNumber(o.value) &&
    isFiniteNumber(o.weight) &&
    isFiniteNumber(o.dev) &&
    isFiniteNumber(o.min) &&
    isFiniteNumber(o.max) &&
    isFiniteNumber(o.dilute) &&
    (o.hodl === undefined || typeof o.hodl === "boolean") &&
    (o.priceTarget === undefined || isFiniteNumberOrNull(o.priceTarget)) &&
    (o.avgCost === undefined || isFiniteNumberOrNull(o.avgCost))
  );
}

function isValidTrade(t: unknown): t is Trade {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    isFiniteNumber(o.id) &&
    typeof o.date === "string" && DATE_RE.test(o.date) &&
    isNonEmptyShortString(o.symbol, MAX_SYMBOL_LEN) &&
    typeof o.action === "string" && VALID_ACTIONS.has(o.action) &&
    isFiniteNumber(o.qty) &&
    isFiniteNumber(o.price) &&
    isFiniteNumber(o.value) &&
    isFiniteNumber(o.fee) &&
    isFiniteNumberOrNull(o.pnl) &&
    isFiniteNumberOrNull(o.retPct) &&
    isShortStringOrNull(o.strategy, MAX_SHORT_STRING_LEN) &&
    isShortStringOrNull(o.notes, MAX_NOTES_LEN)
  );
}

function isValidLedger(l: unknown): l is Ledger {
  if (!l || typeof l !== "object" || Array.isArray(l)) return false;
  const entries = Object.entries(l as Record<string, unknown>);
  if (entries.length > MAX_LEDGER_ENTRIES) return false;
  return entries.every(([symbol, entry]) => {
    if (symbol.length === 0 || symbol.length > MAX_SYMBOL_LEN) return false;
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return isFiniteNumber(e.qty) && isFiniteNumber(e.avgCost);
  });
}

/** Runtime shape/bounds check for client-submitted portfolio data. TypeScript
 * types alone don't survive the network boundary, so this is the real guard
 * against malformed or oversized payloads reaching disk. */
export function isValidPortfolioData(data: unknown): data is PortfolioData {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.positions) || o.positions.length > MAX_POSITIONS) return false;
  if (!o.positions.every(isValidPosition)) return false;
  if (!Array.isArray(o.trades) || o.trades.length > MAX_TRADES) return false;
  if (!o.trades.every(isValidTrade)) return false;
  if (!isValidLedger(o.ledger)) return false;
  if (!isFiniteNumber(o.nextPositionId) || !isFiniteNumber(o.nextTradeId)) return false;
  return true;
}

function emptyPortfolio(): StoredPortfolioData {
  return { positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0, equityHistory: [], alertAcks: {}, cashIdleSince: null };
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
  if (isPlainObject(recovered)) return recovered as Partial<StoredPortfolioData>;
  throw new Error(PORTFOLIO_UNREADABLE_MESSAGE);
}

export async function getPortfolio(userId: string): Promise<StoredPortfolioData> {
  try {
    const parsed = await readPortfolioFile(userId);
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
  await writeFileDurable(portfolioPath(userId), JSON.stringify(stored, null, 2));
}

function rollInEquityPoint(history: EquityPoint[], today: string, value: number): EquityPoint[] {
  const next = history.slice();
  const last = next[next.length - 1];
  if (last && last.date === today) {
    next[next.length - 1] = { date: today, value };
  } else {
    next.push({ date: today, value });
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
    // Roll in today's equity snapshot server-side (server clock, not the
    // client's) - update today's point in place if it already exists so
    // repeated saves within the same day refine it, otherwise append a new one.
    const total = data.positions.reduce((sum, p) => sum + p.value, 0);
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
  await withFileLock(portfolioPath(userId), async () => {
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
  await withFileLock(portfolioPath(userId), async () => {
    const existing = await getPortfolio(userId);
    await writeStoredPortfolio(userId, { ...existing, rangeWidthPreference: pref });
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
  params: { equityValue: number; cashOverThreshold: boolean; morningBrief?: MorningBriefData; healthScoreAck?: HealthScoreAck }
): Promise<void> {
  await withFileLock(portfolioPath(userId), async () => {
    const existing = await getPortfolio(userId);
    const today = new Date().toISOString().slice(0, 10);
    const history = rollInEquityPoint(existing.equityHistory, today, params.equityValue);
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
  await withFileLock(portfolioPath(userId), async () => {
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

/** Permanently removes this user's live portfolio file (positions, trades,
 * ledger, equity history) - used by account deletion. Does not touch
 * historical backup snapshots; see deleteUserPortfolioBackups in backup.ts. */
export async function deletePortfolio(userId: string): Promise<void> {
  await fs.rm(portfolioPath(userId), { force: true });
}
