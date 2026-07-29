"use server";

import { verifySession } from "@/lib/dal";
import { getQuotes, getStockDetail, type QuotesResult, type StockDetail } from "@/lib/prices";

export async function getPricesAction(symbols: string[]): Promise<QuotesResult> {
  await verifySession();
  return getQuotes(symbols);
}

export async function getStockDetailAction(symbol: string): Promise<StockDetail> {
  await verifySession();
  return getStockDetail(symbol);
}
