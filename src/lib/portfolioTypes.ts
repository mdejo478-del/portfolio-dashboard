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

// What's actually persisted to disk: client-submitted portfolio data plus a
// server-maintained daily value history.
export interface StoredPortfolioData extends PortfolioData {
  equityHistory: EquityPoint[];
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
