import type { Position } from "@/lib/portfolio";
import type { PositionEval } from "./types";
import { formatMoney } from "./format";

export function evaluatePosition(p: Position, total: number, masked: boolean): PositionEval {
  const weight = p.value / total;
  // Deviation from the target range: how far below min (negative) or above
  // max (positive) the current weight sits; 0 while inside [min, max].
  // Computed fresh every time from the live weight/min/max so it always
  // reflects the position's current state instead of a stale saved number.
  const dev = weight < p.min ? weight - p.min : weight > p.max ? weight - p.max : 0;
  if (p.hodl) {
    return { status: "🔒 להחזיק (HODL)", tone: "blue", priority: "נמוכה", action: "🔒 להחזיק - HODL, לא למכור", weight, dev };
  }
  if (weight < p.min) {
    const amount = p.min * total - p.value;
    return { status: "דורש חיזוק", tone: "amber", priority: "בינונית", action: "📈 לקנות לחיזוק: " + formatMoney(amount, masked), weight, dev };
  }
  if (weight > p.dilute) {
    const amount = p.value - p.max * total;
    return { status: "חריגה - דילול נדרש", tone: "red", priority: "גבוהה", action: "🚨 למכור לדילול: " + formatMoney(amount, masked), weight, dev };
  }
  if (weight > p.max) {
    return { status: "מעל היעד", tone: "amber", priority: "בינונית", action: "👀 שקול דילול הדרגתי", weight, dev };
  }
  return { status: "✅ תקין", tone: "green", priority: "נמוכה", action: "✅ תקין", weight, dev };
}
