import { positionReturn } from "@/lib/portfolioTypes";
import { fmtPct, formatMoney, PRIVACY_MASK } from "@/components/dashboard/format";

interface ReturnInput {
  symbol: string;
  price: number | null;
  qty: number | null;
  avgCost?: number | null;
}

// One shared rendering of "return on this position" for both the desktop
// table cell and the mobile card, so the two can never drift apart. The
// percentage stays visible in privacy mode (like weights/deviation - it
// reveals performance, not an amount); the dollar P&L goes through
// formatMoney and is masked.
export function PositionReturnValue({
  position, privacyMode, showAmount = true,
}: { position: ReturnInput; privacyMode: boolean; showAmount?: boolean }) {
  const r = positionReturn(position);
  if (!r) {
    const hint = position.symbol === "CASH" ? undefined : "הזן מחיר ממוצע (בעיפרון) כדי לראות תשואה";
    return <span style={{ color: "var(--text-faint)" }} title={hint}>—</span>;
  }
  const color = r.pct > 0 ? "var(--gain)" : r.pct < 0 ? "var(--loss)" : "var(--text-faint)";
  const sign = (n: number) => (n > 0 ? "+" : "");
  const amount = r.pnl === null ? null : (privacyMode ? PRIVACY_MASK : sign(r.pnl) + formatMoney(r.pnl, false));
  return (
    <span
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "inherit", lineHeight: 1.25, color }}
      title="תשואה לא ממומשת: (מחיר נוכחי − מחיר ממוצע) ÷ מחיר ממוצע"
    >
      <span style={{ fontWeight: 700 }}>{sign(r.pct)}{fmtPct(r.pct)}</span>
      {showAmount && amount !== null && <span style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.85 }}>{amount}</span>}
    </span>
  );
}
