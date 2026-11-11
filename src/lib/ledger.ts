// Trade-journal ledger: per-symbol {qty, avgCost} (moving-average cost) rebuilt
// from the WHOLE trade list, in date order. Pure and framework-agnostic
// (type-only imports plus cashEffect), so it runs in the browser bundle, on the
// server and directly under the test runner.
//
// Why this exists: the ledger used to be updated incrementally as each journal
// action happened, which drifts from the trade list it is supposed to describe:
//   - editing a trade added the new version without undoing the old one
//     (buy 10, edited to 12 -> ledger said 22);
//   - deleting a trade never touched the ledger;
//   - a trade dated in the past (or an old file imported later) was applied at
//     the END instead of at its date, so average cost depended on entry order;
//   - a sell with no prior buy set avgCost to the sale price (profit silently
//     0) and a sell above the held quantity drove the quantity negative.
// Rebuilding from the trades after every change makes the ledger a pure function
// of the trade list, so none of these can happen.

import { cashEffect, type Ledger, type LedgerAnchor, type LedgerAnchors, type LedgerEntry, type Trade } from "./portfolioTypes";

/** The fields of a trade that affect the ledger. */
export type LedgerTrade = Pick<Trade, "id" | "date" | "symbol" | "action" | "qty" | "price">;

const BUY = "קנייה";
const SELL = "מכירה";
const CASH = "CASH";
// Quantities below this are treated as "nothing held" (float residue from
// fractional-share sells), never as a real position.
const QTY_EPS = 1e-7;

/** Chronological order: by date, then by id (the order trades were entered). */
export function compareTrades(a: { date: string; id: number }, b: { date: string; id: number }): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id - b.id;
}

export type LedgerIssueKind =
  /** A sell with nothing held for that symbol in the journal. */
  | "no-history"
  /** A sell of more units than the journal says are held. */
  | "exceeds-holding";

export interface LedgerIssue {
  tradeId: number;
  symbol: string;
  kind: LedgerIssueKind;
  /** Units the journal held right before this sell. */
  heldQty: number;
  soldQty: number;
}

/** The ledger state right before a sell - what its profit is measured against. */
export interface SellContext {
  heldQty: number;
  /** Average cost of the held units; null when nothing is held. */
  avgCost: number | null;
}

export interface LedgerBuild {
  ledger: Ledger;
  /** Sells the journal cannot fully explain (see LedgerIssueKind). */
  issues: LedgerIssue[];
  /** State right before each sell, by trade id - used to suggest its profit. */
  sellContext: Map<number, SellContext>;
}

function isCountable(t: LedgerTrade): boolean {
  return t.symbol !== CASH && (t.action === BUY || t.action === SELL) && Number.isFinite(t.qty) && t.qty > 0 && Number.isFinite(t.price);
}

const ANCHOR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** An anchor the ledger can use: finite numbers, a date-shaped asOf, and a
 * positive average cost whenever a quantity is held. Anything else is ignored
 * (the symbol is then rebuilt from its trades alone, as without an anchor). */
function usableAnchor(a: LedgerAnchor | undefined): LedgerAnchor | null {
  if (!a || typeof a.asOf !== "string" || !ANCHOR_DATE_RE.test(a.asOf)) return null;
  if (!Number.isFinite(a.qty) || !Number.isFinite(a.avgCost) || a.qty < 0) return null;
  if (a.qty > QTY_EPS && !(a.avgCost > 0)) return null;
  if (a.lastTradeId !== undefined && !Number.isFinite(a.lastTradeId)) return null;
  return a;
}

/** Whether a trade moves the ledger of a symbol that has this anchor: only a trade
 * entered AFTER the anchor was set (id above lastTradeId) and dated on or after asOf.
 * Trades already in the journal at that moment are part of the anchor (never counted
 * twice); a new trade from asOf onwards counts; one entered later with an older date
 * does not. An anchor without lastTradeId (the first version) counts trades dated
 * after asOf. */
export function anchorCountsTrade(anchor: LedgerAnchor, trade: { id: number; date: string }): boolean {
  if (anchor.lastTradeId === undefined) return trade.date > anchor.asOf;
  return trade.id > anchor.lastTradeId && trade.date >= anchor.asOf;
}

/** Replays every trade in date/id order. Quantity never goes negative: a sell
 * larger than the holding empties it and is reported in `issues`. Closed
 * positions are dropped from the ledger.
 *
 * A symbol with an anchor starts from the anchor's quantity and average cost and
 * applies only the trades that count for it (see anchorCountsTrade). A symbol
 * without an anchor is built from its trades alone. */
export function buildLedger(trades: LedgerTrade[], anchors: LedgerAnchors = {}): LedgerBuild {
  const held = new Map<string, LedgerEntry>();
  const issues: LedgerIssue[] = [];
  const sellContext = new Map<number, SellContext>();

  const active = new Map<string, LedgerAnchor>();
  for (const [symbol, raw] of Object.entries(anchors)) {
    const a = usableAnchor(raw);
    if (!a) continue;
    active.set(symbol, a);
    if (a.qty > QTY_EPS) held.set(symbol, { qty: a.qty, avgCost: a.avgCost });
  }

  for (const t of [...trades].sort(compareTrades)) {
    if (!isCountable(t)) continue;
    const anchor = active.get(t.symbol);
    if (anchor && !anchorCountsTrade(anchor, t)) continue; // already part of the anchor, or dated before it
    const cur = held.get(t.symbol);
    if (t.action === BUY) {
      const curQty = cur ? cur.qty : 0;
      const curAvg = cur ? cur.avgCost : 0;
      const newQty = curQty + t.qty;
      held.set(t.symbol, { qty: newQty, avgCost: curQty > 0 ? (curQty * curAvg + t.qty * t.price) / newQty : t.price });
      continue;
    }
    // Sell
    const heldQty = cur ? cur.qty : 0;
    sellContext.set(t.id, { heldQty, avgCost: cur && heldQty > QTY_EPS ? cur.avgCost : null });
    if (!cur || heldQty <= QTY_EPS) {
      issues.push({ tradeId: t.id, symbol: t.symbol, kind: "no-history", heldQty: 0, soldQty: t.qty });
      held.delete(t.symbol);
      continue;
    }
    if (t.qty > heldQty + QTY_EPS) {
      issues.push({ tradeId: t.id, symbol: t.symbol, kind: "exceeds-holding", heldQty, soldQty: t.qty });
      held.delete(t.symbol);
      continue;
    }
    const left = heldQty - t.qty;
    if (left <= QTY_EPS) held.delete(t.symbol);
    else held.set(t.symbol, { qty: left, avgCost: cur.avgCost });
  }
  return { ledger: Object.fromEntries(held), issues, sellContext };
}

/** The ledger as it stood right before the position (date, id) in the
 * chronological order - what a trade about to be added/edited at that position
 * is measured against. `excludeId` leaves out the trade being edited. */
export function ledgerBefore(trades: LedgerTrade[], at: { date: string; id: number }, excludeId?: number | null, anchors: LedgerAnchors = {}): Ledger {
  // A trade at `at` is measured against the anchor only if that trade itself
  // counts for the anchor (see anchorCountsTrade). Otherwise the symbol's earlier
  // state is unknown (the journal never had it) - it gets no entry rather than a
  // number built from an incomplete history.
  const inEffect: LedgerAnchors = {};
  const unknownBefore = new Set<string>();
  for (const [symbol, raw] of Object.entries(anchors)) {
    const a = usableAnchor(raw);
    if (!a) continue;
    if (anchorCountsTrade(a, at)) inEffect[symbol] = a;
    else unknownBefore.add(symbol);
  }
  const ledger = buildLedger(trades.filter((t) => t.id !== excludeId && compareTrades(t, at) < 0), inEffect).ledger;
  for (const symbol of unknownBefore) delete ledger[symbol];
  return ledger;
}

/** The holding of one symbol right before the position (date, id) - the
 * SellContext for a sell about to be added or edited at that position. */
export function sellContextBefore(trades: LedgerTrade[], at: { date: string; id: number }, symbol: string, excludeId?: number | null, anchors: LedgerAnchors = {}): SellContext {
  const entry = ledgerBefore(trades, at, excludeId, anchors)[symbol];
  return entry ? { heldQty: entry.qty, avgCost: entry.avgCost } : { heldQty: 0, avgCost: null };
}

export interface SellPnlSuggestion {
  /** Suggested realized profit, or null when it can't be known from the journal. */
  pnl: number | null;
  /** Why `pnl` is null / unreliable; null when the journal fully explains the sell. */
  warning: LedgerIssueKind | null;
  heldQty: number;
}

/** Suggested realized profit for selling `qty` at `price` given the state right
 * before the sale. Null - never 0 - when the journal has no (or not enough)
 * purchase history: a made-up 0 would read as a break-even trade. */
export function suggestSellPnl(ctx: SellContext | null | undefined, price: number, qty: number): SellPnlSuggestion {
  const heldQty = ctx ? ctx.heldQty : 0;
  if (!ctx || ctx.avgCost === null || heldQty <= QTY_EPS) return { pnl: null, warning: "no-history", heldQty: 0 };
  if (qty > heldQty + QTY_EPS) return { pnl: null, warning: "exceeds-holding", heldQty };
  return { pnl: Math.round((price - ctx.avgCost) * qty * 100) / 100, warning: null, heldQty };
}

/** Return on the sold cost basis (pnl / (proceeds - pnl)); null when the profit
 * itself is unknown. A zero cost basis gives 0, as the journal always has. */
export function retPctFor(pnl: number | null, value: number): number | null {
  if (pnl === null) return null;
  return value - pnl !== 0 ? pnl / (value - pnl) : 0;
}

export interface LedgerDifference {
  symbol: string;
  /** What is saved; null = no entry. */
  stored: LedgerEntry | null;
  /** What rebuilding from the trades gives; null = no entry. */
  rebuilt: LedgerEntry | null;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
}
// An entry with ~0 units is "nothing held" on either side. A NEGATIVE quantity
// is not: it is exactly the kind of drift this check exists to surface.
const isEmpty = (e: LedgerEntry | undefined): boolean => !e || Math.abs(e.qty) <= QTY_EPS;

/** Per-symbol differences between a saved ledger and a rebuilt one, sorted by
 * symbol. Empty when they agree. Never modifies either ledger. */
export function diffLedgers(stored: Ledger, rebuilt: Ledger): LedgerDifference[] {
  const out: LedgerDifference[] = [];
  const symbols = Array.from(new Set([...Object.keys(stored), ...Object.keys(rebuilt)])).sort();
  for (const symbol of symbols) {
    const a = stored[symbol];
    const b = rebuilt[symbol];
    if (isEmpty(a) && isEmpty(b)) continue;
    if (!isEmpty(a) && !isEmpty(b) && closeEnough(a.qty, b.qty) && closeEnough(a.avgCost, b.avgCost)) continue;
    out.push({ symbol, stored: isEmpty(a) ? null : a, rebuilt: isEmpty(b) ? null : b });
  }
  return out;
}

export interface ImportRowInput {
  date: string;
  symbol: string;
  action: string;
  qty: number;
  price: number;
  fee: number;
  pnlOverride: number | null;
  strategy: string | null;
  notes: string | null;
}

export interface ImportPlan {
  /** The trades to append, in chronological order with consecutive ids. Existing
   * trades are never modified (their saved pnl/retPct stay as they are). */
  newTrades: Trade[];
  /** The ledger rebuilt from existing + new trades. */
  ledger: Ledger;
  /** Net cash effect of the new trades only. */
  cashDelta: number;
  /** New sells whose profit could not be computed from the journal. */
  unresolvedSells: LedgerIssue[];
}

/** Plans an import: assigns ids in date order, computes each new sell's profit
 * against the journal AS OF THAT DATE (existing trades and earlier rows of the
 * same file included, later ones not), and rebuilds the ledger from everything.
 * A profit given in the file wins over the computed one. */
export function planImport(existing: Trade[], rows: ImportRowInput[], firstId: number, anchors: LedgerAnchors = {}): ImportPlan {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.date === b.row.date ? a.index - b.index : a.row.date < b.row.date ? -1 : 1));

  const provisional: Trade[] = ordered.map(({ row }, i) => ({
    id: firstId + i, date: row.date, symbol: row.symbol, action: row.action, qty: row.qty, price: row.price,
    value: row.qty * row.price, fee: row.fee, pnl: null, retPct: null, strategy: row.strategy, notes: row.notes,
  }));

  const build = buildLedger([...existing, ...provisional], anchors);

  const newTrades = provisional.map((t, i): Trade => {
    if (t.action !== SELL || t.symbol === CASH) return t;
    const override = ordered[i].row.pnlOverride;
    const pnl = override !== null ? override : suggestSellPnl(build.sellContext.get(t.id), t.price, t.qty).pnl;
    return { ...t, pnl, retPct: retPctFor(pnl, t.value) };
  });

  return {
    newTrades,
    ledger: build.ledger,
    cashDelta: newTrades.reduce((sum, t) => sum + cashEffect(t), 0),
    // Every new sell left without a profit: the journal couldn't explain it, or
    // it is dated on/before its symbol's anchor (so it is not applied at all).
    unresolvedSells: newTrades
      .filter((t) => t.action === SELL && t.symbol !== CASH && t.pnl === null)
      .map((t): LedgerIssue => build.issues.find((i) => i.tradeId === t.id)
        ?? { tradeId: t.id, symbol: t.symbol, kind: "no-history", heldQty: 0, soldQty: t.qty }),
  };
}

// ---- anchors from the holdings table ------------------------------------------------------

export interface HoldingForAnchor {
  symbol: string;
  qty: number | null;
  avgCost?: number | null;
}

export interface AnchorPlan {
  /** The full proposed set of anchors: the current ones, with the planned ones applied on top. */
  anchors: LedgerAnchors;
  /** Symbols that get an anchor at the holdings' quantity and average cost. */
  anchored: string[];
  /** Symbols in the ledger but not held: they get a "flat" anchor (qty 0), so they drop out of it. */
  flattened: string[];
  /** Held symbols with no average cost in the holdings: left as the trades say. */
  missingAvgCost: string[];
}

/** Plans anchors from the holdings table as of `asOf`, with `lastTradeId` the highest
 * trade id in the journal right now: every held symbol with BOTH
 * a quantity and an average cost is anchored to them; every symbol the ledger
 * still shows (saved or rebuilt) that is not held is flattened; a held symbol
 * without an average cost is left to its trades and reported. CASH is never
 * touched. Pure - it changes nothing. */
export function planAnchorsFromHoldings(
  holdings: HoldingForAnchor[], stored: Ledger, rebuilt: Ledger, current: LedgerAnchors, asOf: string, lastTradeId: number,
): AnchorPlan {
  const anchors: LedgerAnchors = { ...current };
  const anchored: string[] = [];
  const flattened: string[] = [];
  const missingAvgCost: string[] = [];
  const held = new Set<string>();

  for (const h of holdings) {
    if (h.symbol === CASH || typeof h.qty !== "number" || !(h.qty > QTY_EPS)) continue;
    held.add(h.symbol);
    if (typeof h.avgCost === "number" && Number.isFinite(h.avgCost) && h.avgCost > 0) {
      anchors[h.symbol] = { qty: h.qty, avgCost: h.avgCost, asOf, lastTradeId };
      anchored.push(h.symbol);
    } else {
      missingAvgCost.push(h.symbol);
    }
  }

  const inLedger = new Set<string>();
  for (const ledger of [stored, rebuilt]) for (const [symbol, e] of Object.entries(ledger)) if (Math.abs(e.qty) > QTY_EPS) inLedger.add(symbol);
  for (const symbol of Array.from(inLedger).sort()) {
    if (held.has(symbol) || symbol === CASH) continue;
    anchors[symbol] = { qty: 0, avgCost: 0, asOf, lastTradeId };
    flattened.push(symbol);
  }
  return { anchors, anchored, flattened, missingAvgCost };
}
