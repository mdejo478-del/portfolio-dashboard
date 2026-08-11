import { promises as fs } from "fs";
import path from "path";
import { getPortfolio, listPortfolioUserIds, updateDailySnapshot, type MorningBriefData } from "@/lib/portfolio";
import { getQuotes, getEarningsCalendar, getCompanyNews, type RawEarningsEntry, type RawNewsHeadline } from "@/lib/prices";

// Fixes gaps that only mattered once alerts and Morning Brief started
// depending on history the app previously only ever wrote as a side effect
// of a user action (savePortfolio): equityHistory (needed for a real
// all-time-high, not just "the highest value on a day someone happened to
// trade"), cashIdleSince (needed to notice cash quietly drifting over its
// target purely from other positions' prices moving, with no trade at all),
// and now Morning Brief's cached earnings/news (which need refreshing once a
// day regardless of whether the user did anything).
//
// Same shape as backup.ts on purpose: hourly check, cheap no-op unless a
// day has passed, tracked in a meta file that survives restarts, each user
// handled independently so one failure can't take down the rest.

const DATA_DIR = path.join(process.cwd(), "data");
const META_FILE = path.join(DATA_DIR, "daily-snapshot-meta.json");
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const EARNINGS_WINDOW_DAYS = 14;
const NEWS_TOP_SYMBOLS = 5;
const NEWS_HEADLINES_PER_SYMBOL = 2;
const NEWS_LOOKBACK_DAYS = 4;

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

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Builds this user's cached Morning Brief data from the shared earnings
 * map (already fetched once for the whole run) and a per-run news cache
 * (shared across users so two users holding the same symbol only fetch its
 * news once). Ranks "top symbols" by stored value, not a live price - good
 * enough for picking which symbols matter, and avoids needing a live quote
 * fetch just for this when the equity snapshot itself isn't due. */
async function buildMorningBrief(
  portfolio: Awaited<ReturnType<typeof getPortfolio>>,
  earningsBySymbol: Map<string, RawEarningsEntry[]>,
  newsCache: Map<string, RawNewsHeadline[]>,
  today: string,
  newsFrom: string,
): Promise<MorningBriefData> {
  const heldSymbols = portfolio.positions
    .filter((p) => p.symbol !== "CASH")
    .sort((a, b) => b.value - a.value);

  const upcomingEarnings = heldSymbols
    .flatMap((p) => earningsBySymbol.get(p.symbol) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ symbol: e.symbol, date: e.date, hour: e.hour, epsEstimate: e.epsEstimate }));

  const topSymbols = heldSymbols.slice(0, NEWS_TOP_SYMBOLS).map((p) => p.symbol);
  const newsEntries: MorningBriefData["news"] = [];
  for (const symbol of topSymbols) {
    let items = newsCache.get(symbol);
    if (items === undefined) {
      items = await getCompanyNews(symbol, newsFrom, today);
      newsCache.set(symbol, items);
    }
    for (const n of items.slice(0, NEWS_HEADLINES_PER_SYMBOL)) {
      newsEntries.push({
        symbol, headline: n.headline, summary: n.summary, source: n.source,
        datetime: new Date(n.datetime * 1000).toISOString(), url: n.url,
      });
    }
  }
  newsEntries.sort((a, b) => b.datetime.localeCompare(a.datetime));

  return { generatedAt: new Date().toISOString(), upcomingEarnings, news: newsEntries };
}

async function snapshotUser(
  userId: string,
  today: string,
  earningsBySymbol: Map<string, RawEarningsEntry[]>,
  newsCache: Map<string, RawNewsHeadline[]>,
  newsFrom: string,
): Promise<void> {
  const portfolio = await getPortfolio(userId);

  const lastEquity = portfolio.equityHistory[portfolio.equityHistory.length - 1];
  // A user-triggered save today is more accurate than a fetch here (it
  // reflects whatever prices the client had at that exact moment) - don't
  // overwrite it with a redundant one.
  const needsEquitySnapshot = !(lastEquity && lastEquity.date === today);
  const needsBriefRefresh = !(portfolio.morningBrief && portfolio.morningBrief.generatedAt.slice(0, 10) === today);

  if (!needsEquitySnapshot && !needsBriefRefresh) return;

  let equityValue: number;
  if (needsEquitySnapshot) {
    const symbols = portfolio.positions.filter((p) => p.symbol !== "CASH" && p.qty !== null).map((p) => p.symbol);
    const quotes = symbols.length > 0 ? await getQuotes(symbols) : { configured: true, prices: {}, dayChangePct: {}, extended: {} };
    equityValue = 0;
    for (const p of portfolio.positions) {
      if (p.symbol === "CASH") { equityValue += p.value; continue; }
      const livePrice = quotes.prices[p.symbol];
      // Fall back to the last stored price for a symbol whose fetch failed,
      // rather than dropping it out of the total entirely.
      equityValue += p.qty !== null ? p.qty * (livePrice ?? p.price ?? 0) : p.value;
    }
  } else {
    // Equity already fresh for today - reuse it rather than re-fetching
    // quotes just to re-derive the same number.
    equityValue = lastEquity!.value;
  }
  const cashPos = portfolio.positions.find((p) => p.symbol === "CASH");
  const cashOverThreshold = Boolean(cashPos && equityValue > 0 && cashPos.value / equityValue > cashPos.max);

  const morningBrief = needsBriefRefresh
    ? await buildMorningBrief(portfolio, earningsBySymbol, newsCache, today, newsFrom)
    : undefined;

  await updateDailySnapshot(userId, { equityValue, cashOverThreshold, morningBrief });
}

async function runSnapshotNow(): Promise<void> {
  const today = dateStr(new Date());
  const earningsTo = dateStr(new Date(Date.now() + EARNINGS_WINDOW_DAYS * 86_400_000));
  const newsFrom = dateStr(new Date(Date.now() - NEWS_LOOKBACK_DAYS * 86_400_000));

  // One shared, unscoped earnings-calendar call covers every user's held
  // symbols at once - far cheaper than a per-symbol call per user.
  const rawEarnings = await getEarningsCalendar(today, earningsTo);
  const earningsBySymbol = new Map<string, RawEarningsEntry[]>();
  for (const e of rawEarnings) {
    const list = earningsBySymbol.get(e.symbol);
    if (list) list.push(e); else earningsBySymbol.set(e.symbol, [e]);
  }

  // Shared across all users in this run: if two users both hold AAPL, its
  // news is fetched once, not once per user.
  const newsCache = new Map<string, RawNewsHeadline[]>();

  const userIds = await listPortfolioUserIds();
  for (const userId of userIds) {
    try {
      await snapshotUser(userId, today, earningsBySymbol, newsCache, newsFrom);
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
