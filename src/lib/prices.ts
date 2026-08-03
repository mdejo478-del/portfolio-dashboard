const FINNHUB_BASE = "https://finnhub.io/api/v1";

// Finnhub's free tier can stall instead of failing fast on endpoints it
// doesn't grant access to (e.g. stock/candle) - bound every external call
// so one slow provider can't hang the whole request.
const FETCH_TIMEOUT_MS = 6000;

// Finnhub uses exchange-prefixed symbols for crypto (its free-tier stock
// quote endpoint doesn't accept plain "ETH"). Extend this map if more
// crypto/alternate-symbol positions are added.
const SYMBOL_OVERRIDES: Record<string, string> = {
  ETH: "BINANCE:ETHUSDT",
};

export type MarketSession = "pre" | "post";

export interface ExtendedQuote {
  price: number;
  session: MarketSession;
  change: number | null;
  changePct: number | null;
}

export interface QuotesResult {
  configured: boolean;
  prices: Record<string, number | null>;
  // Only populated for symbols currently trading pre-market or after-hours -
  // during the regular session (or when the market's fully closed) this is
  // null, since Finnhub's quote above already covers the regular price.
  extended: Record<string, ExtendedQuote | null>;
}

async function fetchQuote(symbol: string, apiKey: string): Promise<number | null> {
  const finnhubSymbol = SYMBOL_OVERRIDES[symbol] || symbol;
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { c?: number };
    if (typeof data.c !== "number" || data.c <= 0) return null;
    return data.c;
  } catch {
    return null;
  }
}

interface YahooTradingPeriod { start?: number; end?: number }
interface YahooExtendedChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        currentTradingPeriod?: { pre?: YahooTradingPeriod; regular?: YahooTradingPeriod; post?: YahooTradingPeriod };
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

// Finnhub's free tier doesn't cover pre-market/after-hours trades, so this
// pulls the latest tick from Yahoo's free, unauthenticated minute-bar chart
// (same source already used as the historical-candle fallback) and only
// surfaces it when that tick actually falls inside the pre or post window -
// during the regular session this returns null and the Finnhub quote wins.
async function fetchExtendedHoursQuote(symbol: string): Promise<ExtendedQuote | null> {
  const yahooSymbol = YAHOO_SYMBOL_OVERRIDES[symbol] || symbol;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=true`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as YahooExtendedChartResponse;
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!meta || !timestamps || !closes || timestamps.length === 0) return null;

    let lastIdx = -1;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (typeof closes[i] === "number") { lastIdx = i; break; }
    }
    if (lastIdx === -1) return null;
    const lastTs = timestamps[lastIdx];
    const lastPrice = closes[lastIdx] as number;

    const inWindow = (p?: YahooTradingPeriod) =>
      Boolean(p && typeof p.start === "number" && typeof p.end === "number" && lastTs >= p.start && lastTs < p.end);
    const periods = meta.currentTradingPeriod;
    const session: MarketSession | null = inWindow(periods?.pre) ? "pre" : inWindow(periods?.post) ? "post" : null;
    if (!session) return null;

    // meta.regularMarketPrice tracks the last *regular-session* close until the
    // next regular session updates it - exactly the right base for both the
    // pre-market change (vs. yesterday's close) and the after-hours change
    // (vs. today's close).
    const base = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice
      : typeof meta.previousClose === "number" ? meta.previousClose : null;
    const change = base !== null ? lastPrice - base : null;
    const changePct = base !== null && base > 0 && change !== null ? change / base : null;

    return { price: lastPrice, session, change, changePct };
  } catch {
    return null;
  }
}

export async function getQuotes(symbols: string[]): Promise<QuotesResult> {
  // To switch to Twelve Data instead: swap this key + fetchQuote's URL/response
  // shape for https://api.twelvedata.com/price?symbol=...&apikey=...
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return { configured: false, prices: {}, extended: {} };
  }

  const uniqueSymbols = Array.from(new Set(symbols));
  const [priceEntries, extendedEntries] = await Promise.all([
    Promise.all(uniqueSymbols.map(async (symbol) => [symbol, await fetchQuote(symbol, apiKey)] as const)),
    Promise.all(uniqueSymbols.map(async (symbol) => [symbol, await fetchExtendedHoursQuote(symbol)] as const)),
  ]);
  return {
    configured: true,
    prices: Object.fromEntries(priceEntries),
    extended: Object.fromEntries(extendedEntries),
  };
}

const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  ETH: "Ethereum",
  CASH: "מזומן",
};

const RETURN_PERIOD_DAYS = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
} as const;

export interface StockReturns {
  "1D": number | null;
  "1W": number | null;
  "1M": number | null;
  "3M": number | null;
  YTD: number | null;
  "1Y": number | null;
}

export interface StockDetail {
  configured: boolean;
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  previousClose: number | null;
  returns: StockReturns;
  historicalAvailable: boolean;
  extended: ExtendedQuote | null;
}

interface FinnhubQuote { c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number }
interface FinnhubCandle { c?: number[]; t?: number[]; s?: string; error?: string }
interface FinnhubProfile { name?: string }
export interface DailyCloses { t: number[]; c: number[] }

export function closestCloseBefore(candle: DailyCloses, targetTs: number): number | null {
  const t = candle.t;
  const c = candle.c;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] <= targetTs) return c[i];
  }
  return null;
}

// Finnhub's candle endpoints (stock + crypto) are restricted on the free tier
// ("You don't have access to this resource."). Try them anyway in case the
// plan changes, then fall back to Yahoo Finance's unauthenticated chart API,
// which is free and covers both stocks and crypto (via the "-USD" suffix).
async function fetchFinnhubCandle(finnhubSymbol: string, isCrypto: boolean, apiKey: string, fromSec: number, toSec: number): Promise<DailyCloses | null> {
  const candleEndpoint = isCrypto ? "crypto/candle" : "stock/candle";
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/${candleEndpoint}?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=D&from=${fromSec}&to=${toSec}&token=${apiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as FinnhubCandle;
    if (data.error || data.s !== "ok" || !data.t || !data.c || data.t.length === 0) return null;
    return { t: data.t, c: data.c };
  } catch {
    return null;
  }
}

const YAHOO_SYMBOL_OVERRIDES: Record<string, string> = { ETH: "ETH-USD" };

interface YahooChartResponse {
  chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
}

function parseYahooChartResponse(data: YahooChartResponse): DailyCloses | null {
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!timestamps || !closes || timestamps.length === 0) return null;
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close === "number") { t.push(timestamps[i]); c.push(close); }
  }
  return t.length > 0 ? { t, c } : null;
}

async function fetchYahooCandle(symbol: string): Promise<DailyCloses | null> {
  const yahooSymbol = YAHOO_SYMBOL_OVERRIDES[symbol] || symbol;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2y&interval=1d`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    return parseYahooChartResponse(await res.json());
  } catch {
    return null;
  }
}

// Same source as fetchYahooCandle, but with an explicit date range (period1/period2)
// instead of a relative "range" window - lets us reconstruct history as far back as a
// portfolio's earliest trade, even if that's older than the 2y window above.
export async function fetchYahooDailyClosesInRange(symbol: string, fromSec: number, toSec: number): Promise<DailyCloses | null> {
  const yahooSymbol = YAHOO_SYMBOL_OVERRIDES[symbol] || symbol;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${fromSec}&period2=${toSec}&interval=1d`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    return parseYahooChartResponse(await res.json());
  } catch {
    return null;
  }
}

export async function getStockDetail(symbol: string): Promise<StockDetail> {
  const empty: StockReturns = { "1D": null, "1W": null, "1M": null, "3M": null, YTD: null, "1Y": null };
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return {
      configured: false, symbol, name: COMPANY_NAME_OVERRIDES[symbol] || null,
      price: null, change: null, changePct: null, high: null, low: null, open: null,
      previousClose: null, returns: empty, historicalAvailable: false, extended: null,
    };
  }

  const finnhubSymbol = SYMBOL_OVERRIDES[symbol] || symbol;
  const isCrypto = Boolean(SYMBOL_OVERRIDES[symbol]);
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 400 * 24 * 3600;

  // Finnhub's candle endpoints are blocked on the free plan for this key, so
  // Yahoo (the fallback) is run in parallel with it rather than after it -
  // otherwise a slow Finnhub timeout and a slow Yahoo request add up instead
  // of overlapping.
  const [quoteRes, finnhubCandle, yahooCandle, profileRes, extended] = await Promise.all([
    fetch(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then((r) => (r.ok ? (r.json() as Promise<FinnhubQuote>) : null)).catch(() => null),
    fetchFinnhubCandle(finnhubSymbol, isCrypto, apiKey, fromSec, nowSec),
    fetchYahooCandle(symbol),
    isCrypto ? Promise.resolve(null) : fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then((r) => (r.ok ? (r.json() as Promise<FinnhubProfile>) : null)).catch(() => null),
    isCrypto ? Promise.resolve(null) : fetchExtendedHoursQuote(symbol),
  ]);

  const candleRes = finnhubCandle || yahooCandle;

  const price = typeof quoteRes?.c === "number" && quoteRes.c > 0 ? quoteRes.c : null;
  const change = typeof quoteRes?.d === "number" ? quoteRes.d : null;
  const changePct = typeof quoteRes?.dp === "number" ? quoteRes.dp / 100 : null;

  const historicalAvailable = Boolean(candleRes && candleRes.t.length > 0);
  const returns: StockReturns = { ...empty, "1D": changePct };
  if (historicalAvailable && price !== null && candleRes) {
    for (const period of Object.keys(RETURN_PERIOD_DAYS) as (keyof typeof RETURN_PERIOD_DAYS)[]) {
      const targetTs = nowSec - RETURN_PERIOD_DAYS[period] * 24 * 3600;
      const base = closestCloseBefore(candleRes, targetTs);
      returns[period] = base && base > 0 ? (price - base) / base : null;
    }
    const jan1 = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
    const ytdBase = closestCloseBefore(candleRes, jan1);
    returns.YTD = ytdBase && ytdBase > 0 ? (price - ytdBase) / ytdBase : null;
  }

  const name = (profileRes && profileRes.name) || COMPANY_NAME_OVERRIDES[symbol] || null;

  return {
    configured: true, symbol, name, price, change, changePct,
    high: typeof quoteRes?.h === "number" ? quoteRes.h : null,
    low: typeof quoteRes?.l === "number" ? quoteRes.l : null,
    open: typeof quoteRes?.o === "number" ? quoteRes.o : null,
    previousClose: typeof quoteRes?.pc === "number" ? quoteRes.pc : null,
    returns, historicalAvailable, extended,
  };
}
