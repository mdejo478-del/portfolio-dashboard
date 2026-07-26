import { promises as fs } from "fs";
import path from "path";

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

const DATA_DIR = path.join(process.cwd(), "data", "portfolios");

function portfolioFile(userId: string): string {
  return path.join(DATA_DIR, `${userId}.json`);
}

function emptyPortfolio(): PortfolioData {
  return { positions: [], trades: [], ledger: {}, nextPositionId: 0, nextTradeId: 0 };
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  try {
    const raw = await fs.readFile(portfolioFile(userId), "utf-8");
    return JSON.parse(raw) as PortfolioData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyPortfolio();
    throw err;
  }
}

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(portfolioFile(userId), JSON.stringify(data, null, 2), "utf-8");
}
