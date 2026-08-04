import type { ExtendedQuote } from "@/lib/prices";
import { formatMoney, fmtPct } from "@/components/dashboard/format";

// Pre-market/after-hours price, shown only when the market's actually in one
// of those windows (see fetchExtendedHoursQuote) - never during the regular
// session, where the live Finnhub price above already covers it.
export function ExtendedPriceBadge({ quote, privacyMode }: { quote: ExtendedQuote | null | undefined; privacyMode: boolean }) {
  if (!quote) return null;
  const tone = quote.changePct === null ? "var(--text-faint)" : quote.changePct >= 0 ? "#5BE39D" : "#FF8589";
  return (
    <div style={{ fontSize: 10.5, marginTop: 2, color: tone, whiteSpace: "nowrap" }}>
      {quote.session === "pre" ? "טרום-פתיחה" : "אחרי סגירה"}: {formatMoney(quote.price, privacyMode, { digits: 2 })}
      {quote.changePct !== null && " (" + (quote.changePct >= 0 ? "+" : "") + fmtPct(quote.changePct) + ")"}
    </div>
  );
}
