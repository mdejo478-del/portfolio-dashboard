"use server";

import { verifySession } from "@/lib/dal";
import { getQuotes, type QuotesResult } from "@/lib/prices";

export async function getPricesAction(symbols: string[]): Promise<QuotesResult> {
  await verifySession();
  return getQuotes(symbols);
}
