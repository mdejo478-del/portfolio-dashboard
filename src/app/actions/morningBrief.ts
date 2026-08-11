"use server";

import { verifySession } from "@/lib/dal";
import { getPortfolio, type EarningsEntry, type NewsHeadline } from "@/lib/portfolio";
import { getQuotes } from "@/lib/prices";

// Intentionally separate from alertRules.ts's dailyDropThreshold (-5%,
// down-only, meant as an urgent push-style warning): Morning Brief's "big
// movers" is a passive daily digest, both directions, a looser 4% - not the
// same mechanism, just reusing the same live day-change % data.
const BIG_MOVER_THRESHOLD = 0.04;

export interface BigMover {
  symbol: string;
  changePct: number;
}

export interface MorningBriefResult {
  // From the daily-cached data (src/lib/dailySnapshot.ts) - null if the
  // daily job hasn't run for this account yet (e.g. brand new signup).
  generatedAt: string | null;
  fetchedAt: string;
  upcomingEarnings: EarningsEntry[];
  news: NewsHeadline[];
  bigMovers: BigMover[];
}

export async function getMorningBriefAction(): Promise<MorningBriefResult> {
  const session = await verifySession();
  const portfolio = await getPortfolio(session.userId);

  const symbols = portfolio.positions.filter((p) => p.symbol !== "CASH" && p.qty !== null).map((p) => p.symbol);
  const quotes = symbols.length > 0 ? await getQuotes(symbols) : { configured: true, prices: {}, dayChangePct: {}, extended: {} };

  const bigMovers: BigMover[] = [];
  for (const symbol of symbols) {
    const changePct = quotes.dayChangePct[symbol];
    if (changePct != null && Math.abs(changePct) >= BIG_MOVER_THRESHOLD) {
      bigMovers.push({ symbol, changePct });
    }
  }
  bigMovers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  return {
    generatedAt: portfolio.morningBrief?.generatedAt ?? null,
    fetchedAt: new Date().toISOString(),
    upcomingEarnings: portfolio.morningBrief?.upcomingEarnings ?? [],
    news: portfolio.morningBrief?.news ?? [],
    bigMovers,
  };
}
