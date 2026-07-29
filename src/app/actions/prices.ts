"use server";

import { verifySession } from "@/lib/dal";
import { getQuotes, getStockDetail, type QuotesResult, type StockDetail } from "@/lib/prices";

const SYMBOL_RE = /^[A-Za-z0-9:_.-]{1,20}$/;
const MAX_SYMBOLS_PER_REQUEST = 50;

export async function getPricesAction(symbols: unknown): Promise<QuotesResult> {
  await verifySession();
  if (!Array.isArray(symbols)) return { configured: false, prices: {} };
  const clean = symbols
    .filter((s): s is string => typeof s === "string" && SYMBOL_RE.test(s))
    .slice(0, MAX_SYMBOLS_PER_REQUEST);
  return getQuotes(clean);
}

export async function getStockDetailAction(symbol: unknown): Promise<StockDetail> {
  await verifySession();
  if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) {
    throw new Error("סימול לא תקין.");
  }
  return getStockDetail(symbol);
}
