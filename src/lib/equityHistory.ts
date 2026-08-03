import { cashEffect, type EquityPoint, type Position, type Trade } from "@/lib/portfolioTypes";
import { closestCloseBefore, fetchYahooDailyClosesInRange, type DailyCloses } from "@/lib/prices";

const MAX_SYMBOLS = 60;

export interface RebuildResult {
  history: EquityPoint[];
  warnings: string[];
}

/**
 * Reconstructs a historical portfolio-value curve from the trade log and real
 * historical closing prices (Yahoo Finance, free/unauthenticated).
 *
 * Approach: anchor at TODAY's actual holdings/cash (the one point we know for
 * certain is correct) and walk the trade log BACKWARDS, undoing each trade to
 * derive holdings/cash at every earlier point in time. This is more robust
 * than replaying forward from an assumed zero starting point, because it
 * always reconciles exactly with the live portfolio today - any positions or
 * cash that predate the visible trade log (e.g. a hand-seeded starting
 * portfolio) are correctly absorbed as a flat baseline before the earliest
 * logged trade, instead of being silently missed.
 *
 * Known limitations (inherent to reconstructing from a trade log + daily
 * closes, not something a paid data feed would fully solve either):
 * - Position quantities edited directly in the table (not via a trade) won't
 *   be attributed to the correct historical date - they show up as if they
 *   always existed at their current level, until an actual logged trade for
 *   that symbol is encountered further back.
 * - Daily closes only, not intraday - and non-trading days carry forward the
 *   last known close.
 * - A symbol whose historical prices can't be fetched is excluded from the
 *   value for the dates it's missing (reported back via `warnings`), which
 *   understates the true historical value for that period.
 */
export async function rebuildEquityHistory(trades: Trade[], positions: Position[]): Promise<RebuildResult> {
  if (trades.length === 0) return { history: [], warnings: [] };

  const sorted = [...trades].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date)));
  const symbols = Array.from(new Set(sorted.map((t) => t.symbol).filter((s) => s !== "CASH"))).slice(0, MAX_SYMBOLS);
  const warnings: string[] = [];

  const earliestDate = sorted[0].date;
  const todayDate = new Date().toISOString().slice(0, 10);
  const fromSec = Math.floor(new Date(earliestDate + "T00:00:00Z").getTime() / 1000) - 86400;
  const toSec = Math.floor(Date.now() / 1000) + 86400;

  const priceSeries = new Map<string, DailyCloses | null>();
  await Promise.all(symbols.map(async (sym) => {
    priceSeries.set(sym, await fetchYahooDailyClosesInRange(sym, fromSec, toSec));
  }));
  for (const sym of symbols) {
    if (!priceSeries.get(sym)) warnings.push("לא נמצאו נתוני מחיר היסטוריים עבור " + sym + " - הוא לא ייכלל בשחזור.");
  }

  // Anchor: today's real, live holdings and cash.
  const qtyToday: Record<string, number> = {};
  let cashToday = 0;
  for (const p of positions) {
    if (p.symbol === "CASH") cashToday = p.value;
    else if (p.qty != null) qtyToday[p.symbol] = p.qty;
  }
  for (const sym of symbols) if (!(sym in qtyToday)) qtyToday[sym] = 0;

  // Walk the trade log backwards from today, undoing each trade to get the
  // holdings/cash state immediately before it. Store the state as of "right
  // after trade i" for every i, plus the anchor state as "right after the
  // last trade" (== today, since the log should already explain today).
  const stateAfter: Array<{ qty: Record<string, number>; cash: number }> = new Array(sorted.length + 1);
  stateAfter[sorted.length] = { qty: { ...qtyToday }, cash: cashToday };
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i];
    const next = stateAfter[i + 1];
    const qty = { ...next.qty };
    const cash = next.cash - cashEffect(t);
    if (t.symbol !== "CASH" && (t.action === "קנייה" || t.action === "מכירה")) {
      const sign = t.action === "קנייה" ? 1 : -1;
      qty[t.symbol] = (qty[t.symbol] || 0) - sign * t.qty;
    }
    stateAfter[i] = { qty, cash };
  }

  // Unified list of trading dates to plot: the union of every symbol's actual
  // price-history dates (so we only plot real market data points), plus the
  // earliest trade date and today as guaranteed bounds.
  const dateSet = new Set<string>([earliestDate, todayDate]);
  for (const series of priceSeries.values()) {
    if (!series) continue;
    for (const ts of series.t) dateSet.add(new Date(ts * 1000).toISOString().slice(0, 10));
  }
  const dates = Array.from(dateSet).filter((d) => d >= earliestDate && d <= todayDate).sort();

  let tradeCursor = 0;
  const history: EquityPoint[] = [];
  for (const date of dates) {
    while (tradeCursor < sorted.length && sorted[tradeCursor].date <= date) tradeCursor++;
    const state = stateAfter[tradeCursor];
    const dateTs = Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);

    let value = state.cash;
    for (const sym of symbols) {
      const qty = state.qty[sym] || 0;
      if (qty <= 0) continue;
      const series = priceSeries.get(sym);
      const price = series ? closestCloseBefore(series, dateTs) : null;
      if (price !== null) value += qty * price;
    }
    history.push({ date, value: Math.round(value * 100) / 100 });
  }

  return { history, warnings };
}
