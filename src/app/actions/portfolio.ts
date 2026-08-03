"use server";

import { verifySession, requireSession } from "@/lib/dal";
import { getPortfolio, savePortfolio, saveEquityHistory, isValidPortfolioData, type EquityPoint } from "@/lib/portfolio";
import { rebuildEquityHistory } from "@/lib/equityHistory";
import { checkRateLimit, rateLimitMessage } from "@/lib/rateLimit";

export async function savePortfolioAction(data: unknown): Promise<void> {
  // requireSession (not verifySession) because this is called from autosave's
  // own try/catch, not a form submission - see the comment on requireSession.
  const session = await requireSession();
  if (!isValidPortfolioData(data)) {
    throw new Error("נתוני התיק שהתקבלו אינם תקינים.");
  }
  await savePortfolio(session.userId, data);
}

export interface RebuildEquityHistoryResult {
  history: EquityPoint[];
  warnings: string[];
}

export async function rebuildEquityHistoryAction(): Promise<RebuildEquityHistoryResult> {
  const session = await verifySession();
  // Fetches historical prices for every traded symbol from a free external
  // API - cheap to call once, but worth a light limit against accidental
  // rapid double-clicks/retries hammering it.
  const limit = checkRateLimit("rebuild-equity:" + session.userId, 3, 10 * 60 * 1000);
  if (!limit.allowed) throw new Error(rateLimitMessage(limit.retryAfterSeconds));

  const portfolio = await getPortfolio(session.userId);
  const { history, warnings } = await rebuildEquityHistory(portfolio.trades, portfolio.positions);
  await saveEquityHistory(session.userId, history);
  return { history, warnings };
}
