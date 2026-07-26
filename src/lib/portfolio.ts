import { getSupabaseClient } from "@/lib/supabaseClient";

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

interface PortfolioRow {
  user_id: string;
  positions: Position[] | null;
  trades: Trade[] | null;
  ledger: Ledger | null;
  next_position_id: number | null;
  next_trade_id: number | null;
}

function emptyPortfolio(): PortfolioData {
  return { positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0 };
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  const { data, error } = await getSupabaseClient()
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return emptyPortfolio();

  const row = data as PortfolioRow;
  return {
    positions: row.positions ?? [],
    trades: row.trades ?? [],
    ledger: row.ledger ?? {},
    nextPositionId: row.next_position_id ?? 0,
    nextTradeId: row.next_trade_id ?? 0,
  };
}

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  const supabase = getSupabaseClient();
  const payload = {
    positions: data.positions,
    trades: data.trades,
    ledger: data.ledger,
    next_position_id: data.nextPositionId,
    next_trade_id: data.nextTradeId,
    updated_at: new Date().toISOString(),
  };

  // Avoid relying on a DB-level unique constraint on user_id (upsert's
  // ON CONFLICT needs one and the live table may not have it) - update first,
  // insert only if no row existed yet.
  const { data: updated, error: updateError } = await supabase
    .from("portfolios")
    .update(payload)
    .eq("user_id", userId)
    .select("user_id");
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase
      .from("portfolios")
      .insert({ user_id: userId, ...payload });
    if (insertError) throw insertError;
  }
}
