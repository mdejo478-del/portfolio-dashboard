// Portfolio performance math that is NOT fooled by deposits and withdrawals.
// Pure and framework-agnostic (type-only imports, no Node APIs) so it runs in
// the browser bundle, on the server and directly under the test runner.
//
// Why this exists: the equity curve stores raw account value per day. Raw
// value rises when money is deposited and falls when it is withdrawn, so
// "(value now - first value) / first value" counted a deposit as profit and a
// withdrawal as a loss - and a withdrawal could fire the "big drop from the
// all-time high" alert with the market flat. Time-weighted return (TWR)
// removes the cash flows and measures only how the investments performed.

import type { EquityPoint, Trade } from "./portfolioTypes";

export const DEPOSIT_ACTION = "הפקדה";
export const WITHDRAWAL_ACTION = "משיכה";

/** Net external cash flow per date (YYYY-MM-DD): deposits positive,
 * withdrawals negative. Fees on the transfer itself are part of the flow,
 * matching cashEffect() so this agrees with how the cash balance moved. */
export function externalFlowsByDate(trades: Array<Pick<Trade, "date" | "action" | "value" | "fee">>): Map<string, number> {
  const flows = new Map<string, number>();
  for (const t of trades) {
    let amount: number;
    if (t.action === DEPOSIT_ACTION) amount = t.value + (t.fee || 0);
    else if (t.action === WITHDRAWAL_ACTION) amount = -t.value + (t.fee || 0);
    else continue;
    if (!Number.isFinite(amount) || amount === 0) continue;
    flows.set(t.date, (flows.get(t.date) || 0) + amount);
  }
  return flows;
}

export interface PerformancePoint {
  date: string;
  /** Growth of $1 invested at the first point, flows removed (1.10 = +10%). */
  index: number;
}

/**
 * Chains period returns between consecutive equity points, removing the net
 * external flow that happened in each period:
 *
 *   r = (V_end - flow) / V_start - 1
 *
 * A flow is attributed to the first equity point dated on or after it, i.e.
 * it is assumed to have arrived before that point's valuation (the snapshot
 * is taken after the user's activity for the day). Flows dated on or before
 * the first point are part of the starting capital, not performance.
 *
 * A period that starts at zero/negative value has no meaningful return (all
 * money arrived as a flow), so it contributes 0% rather than infinity.
 */
export function performanceIndex(points: EquityPoint[], flows: Map<string, number>): PerformancePoint[] {
  if (points.length === 0) return [];
  const sortedFlowDates = Array.from(flows.keys()).sort();
  const out: PerformancePoint[] = [{ date: points[0].date, index: 1 }];
  let index = 1;
  let flowCursor = 0;
  // Skip flows up to and including the first point - starting capital.
  while (flowCursor < sortedFlowDates.length && sortedFlowDates[flowCursor] <= points[0].date) flowCursor++;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    let flow = 0;
    while (flowCursor < sortedFlowDates.length && sortedFlowDates[flowCursor] <= cur.date) {
      flow += flows.get(sortedFlowDates[flowCursor]) || 0;
      flowCursor++;
    }
    if (prev.value > 0) {
      const r = (cur.value - flow) / prev.value - 1;
      if (Number.isFinite(r)) index *= 1 + r;
    }
    out.push({ date: cur.date, index });
  }
  return out;
}

/** Cumulative time-weighted return over the whole series (0.1025 = +10.25%),
 * or null when there aren't two points to compare. */
export function timeWeightedReturn(points: EquityPoint[], flows: Map<string, number>): number | null {
  if (points.length < 2) return null;
  const idx = performanceIndex(points, flows);
  return idx[idx.length - 1].index - 1;
}

/** How far current performance is below its own best point (0 at a new
 * high, -0.12 = 12% below). Uses the flow-neutral index, so moving money in
 * or out of the account never registers as a drawdown or a recovery. */
export function performanceDrawdown(points: EquityPoint[], flows: Map<string, number>): number {
  const idx = performanceIndex(points, flows);
  if (idx.length === 0) return 0;
  let peak = -Infinity;
  for (const p of idx) peak = Math.max(peak, p.index);
  const last = idx[idx.length - 1].index;
  return peak > 0 ? last / peak - 1 : 0;
}
