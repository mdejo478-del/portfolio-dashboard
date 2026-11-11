import { describePriceInfo, PRICE_STATUS_LABEL, SESSION_LABEL, type PriceInfo } from "@/lib/priceStatus";

function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

/** Small marker under a symbol's price: a quiet green dot when the price is OK
 * (tooltip has source and update time), and an explicit word when it is stale,
 * missing, or an extended-hours price - never silent about a price that isn't a
 * fresh regular-session quote. */
export function PriceStatusMark({ info }: { info: PriceInfo | undefined }) {
  if (!info || info.status === "pending") return null;
  const title = describePriceInfo(info);
  const extended = info.session !== "regular" && info.status !== "missing";

  if (info.status === "ok" && !extended) {
    return (
      <span title={title} aria-label={"מחיר " + PRICE_STATUS_LABEL.ok} data-price-status="ok"
        style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--gain)", marginInlineStart: 5, verticalAlign: "middle" }} />
    );
  }
  const time = info.status === "stale" ? hhmm(info.updatedAt) : null;
  return (
    <div title={title} data-price-status={info.status} style={{ fontSize: 10.5, marginTop: 2, whiteSpace: "nowrap", lineHeight: 1.35 }}>
      {info.status !== "ok" && (
        <span style={{ color: info.status === "stale" ? "var(--warning)" : "var(--loss)", fontWeight: 700 }}>
          {PRICE_STATUS_LABEL[info.status]}{time ? " · " + time : ""}
        </span>
      )}
      {extended && (
        <span data-price-session={info.session} style={{ display: "block", color: "var(--info)", fontWeight: 600 }}>
          {"מורחב · " + SESSION_LABEL[info.session as "pre" | "post"]}
        </span>
      )}
    </div>
  );
}
