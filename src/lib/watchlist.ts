// Watchlist (task 10.3): symbols the owner is watching but does not hold, with the price at which
// he would like to enter. Pure and framework-agnostic (type-only imports, no Node APIs), so it runs
// in the browser bundle, on the server and under the test runner.
//
// The watchlist is kept entirely apart from the holdings: nothing here touches positions,
// weights, cash or the portfolio-health score.

import type { WatchlistAssetType, WatchlistItem } from "./portfolioTypes";

export const WATCHLIST_ASSET_LABEL: Record<WatchlistAssetType, string> = { STOCK: "מניה", ETF: "ETF" };
export const MIN_INTEREST = 1;
export const MAX_INTEREST = 5;

/** A new id for an item. Client-generated (no counter to keep in step with the server); unique enough
 * for a personal list, and checked for duplicates by the validation anyway. */
export function newWatchlistId(): string {
  return "w_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export interface WatchlistInput {
  symbol: string;
  name: string;
  assetType: WatchlistAssetType;
  entryPrice: number | null;
  /** As a fraction (0.05 = 5%). */
  targetWeight: number | null;
  interest: number;
  thesis: string;
  notes: string;
}

/** An item from the form's values: symbol upper-cased and trimmed, text trimmed. A new item gets its
 * own id and creation time; editing an existing one keeps its id and creation time and only moves
 * `updatedAt`. */
export function makeWatchlistItem(input: WatchlistInput, nowIso: string, existing?: WatchlistItem): WatchlistItem {
  return {
    id: existing ? existing.id : newWatchlistId(),
    symbol: input.symbol.trim().toUpperCase(),
    name: input.name.trim(),
    assetType: input.assetType,
    entryPrice: input.entryPrice,
    targetWeight: input.targetWeight,
    interest: input.interest,
    thesis: input.thesis.trim(),
    notes: input.notes.trim(),
    createdAt: existing ? existing.createdAt : nowIso,
    updatedAt: nowIso,
  };
}

// ---- the numbers shown next to the price --------------------------------------------------------

export interface WatchlistMetrics {
  /** The 52-week high actually used: the highest daily close, or today's price if that is higher. */
  high: number | null;
  /** How far below the high the price is, as a fraction (0 at the high, 0.25 = 25% below); null if unknown. */
  dropFromHigh: number | null;
  /** (price - desired entry price) / desired entry price: negative = the price is already BELOW the
   * price he wanted to enter at; null when there is no entry price or no price. */
  distanceToEntry: number | null;
}

export function watchlistMetrics(item: Pick<WatchlistItem, "entryPrice">, price: number | null, high52: number | null): WatchlistMetrics {
  const havePrice = typeof price === "number" && Number.isFinite(price) && price > 0;
  const haveHigh = typeof high52 === "number" && Number.isFinite(high52) && high52 > 0;
  // A price above the stored high is a new high (the stored one is a day or more old).
  const high = haveHigh ? (havePrice ? Math.max(high52 as number, price as number) : (high52 as number)) : null;
  const dropFromHigh = havePrice && high !== null ? Math.max(0, (high - (price as number)) / high) : null;
  const entry = item.entryPrice;
  const distanceToEntry = havePrice && typeof entry === "number" && entry > 0 ? ((price as number) - entry) / entry : null;
  return { high, dropFromHigh, distanceToEntry };
}

export type WatchlistSort = "added" | "drop" | "entry";

export const WATCHLIST_SORT_LABEL: Record<WatchlistSort, string> = {
  added: "לפי סדר ההוספה",
  drop: "לפי ירידה מהשיא",
  entry: "לפי מרחק ממחיר הכניסה",
};

/** The list in the chosen order, never modifying the input:
 *   - "added": oldest first (the order he added them in);
 *   - "drop": the biggest fall from the 52-week high first;
 *   - "entry": the smallest signed distance from the desired entry first - so what is already BELOW
 *     its entry price comes first, then what is closest to it.
 * Items with no figure to sort by go last, in the order they were added; ties break by symbol. */
export function sortWatchlist(items: WatchlistItem[], metrics: Record<string, WatchlistMetrics>, sort: WatchlistSort): WatchlistItem[] {
  const byAdded = (a: WatchlistItem, b: WatchlistItem) => (a.createdAt === b.createdAt ? a.symbol.localeCompare(b.symbol) : a.createdAt < b.createdAt ? -1 : 1);
  const list = [...items].sort(byAdded);
  if (sort === "added") return list;
  const key = (i: WatchlistItem): number | null => {
    const m = metrics[i.symbol];
    if (!m) return null;
    return sort === "drop" ? (m.dropFromHigh === null ? null : -m.dropFromHigh) : m.distanceToEntry;
  };
  return list.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null && kb === null) return byAdded(a, b);
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka === kb ? a.symbol.localeCompare(b.symbol) : ka - kb;
  });
}
