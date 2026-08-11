"use server";

import { verifySession, requireSession } from "@/lib/dal";
import { getPortfolio, savePortfolio, saveEquityHistory, isValidPortfolioData, isValidAckPayload, updateAlertAcks, type EquityPoint } from "@/lib/portfolio";
import { rebuildEquityHistory } from "@/lib/equityHistory";
import { checkRateLimit, rateLimitMessage } from "@/lib/rateLimit";
import { maybeRunBackup, runBackupNow } from "@/lib/backup";

export async function savePortfolioAction(data: unknown): Promise<void> {
  // requireSession (not verifySession) because this is called from autosave's
  // own try/catch, not a form submission - see the comment on requireSession.
  const session = await requireSession();
  if (!isValidPortfolioData(data)) {
    throw new Error("נתוני התיק שהתקבלו אינם תקינים.");
  }
  await savePortfolio(session.userId, data);
  try {
    // Best-effort: a backup hiccup should never turn a successful save into a
    // client-visible failure. Cheap no-op unless a backup is actually due.
    await maybeRunBackup();
  } catch (err) {
    console.error("[backup] post-save check failed:", err);
  }
}

// Fire-and-forget from the client (bell opened or an alert dismissed) - not
// critical if a single call is lost (the alert just reappears once more than
// it strictly needed to), so requireSession rather than a hard-failing
// verifySession keeps a transient auth hiccup from surfacing as an error.
export async function ackAlertsAction(payload: unknown): Promise<void> {
  const session = await requireSession();
  if (!isValidAckPayload(payload)) {
    throw new Error("נתוני אישור התראה אינם תקינים.");
  }
  await updateAlertAcks(session.userId, payload.acks, payload.healthScoreAck);
}

export async function backupNowAction(): Promise<{ createdAt: number }> {
  const session = await requireSession();
  // A manual click firing rapid, repeated full snapshots is the one thing the
  // "keep only the last 14" rotation can't protect against - throttle it too.
  const limit = checkRateLimit("backup-now:" + session.userId, 3, 5 * 60 * 1000);
  if (!limit.allowed) throw new Error(rateLimitMessage(limit.retryAfterSeconds));
  await runBackupNow();
  return { createdAt: Date.now() };
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
