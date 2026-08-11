// Pure data types and framework/runtime-agnostic logic shared between the
// client (InvestmentDashboard.tsx) and server-only modules (portfolio.ts,
// equityHistory.ts). Deliberately has zero Node-only imports (no fs/path/
// crypto) so it's safe to pull into the browser bundle - unlike portfolio.ts,
// which does file I/O and must never be imported from client code.

export interface RawPosition {
  symbol: string;
  qty: number | null;
  price: number | null;
  value: number;
  weight: number;
  dev: number;
  min: number;
  max: number;
  dilute: number;
  hodl?: boolean;
  // Optional personal price target ($) - independent of the min/max weight
  // range above: price and weight can cross their respective thresholds at
  // different times, since weight also depends on the rest of the
  // portfolio's value, not just this position's own price.
  priceTarget?: number | null;
}
export interface Position extends RawPosition {
  id: number;
}

export interface RawTrade {
  date: string;
  symbol: string;
  action: string;
  qty: number;
  price: number;
  value: number;
  fee: number;
  pnl: number | null;
  retPct: number | null;
  strategy: string | null;
  notes: string | null;
}
export interface Trade extends RawTrade {
  id: number;
}

export interface LedgerEntry {
  qty: number;
  avgCost: number;
}
export type Ledger = Record<string, LedgerEntry>;

export interface PortfolioData {
  positions: Position[];
  trades: Trade[];
  ledger: Ledger;
  nextPositionId: number;
  nextTradeId: number;
}

export interface EquityPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

// Persisted per-user "what has the user already been shown" record for one
// alert occurrence, keyed by a stable alert id (e.g. "below-min:GOOG"). The
// alert re-fires once the live metric has moved materially away from `value`
// (see src/lib/alertRules.ts) instead of either repeating on every login
// (no ack at all) or staying silently suppressed forever after one dismissal
// (id-only dedup, the bug this replaces).
export interface AlertAck {
  value: number;
  seenAt: string; // ISO
}

// Portfolio-health alerts need the score's breakdown (not just the scalar)
// to name the main driver of a change, so they get their own richer ack
// instead of squeezing into AlertAck's single `value` number.
export interface HealthScoreAck {
  score: number;
  rangeRatio: number;
  cashHealth: number;
  breachScore: number;
  seenAt: string; // ISO
}

export interface EarningsEntry {
  symbol: string;
  date: string;              // YYYY-MM-DD
  hour: "bmo" | "amc" | "";  // before market open / after market close / unspecified
  epsEstimate: number | null;
}

export interface NewsHeadline {
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  datetime: string; // ISO
  url: string;
}

// Cached once a day by the daily snapshot job (src/lib/dailySnapshot.ts) -
// upcomingEarnings/news are read-only from the client's perspective; the
// "live" part of Morning Brief (today's big movers) is computed fresh on
// each request instead (see getMorningBriefAction) rather than stored here,
// since it would be stale within hours of being cached.
export interface MorningBriefData {
  generatedAt: string;               // ISO - when this was last refreshed
  upcomingEarnings: EarningsEntry[]; // only currently-held symbols, ~14 days out, sorted by date
  news: NewsHeadline[];               // top few held symbols by weight, most recent first
}

// What's actually persisted to disk: client-submitted portfolio data plus
// server-maintained fields (daily value history, alert acknowledgements).
export interface StoredPortfolioData extends PortfolioData {
  equityHistory: EquityPoint[];
  alertAcks: Record<string, AlertAck>;
  healthScoreAck?: HealthScoreAck;
  // ISO date the CASH position was first seen continuously over its own max
  // target; null while cash is within target. Set/cleared server-side (see
  // portfolio.ts and dailySnapshot.ts) so a long stretch with no user action
  // still correctly tracks how long cash has been sitting idle.
  cashIdleSince?: string | null;
  morningBrief?: MorningBriefData;
}

/** Net cash impact of a single trade (deposits/withdrawals move cash directly;
 * buys/sells move it by the trade value plus fee). Shared between the client
 * (live cash balance as trades are added/edited) and the server-side equity
 * history reconstruction (replaying the trade log to derive past cash balances). */
export function cashEffect(t: Trade | null | undefined): number {
  if (!t) return 0;
  if (t.action === "הפקדה") return t.value + (t.fee || 0);
  if (t.action === "משיכה") return -t.value + (t.fee || 0);
  if (t.action === "קנייה") return -t.value + (t.fee || 0);
  if (t.action === "מכירה") return t.value + (t.fee || 0);
  // "אחר" (other) is a catch-all for cash-positive entries that don't fit the
  // other categories (dividends, interest, adjustments) - the fee still
  // reduces cash the same way it does for every other action type.
  if (t.action === "אחר") return t.value + (t.fee || 0);
  return 0;
}
