"use server";

import { verifySession } from "@/lib/dal";
import { getQuotes, getStockDetail, type QuotesResult, type StockDetail } from "@/lib/prices";

const SYMBOL_RE = /^[A-Za-z0-9:_.-]{1,20}$/;
const MAX_SYMBOLS_PER_REQUEST = 50;

export async function getPricesAction(symbols: unknown): Promise<QuotesResult> {
  await verifySession();
  if (!Array.isArray(symbols)) return { configured: false, prices: {}, dayChangePct: {}, extended: {}, quotes: {} };
  const valid = symbols.filter((s): s is string => typeof s === "string" && SYMBOL_RE.test(s));
  // The cap only bounds the work of a single request; the client sends larger
  // portfolios in several batches (see fetchQuotesInBatches). Symbols beyond it
  // are reported back as "no price" instead of being cut off without a word.
  const accepted = valid.slice(0, MAX_SYMBOLS_PER_REQUEST);
  const result = await getQuotes(accepted);
  for (const symbol of valid.slice(MAX_SYMBOLS_PER_REQUEST)) {
    result.quotes[symbol] = { price: null, source: null, session: "regular", regularPrice: null, fetchedAt: null, failure: "over-limit" };
  }
  return result;
}

export async function getStockDetailAction(symbol: unknown): Promise<StockDetail> {
  await verifySession();
  if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) {
    throw new Error("סימול לא תקין.");
  }
  return getStockDetail(symbol);
}
