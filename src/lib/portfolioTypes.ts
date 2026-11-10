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
  // Optional manually-entered average purchase price per unit ($). Drives the
  // per-position return shown in the holdings table (see positionReturn
  // below). Deliberately NOT derived from the trade-journal ledger: the
  // ledger is built incrementally from the trade log and can drift from
  // reality, so a return computed from it could silently mislead. Absent /
  // null / non-positive = "not set", and the position simply shows no
  // return - every other behavior is unchanged.
  avgCost?: number | null;
}
export interface Position extends RawPosition {
  id: number;
}

export interface PositionReturn {
  /** (price - avgCost) / avgCost, as a fraction (0.12 = +12%). */
  pct: number;
  /** (price - avgCost) * qty in dollars; null when the quantity is unknown. */
  pnl: number | null;
}

/** Unrealized return on a position from its manually-entered average cost.
 * Returns null whenever it can't be computed honestly - no/invalid average
 * cost, no live price, or the CASH row - so callers show "not set" instead
 * of a made-up number. */
export function positionReturn(p: { symbol: string; price: number | null; qty: number | null; avgCost?: number | null }): PositionReturn | null {
  if (p.symbol === "CASH") return null;
  const avg = p.avgCost;
  if (typeof avg !== "number" || !Number.isFinite(avg) || avg <= 0) return null;
  if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price <= 0) return null;
  const pnl = typeof p.qty === "number" && Number.isFinite(p.qty) ? (p.price - avg) * p.qty : null;
  return { pct: (p.price - avg) / avg, pnl };
}

/** Portfolio-level roll-up over only the positions that have an average cost
 * set - an unweighted average of percentages would be wrong, so this is total
 * P&L over total cost basis. `covered`/`eligible` let the UI say how much of
 * the portfolio the figure actually represents. */
export function totalPositionReturn(positions: Array<{ symbol: string; price: number | null; qty: number | null; avgCost?: number | null }>): { pct: number; pnl: number; covered: number; eligible: number } | null {
  let pnl = 0, cost = 0, covered = 0, eligible = 0;
  for (const p of positions) {
    if (p.symbol === "CASH") continue;
    eligible++;
    const r = positionReturn(p);
    if (!r || r.pnl === null || typeof p.qty !== "number" || p.qty <= 0) continue;
    pnl += r.pnl;
    cost += (p.avgCost as number) * p.qty;
    covered++;
  }
  return covered > 0 && cost > 0 ? { pct: pnl / cost, pnl, covered, eligible } : null;
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

// How far apart a new position's min/max/dilute default to, relative to its
// equal-weight target - set once via the onboarding questionnaire (or later
// in settings), not per-position. "medium" reproduces the app's original
// flat 5%/15%/20% default exactly when the target is ~10% (0.5x/1.5x/2.0x),
// so a user who never answers the questionnaire sees unchanged behavior.
export type RangeWidthPreference = "narrow" | "medium" | "wide";

const RANGE_WIDTH_MULTIPLIERS: Record<RangeWidthPreference, { min: number; max: number; dilute: number }> = {
  narrow: { min: 0.7, max: 1.3, dilute: 1.6 },
  medium: { min: 0.5, max: 1.5, dilute: 2.0 },
  wide: { min: 0.3, max: 1.8, dilute: 2.5 },
};

/** Suggested min/max/dilute (as weight fractions) for a new position aiming
 * for `targetWeight`, shaped by the user's range-width preference. Multiplied
 * off the target rather than offset by fixed percentage points, so the
 * suggestion stays proportionally sensible whether the target is 5% or 40%. */
export function suggestedPositionRange(targetWeight: number, pref: RangeWidthPreference): { min: number; max: number; dilute: number } {
  const m = RANGE_WIDTH_MULTIPLIERS[pref];
  const min = Math.max(0.005, Math.min(1, targetWeight * m.min));
  const max = Math.max(min, Math.min(1, targetWeight * m.max));
  const dilute = Math.max(max, Math.min(1, targetWeight * m.dilute));
  return { min, max, dilute };
}

/** Target weight for a new (non-CASH) position so that, together with the
 * existing ones, every position would sit at an equal share. */
export function equalWeightTarget(existingNonCashPositionCount: number): number {
  return 1 / (existingNonCashPositionCount + 1);
}

export type RiskTolerance = "low" | "medium" | "high";
export type ConcentrationPreference = "diversified" | "focused";

// Risk sets a base width tier (low->narrow, medium->medium, high->wide);
// concentration preference nudges it one tier wider (focused) or narrower
// (diversified), clamped at the ends. Deliberately not a straight lookup
// table - this keeps both answers meaningfully affecting the result (a
// "focused" investor who says "low risk" still ends up one tier wider than
// a "diversified" one who says the same) without needing a 3x2 table nobody
// can eyeball for consistency.
const WIDTH_TIERS: RangeWidthPreference[] = ["narrow", "medium", "wide"];
const RISK_BASE_TIER: Record<RiskTolerance, number> = { low: 0, medium: 1, high: 2 };

export function deriveRangeWidthPreference(risk: RiskTolerance, concentration: ConcentrationPreference): RangeWidthPreference {
  let tier = RISK_BASE_TIER[risk] + (concentration === "focused" ? 1 : -1);
  tier = Math.max(0, Math.min(WIDTH_TIERS.length - 1, tier));
  return WIDTH_TIERS[tier];
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
  // The recorded history as it was right before the last "rebuild from trade
  // journal" replaced it - kept so that rebuild can always be undone.
  equityHistoryBeforeRebuild?: EquityPoint[];
  alertAcks: Record<string, AlertAck>;
  healthScoreAck?: HealthScoreAck;
  // ISO date the CASH position was first seen continuously over its own max
  // target; null while cash is within target. Set/cleared server-side (see
  // portfolio.ts and dailySnapshot.ts) so a long stretch with no user action
  // still correctly tracks how long cash has been sitting idle.
  cashIdleSince?: string | null;
  morningBrief?: MorningBriefData;
  // Set once via the onboarding questionnaire (or later in settings) -
  // absent for users who skipped it or predate the feature, in which case
  // callers should treat it as "medium" (see suggestedPositionRange above).
  rangeWidthPreference?: RangeWidthPreference;
  // Optimistic-concurrency counter for the client-submitted part of the
  // portfolio (positions/trades/ledger/ids). Bumped by every successful
  // savePortfolio; a save must name the revision it was based on, and is
  // refused if the file has moved on since - so a stale tab or a second
  // device can never silently overwrite newer edits made elsewhere.
  // Server-maintained fields (alert acks, daily snapshot, equity history,
  // range preference) deliberately do NOT bump it: they never touch the
  // data a client submits, so they must not make an open tab look stale.
  // Absent in files written before this existed = revision 0.
  revision?: number;
}

/** Outcome of a client save attempt - returned rather than thrown so the
 * client can reliably tell a concurrency conflict apart from a real error
 * (thrown server-action error messages aren't a dependable channel). */
export type SavePortfolioResult =
  | { ok: true; revision: number }
  | { ok: false; reason: "conflict"; currentRevision: number };

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
