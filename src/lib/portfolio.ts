import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
// This file does Node-only file I/O and must never be imported from client
// components. cashEffect/types live in portfolioTypes.ts (no Node imports)
// specifically so client code can import them without pulling in fs/path -
// re-exported here so existing `from "@/lib/portfolio"` imports keep working.
import { cashEffect, type Position, type Trade, type Ledger, type PortfolioData, type EquityPoint, type StoredPortfolioData, type AlertAck, type HealthScoreAck } from "@/lib/portfolioTypes";
export { cashEffect };
export type { RawPosition, Position, RawTrade, Trade, LedgerEntry, Ledger, PortfolioData, EquityPoint, StoredPortfolioData, AlertAck, HealthScoreAck } from "@/lib/portfolioTypes";

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
    (o.priceTarget === undefined || isFiniteNumberOrNull(o.priceTarget))
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

export async function getPortfolio(userId: string): Promise<StoredPortfolioData> {
  try {
    const raw = await fs.readFile(portfolioPath(userId), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredPortfolioData>;
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

// Write to a unique temp file and rename over the target: rename is atomic on
// the same filesystem, so a reader (or a crash mid-write) never sees a
// truncated/partial JSON file - the old contents remain intact until the new
// file is fully written.
async function writeStoredPortfolio(userId: string, stored: StoredPortfolioData): Promise<void> {
  await fs.mkdir(PORTFOLIOS_DIR, { recursive: true });
  const finalPath = portfolioPath(userId);
  const tmpPath = finalPath + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(stored, null, 2), "utf-8");
  await fs.rename(tmpPath, finalPath);
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

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  // Roll in today's equity snapshot server-side (server clock, not the
  // client's) - update today's point in place if it already exists so
  // repeated saves within the same day refine it, otherwise append a new one.
  const existing = await getPortfolio(userId);
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
  await writeStoredPortfolio(userId, { ...existing, ...data, equityHistory: history, cashIdleSince });
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
}

/** Called from the daily snapshot job (not a user action) so passive market
 * movement is still captured: rolls in today's equity point using live
 * prices, and sets/clears cashIdleSince based on whether cash is currently
 * over its own target - both independent of whether the user touched the
 * app today. See dailySnapshot.ts. */
export async function updateDailySnapshot(userId: string, params: { equityValue: number; cashOverThreshold: boolean }): Promise<void> {
  const existing = await getPortfolio(userId);
  const today = new Date().toISOString().slice(0, 10);
  const history = rollInEquityPoint(existing.equityHistory, today, params.equityValue);
  const cashIdleSince = params.cashOverThreshold ? (existing.cashIdleSince ?? today) : null;
  await writeStoredPortfolio(userId, { ...existing, equityHistory: history, cashIdleSince });
}

/** Overwrites just the equity history, keeping positions/trades/ledger as
 * currently stored - used by the "rebuild from trade journal" action. */
export async function saveEquityHistory(userId: string, history: EquityPoint[]): Promise<void> {
  const existing = await getPortfolio(userId);
  const trimmed = history.length > MAX_EQUITY_POINTS ? history.slice(history.length - MAX_EQUITY_POINTS) : history;
  await writeStoredPortfolio(userId, { ...existing, equityHistory: trimmed });
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
