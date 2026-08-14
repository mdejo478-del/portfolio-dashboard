"use server";

import { verifySession } from "@/lib/dal";
import { getPortfolio, type EarningsEntry, type NewsHeadline } from "@/lib/portfolio";

export interface MorningBriefResult {
  // From the daily-cached data (src/lib/dailySnapshot.ts) - null if the
  // daily job hasn't run for this account yet (e.g. brand new signup).
  generatedAt: string | null;
  fetchedAt: string;
  upcomingEarnings: EarningsEntry[];
  news: NewsHeadline[];
}

// bigMovers is deliberately NOT computed here: it needs the same live
// day-change % the dashboard's own price-refresh cycle already fetches
// (see refreshPrices in InvestmentDashboard.tsx). Issuing a second getQuotes()
// call here would hit the price API twice for the same symbols on every load
// - instead, InvestmentDashboard derives it client-side via
// computeBigMovers() in morningBriefUtils.ts, from state this action doesn't
// have direct access to anyway.
export async function getMorningBriefAction(): Promise<MorningBriefResult> {
  const session = await verifySession();
  const portfolio = await getPortfolio(session.userId);

  return {
    generatedAt: portfolio.morningBrief?.generatedAt ?? null,
    fetchedAt: new Date().toISOString(),
    upcomingEarnings: portfolio.morningBrief?.upcomingEarnings ?? [],
    news: portfolio.morningBrief?.news ?? [],
  };
}
