import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
// This file does Node-only file I/O and must never be imported from client
// components. cashEffect/types live in portfolioTypes.ts (no Node imports)
// specifically so client code can import them without pulling in fs/path -
// re-exported here so existing `from "@/lib/portfolio"` imports keep working.
import { cashEffect, type Position, type Trade, type Ledger, type PortfolioData, type EquityPoint, type StoredPortfolioData } from "@/lib/portfolioTypes";
export { cashEffect };
export type { RawPosition, Position, RawTrade, Trade, LedgerEntry, Ledger, PortfolioData, EquityPoint, StoredPortfolioData } from "@/lib/portfolioTypes";

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
const VALID_ACTIONS = new Set(["קנייה", "מכירה", "הפקדה", "משיכה"]);
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
    (o.hodl === undefined || typeof o.hodl === "boolean")
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
  return { positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0, equityHistory: [] };
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
    // Older saved files predate equityHistory - default it rather than crash.
    return { ...emptyPortfolio(), ...parsed, equityHistory: Array.isArray(parsed.equityHistory) ? parsed.equityHistory : [] };
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

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  // Roll in today's equity snapshot server-side (server clock, not the
  // client's) - update today's point in place if it already exists so
  // repeated saves within the same day refine it, otherwise append a new one.
  const existing = await getPortfolio(userId);
  const total = data.positions.reduce((sum, p) => sum + p.value, 0);
  const today = new Date().toISOString().slice(0, 10);
  const history = existing.equityHistory.slice();
  const last = history[history.length - 1];
  if (last && last.date === today) {
    history[history.length - 1] = { date: today, value: total };
  } else {
    history.push({ date: today, value: total });
    if (history.length > MAX_EQUITY_POINTS) history.splice(0, history.length - MAX_EQUITY_POINTS);
  }

  await writeStoredPortfolio(userId, { ...data, equityHistory: history });
}

/** Overwrites just the equity history, keeping positions/trades/ledger as
 * currently stored - used by the "rebuild from trade journal" action. */
export async function saveEquityHistory(userId: string, history: EquityPoint[]): Promise<void> {
  const existing = await getPortfolio(userId);
  const trimmed = history.length > MAX_EQUITY_POINTS ? history.slice(history.length - MAX_EQUITY_POINTS) : history;
  await writeStoredPortfolio(userId, { ...existing, equityHistory: trimmed });
}
