import { promises as fs } from "fs";
import path from "path";
import { getPortfolio, listPortfolioUserIds, updateDailySnapshot } from "@/lib/portfolio";
import { getQuotes } from "@/lib/prices";

// Fixes two gaps that only mattered once alerts started depending on
// history the app previously only ever wrote as a side effect of a user
// action (savePortfolio): equityHistory (needed for a real all-time-high,
// not just "the highest value on a day someone happened to trade") and
// cashIdleSince (needed to notice cash quietly drifting over its target
// purely from other positions' prices moving, with no trade at all).
//
// Same shape as backup.ts on purpose: hourly check, cheap no-op unless a
// day has passed, tracked in a meta file that survives restarts, each user
// handled independently so one failure can't take down the rest.

const DATA_DIR = path.join(process.cwd(), "data");
const META_FILE = path.join(DATA_DIR, "daily-snapshot-meta.json");
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface SnapshotMeta {
  lastRunAt: number;
}

async function readMeta(): Promise<SnapshotMeta | null> {
  try {
    return JSON.parse(await fs.readFile(META_FILE, "utf-8")) as SnapshotMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null; // a corrupt/unreadable meta file should never block this - treat as "never run"
  }
}

async function writeMeta(meta: SnapshotMeta): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(META_FILE, JSON.stringify(meta), "utf-8");
}

async function snapshotUser(userId: string, today: string): Promise<void> {
  const portfolio = await getPortfolio(userId);
  const last = portfolio.equityHistory[portfolio.equityHistory.length - 1];
  // Already have a point for today, from this job or a user action - a
  // user-triggered save is the more accurate of the two (it reflects
  // whatever prices the client had at that exact moment), so don't
  // overwrite it with a redundant fetch.
  if (last && last.date === today) return;

  const cashPos = portfolio.positions.find((p) => p.symbol === "CASH");
  const symbols = portfolio.positions.filter((p) => p.symbol !== "CASH" && p.qty !== null).map((p) => p.symbol);
  const quotes = symbols.length > 0 ? await getQuotes(symbols) : { configured: true, prices: {}, dayChangePct: {}, extended: {} };

  let total = 0;
  for (const p of portfolio.positions) {
    if (p.symbol === "CASH") { total += p.value; continue; }
    const livePrice = quotes.prices[p.symbol];
    // Fall back to the last stored price for a symbol whose fetch failed,
    // rather than dropping it out of the total entirely.
    total += p.qty !== null ? p.qty * (livePrice ?? p.price ?? 0) : p.value;
  }

  const cashOverThreshold = Boolean(cashPos && total > 0 && cashPos.value / total > cashPos.max);
  await updateDailySnapshot(userId, { equityValue: total, cashOverThreshold });
}

async function runSnapshotNow(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const userIds = await listPortfolioUserIds();
  for (const userId of userIds) {
    try {
      await snapshotUser(userId, today);
    } catch (err) {
      console.error("[dailySnapshot] failed for user " + userId + ":", err);
    }
  }
  await writeMeta({ lastRunAt: Date.now() });
}

let inFlight: Promise<void> | null = null;

/** Cheap check-and-maybe-run: no-ops unless at least MIN_INTERVAL_MS has
 * passed since the last run. Safe to call on every hourly instrumentation
 * tick without spamming the price API. */
export async function maybeRunDailySnapshot(): Promise<void> {
  const meta = await readMeta();
  if (meta && Date.now() - meta.lastRunAt < MIN_INTERVAL_MS) return;
  if (!inFlight) {
    inFlight = runSnapshotNow().finally(() => { inFlight = null; });
  }
  return inFlight;
}
