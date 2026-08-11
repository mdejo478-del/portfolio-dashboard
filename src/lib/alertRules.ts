// Thresholds and "has this materially changed since the user last saw it"
// helpers for the persisted alert system (see AlertAck/HealthScoreAck in
// portfolioTypes.ts). Pure, no framework/Node imports - shared between the
// client (InvestmentDashboard.tsx builds the live alert list) and, for the
// ATH/cash-idle pieces, the daily snapshot job.
//
// All thresholds below are deliberately plain exported constants, not
// buried in logic - tune them here without touching call sites.

import type { AlertAck } from "@/lib/portfolioTypes";

export const ALERT_RULES = {
  /** #2 weight deviation: re-alert once |dev| has moved this many
   * percentage points further from where it was last acknowledged. */
  devRearmStep: 0.02,
  /** #3 ATH drawdown: fires once the portfolio is down this much from its
   * all-time high... */
  athAlertDrawdown: -0.10,
  /** ...and clears once it recovers to within this much of the ATH again
   * (a small hysteresis band so it doesn't flicker right at -10%). */
  athClearDrawdown: -0.03,
  /** ...then re-alerts if the drawdown worsens by this many more points
   * after being acknowledged, without needing to fully recover first. */
  athRearmStep: 0.05,
  /** #4 idle cash: cash must sit above its own `max` target continuously
   * for this many days before it's worth surfacing. */
  cashIdleDays: 7,
  /** #5 health score: re-alert once the score has moved this many points
   * (either direction) from the last acknowledged score. */
  healthScoreRearmStep: 10,
  /** #6 single-day drop: Finnhub's live day-change %, as a fraction. */
  dailyDropThreshold: -0.05,
} as const;

/** Generic "materially changed since ack" check for magnitude-based alerts
 * (#2 deviation, #3 drawdown, #5 health score) - true when there's no ack
 * yet (never seen) or the live value has moved at least `step` away from
 * the acknowledged one, in either direction. */
export function isNewOccurrence(currentValue: number, ack: AlertAck | undefined, step: number): boolean {
  if (!ack) return true;
  return Math.abs(currentValue - ack.value) >= step;
}

/** #1 price target: which side of the target the live price is currently
 * on. Stored as the ack's `value` (1 or -1) so re-crossing in either
 * direction - not just "still above/below" - counts as a fresh occurrence. */
export function priceTargetSide(price: number, target: number): 1 | -1 {
  return price >= target ? 1 : -1;
}

export function isPriceTargetNewOccurrence(currentSide: 1 | -1, ack: AlertAck | undefined): boolean {
  if (!ack) return true;
  return ack.value !== currentSide;
}
