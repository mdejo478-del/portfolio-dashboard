"use client";

import { useEffect, useRef, useState } from "react";
import { X, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { getStockDetailAction } from "@/app/actions/prices";
import type { StockDetail } from "@/lib/prices";
import type { Position } from "@/lib/portfolio";
import { fmtPct, colorFor, tradingViewUrl, formatMoney } from "@/components/InvestmentDashboard";

const RETURN_PERIODS: { key: keyof StockDetail["returns"]; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1Y" },
];

const DETAIL_REFRESH_INTERVAL_MS = 75_000;

interface StockDetailDrawerProps {
  symbol: string | null;
  position: Position | undefined;
  colorIndex: number;
  privacyMode: boolean;
  onClose: () => void;
}

export default function StockDetailDrawer({ symbol, position, colorIndex, privacyMode, onClose }: StockDetailDrawerProps) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const requestSeq = useRef<number>(0);

  useEffect(() => {
    if (!symbol) { setDetail(null); return; }
    let cancelled = false;
    const seq = ++requestSeq.current;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await getStockDetailAction(symbol as string);
        if (!cancelled && seq === requestSeq.current) setDetail(result);
      } catch {
        if (!cancelled && seq === requestSeq.current) setError("שגיאה בטעינת נתוני המניה. נסה שוב.");
      } finally {
        if (!cancelled && seq === requestSeq.current) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, DETAIL_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [symbol]);

  const isOpen = Boolean(symbol);
  const livePrice = position && position.symbol !== "CASH" ? position.price : (detail ? detail.price : null);
  const dot = symbol ? colorFor(symbol, colorIndex) : "#94A3B8";
  const tvUrl = symbol ? tradingViewUrl(symbol) : null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(4,7,10,0.55)", zIndex: 60,
          opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.2s ease",
        }}
      />
      <div
        dir="rtl"
        style={{
          position: "fixed", top: 0, bottom: 0, right: 0, width: "min(420px, 100vw)", zIndex: 61,
          background: "var(--panel)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.35)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease", overflowY: "auto",
          display: "flex", flexDirection: "column",
        }}
      >
        {symbol && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", fontFamily: "var(--mono)" }}>{symbol}</div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{detail?.name || (loading ? "טוען..." : "-")}</div>
                </div>
              </div>
              <button type="button" onClick={onClose} className="icon-btn" aria-label="סגור" title="סגור">
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
              {error && (
                <div style={{ padding: "8px 12px", background: "rgba(255,90,95,0.1)", border: "1px solid rgba(255,90,95,0.35)", borderRadius: 8, color: "#FF8589", fontSize: 12.5 }}>
                  {error}
                </div>
              )}

              {/* Live price */}
              <div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>מחיר חי</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 32, fontWeight: 800, color: "var(--text)", direction: "ltr", textAlign: "right" }}>
                  {livePrice !== null && livePrice !== undefined ? formatMoney(livePrice, privacyMode, { digits: 2 }) : "-"}
                </div>
                {detail && detail.change !== null && detail.changePct !== null && (
                  <div style={{
                    marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
                    color: detail.change >= 0 ? "#5BE39D" : "#FF8589", fontSize: 14, fontWeight: 700,
                  }}>
                    {detail.change >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                    <span style={{ fontFamily: "var(--mono)", direction: "ltr" }}>
                      {(detail.change >= 0 ? "+" : "") + formatMoney(detail.change, privacyMode, { digits: 2 })}
                    </span>
                    <span style={{ fontFamily: "var(--mono)", direction: "ltr" }}>
                      ({(detail.changePct >= 0 ? "+" : "") + fmtPct(detail.changePct)})
                    </span>
                    <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>היום</span>
                  </div>
                )}
                {detail?.extended && (
                  <div style={{
                    marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5,
                    color: detail.extended.changePct === null ? "var(--text-faint)" : detail.extended.changePct >= 0 ? "#5BE39D" : "#FF8589",
                  }}>
                    <span style={{ color: "var(--text-faint)", fontWeight: 600 }}>
                      {detail.extended.session === "pre" ? "טרום-פתיחה" : "לאחר סגירת המסחר"}:
                    </span>
                    <span style={{ fontFamily: "var(--mono)", direction: "ltr", fontWeight: 700 }}>
                      {formatMoney(detail.extended.price, privacyMode, { digits: 2 })}
                      {detail.extended.changePct !== null && " (" + (detail.extended.changePct >= 0 ? "+" : "") + fmtPct(detail.extended.changePct) + ")"}
                    </span>
                  </div>
                )}
              </div>

              {/* Returns row */}
              <div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8 }}>תשואות</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {RETURN_PERIODS.map(({ key, label }) => {
                    const val = detail?.returns?.[key] ?? null;
                    const tone = val === null ? "var(--text-faint)" : val >= 0 ? "#5BE39D" : "#FF8589";
                    return (
                      <div key={key} style={{
                        background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 10,
                        padding: "8px 6px", textAlign: "center",
                      }}>
                        <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 600, marginBottom: 3 }}>{label}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: tone }}>
                          {val === null ? "—" : (val >= 0 ? "+" : "") + fmtPct(val)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {detail && !detail.historicalAvailable && !loading && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
                    נתוני תשואה היסטוריים (1W–1Y) אינם זמינים כרגע דרך Finnhub לנכס זה — ייתכן שהתוכנית החינמית אינה כוללת גישה לנתוני מחירים היסטוריים עבור הסימול הזה. מוצג רק שינוי יומי (1D), הזמין תמיד בתוכנית החינמית.
                  </div>
                )}
              </div>

              {/* Extra stats available for free from the quote endpoint */}
              {detail && (detail.open !== null || detail.high !== null || detail.low !== null || detail.previousClose !== null) && (
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8 }}>נתוני יום המסחר</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12.5 }}>
                    <StatRow label="פתיחה" value={formatMoney(detail.open, privacyMode, { digits: 2 })} />
                    <StatRow label="סגירה קודמת" value={formatMoney(detail.previousClose, privacyMode, { digits: 2 })} />
                    <StatRow label="גבוה יומי" value={formatMoney(detail.high, privacyMode, { digits: 2 })} />
                    <StatRow label="נמוך יומי" value={formatMoney(detail.low, privacyMode, { digits: 2 })} />
                  </div>
                </div>
              )}

              {position && (
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8 }}>ההחזקה שלך</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12.5 }}>
                    <StatRow label="כמות" value={position.qty !== null && position.qty !== undefined ? String(position.qty) : "—"} />
                    <StatRow label="שווי" value={formatMoney(position.value, privacyMode)} />
                    <StatRow label="משקל בתיק" value={fmtPct(position.weight)} />
                  </div>
                </div>
              )}

              {detail && !detail.configured && (
                <div style={{ padding: "8px 12px", background: "rgba(242,169,59,0.1)", border: "1px solid rgba(242,169,59,0.35)", borderRadius: 8, color: "#F5BE6B", fontSize: 12.5 }}>
                  לא הוגדר מפתח API למחירים חיים (FINNHUB_API_KEY).
                </div>
              )}

              {tvUrl && (
                <a href={tvUrl} target="_blank" rel="noopener noreferrer" className="ghost"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, textDecoration: "none", padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 13.5, fontWeight: 600 }}>
                  <ExternalLink size={14} /> פתח גרף מלא ב-TradingView
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-faint)" }}>{label}</span>
      <span style={{ fontFamily: "var(--mono)", color: "var(--text)", fontWeight: 600, direction: "ltr" }}>{value}</span>
    </div>
  );
}
