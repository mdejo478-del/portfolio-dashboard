"use server";

import { verifySession } from "@/lib/dal";
import { getHighs52, type HighReading } from "@/lib/watchlistData";

const MAX_SYMBOLS = 200;

/** The 52-week high of each watched symbol, from a cache shared by all users. Never throws: a symbol
 * with no data comes back as "missing" and the list shows "—" for it. Symbols beyond the cap are
 * returned as missing too, not dropped without a word. */
export async function getWatchlistHighsAction(symbols: unknown): Promise<Record<string, HighReading>> {
  await verifySession();
  if (!Array.isArray(symbols)) return {};
  const clean = symbols.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 20);
  const accepted = clean.slice(0, MAX_SYMBOLS);
  try {
    const out = await getHighs52(accepted);
    for (const extra of clean.slice(MAX_SYMBOLS)) out[extra.trim().toUpperCase()] = { high52: null, fetchedAt: null, asOf: null, status: "missing" };
    return out;
  } catch (err) {
    console.error("[watchlist] highs failed:", err);
    return Object.fromEntries(clean.map((s) => [s.trim().toUpperCase(), { high52: null, fetchedAt: null, asOf: null, status: "missing" as const }]));
  }
}
