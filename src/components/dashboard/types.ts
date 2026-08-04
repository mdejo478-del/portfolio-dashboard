import type { Position, Trade, Ledger } from "@/lib/portfolio";

export type Tone = "green" | "amber" | "red" | "blue";

export interface PositionEval {
  status: string;
  tone: Tone;
  priority: string;
  action: string;
  weight: number;
  dev: number;
}
export type EvaluatedPosition = Position & PositionEval;

export interface Alert {
  id: string;
  tone: Tone;
  title: string;
  message: string;
}

export interface TradeFormState {
  date: string;
  symbol: string;
  action: string;
  qty: string;
  price: string;
  fee: string;
  strategy: string;
  notes: string;
  pnlManual: string;
}
export interface PositionFormState {
  symbol: string;
  qty: string;
  price: string;
}
export interface PosEditFields {
  qty: string;
  min: string;
  max: string;
  dilute: string;
}
export interface UndoSnapshot {
  label: string;
  positions: Position[];
  trades: Trade[];
  ledger: Ledger;
  nextPositionId: number;
  nextTradeId: number;
}

export interface PortfolioHealthData {
  score: number;
  tone: Tone;
  diversification: "טוב" | "בינוני" | "חלש";
  risk: "תקין" | "גבוה" | "נמוך";
  cashPct: number;
  cashTone: Tone;
  needsStrengthen: EvaluatedPosition[];
  weightBreaches: EvaluatedPosition[];
}
