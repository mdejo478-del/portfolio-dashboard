const FINNHUB_BASE = "https://finnhub.io/api/v1";

// Finnhub uses exchange-prefixed symbols for crypto (its free-tier stock
// quote endpoint doesn't accept plain "ETH"). Extend this map if more
// crypto/alternate-symbol positions are added.
const SYMBOL_OVERRIDES: Record<string, string> = {
  ETH: "BINANCE:ETHUSDT",
};

export interface QuotesResult {
  configured: boolean;
  prices: Record<string, number | null>;
}

async function fetchQuote(symbol: string, apiKey: string): Promise<number | null> {
  const finnhubSymbol = SYMBOL_OVERRIDES[symbol] || symbol;
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { c?: number };
    if (typeof data.c !== "number" || data.c <= 0) return null;
    return data.c;
  } catch {
    return null;
  }
}

export async function getQuotes(symbols: string[]): Promise<QuotesResult> {
  // To switch to Twelve Data instead: swap this key + fetchQuote's URL/response
  // shape for https://api.twelvedata.com/price?symbol=...&apikey=...
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return { configured: false, prices: {} };
  }

  const uniqueSymbols = Array.from(new Set(symbols));
  const entries = await Promise.all(
    uniqueSymbols.map(async (symbol) => [symbol, await fetchQuote(symbol, apiKey)] as const)
  );
  return { configured: true, prices: Object.fromEntries(entries) };
}
