// Pure, framework-agnostic health-score formula - shared between the client
// (InvestmentDashboard.tsx, recomputed live on every render) and the
// server-side daily snapshot job (dailySnapshot.ts, recomputed once a day
// from freshly-fetched prices so the score keeps moving even on days the
// user never opens the app). Zero Node-only imports, safe in either place.

import type { Tone, EvaluatedPosition, PortfolioHealthData } from "@/components/dashboard/types";

export function computePortfolioHealth(evaluated: EvaluatedPosition[]): PortfolioHealthData {
  const cashPos = evaluated.find((p) => p.symbol === "CASH");
  // HODL positions are exempt from rebalancing by design, so they're excluded
  // from the "in target range" measure the same way they're excluded from status.
  const rebalancable = evaluated.filter((p) => p.symbol !== "CASH" && !p.hodl);

  const inRangeCount = rebalancable.filter((p) => p.weight >= p.min && p.weight <= p.max).length;
  const rangeRatio = rebalancable.length > 0 ? inRangeCount / rebalancable.length : 1;

  const cashDev = cashPos ? cashPos.dev : 0;
  const cashHealth = cashPos ? Math.max(0, 1 - Math.abs(cashDev) / 0.15) : 1;

  const diluteBreaches = rebalancable.filter((p) => p.status === "חריגה - דילול נדרש");
  const overBreaches = rebalancable.filter((p) => p.status === "מעל היעד");
  const weightBreaches = [...diluteBreaches, ...overBreaches];
  const needsStrengthen = rebalancable.filter((p) => p.status === "דורש חיזוק");

  // Scales with how many breaches there are (and how severe), not just whether
  // any exist at all - a portfolio with several breaches scores meaningfully
  // lower than one with a single, isolated breach.
  const breachPenalty = diluteBreaches.length * 12 + overBreaches.length * 6;
  const breachScore = Math.max(0, 20 - breachPenalty);
  const score = Math.max(0, Math.min(100, Math.round(rangeRatio * 60 + cashHealth * 20 + breachScore)));

  const diversification: "טוב" | "בינוני" | "חלש" =
    rangeRatio >= 0.8 ? "טוב" : rangeRatio >= 0.5 ? "בינוני" : "חלש";

  const risk: "תקין" | "גבוה" | "נמוך" =
    diluteBreaches.length > 0 ? "גבוה" : (cashPos && cashDev > 0.05) ? "נמוך" : "תקין";

  const tone: Tone = score >= 75 ? "green" : score >= 50 ? "amber" : "red";
  const cashTone: Tone = !cashPos ? "blue" : cashDev === 0 ? "green" : "amber";

  return { score, tone, diversification, risk, cashPct: cashPos ? cashPos.weight : 0, cashTone, needsStrengthen, weightBreaches, rangeRatio, cashHealth, breachScore };
}
