"use client";

import { useEffect, useRef, useState } from "react";
import { X, TrendingUp, TrendingDown, ExternalLink, Pencil, Check } from "lucide-react";
import { Button } from "@/components/dashboard/ui/Button";
import { getStockDetailAction } from "@/app/actions/prices";
import type { StockDetail } from "@/lib/prices";
import type { Position } from "@/lib/portfolio";
import { fmtPct, colorFor, tradingViewUrl, formatMoney, parseNum } from "@/components/dashboard/format";

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
  onSetPriceTarget: (symbol: string, priceTarget: number | null) => void;
}

export default function StockDetailDrawer({ symbol, position, colorIndex, privacyMode, onClose, onSetPriceTarget }: StockDetailDrawerProps) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const requestSeq = useRef<number>(0);

  const [editingTarget, setEditingTarget] = useState<boolean>(false);
  const [targetInput, setTargetInput] = useState<string>("");
  useEffect(() => {
    setEditingTarget(false);
    setTargetInput(position?.priceTarget != null ? String(position.priceTarget) : "");
  }, [symbol, position?.priceTarget]);

  function saveTarget() {
    if (!symbol) return;
    const trimmed = targetInput.trim();
    if (trimmed === "") { onSetPriceTarget(symbol, null); setEditingTarget(false); return; }
    const num = parseNum(trimmed);
    if (!Number.isNaN(num) && num > 0) onSetPriceTarget(symbol, num);
    setEditingTarget(false);
  }

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
  const dot = symbol ? colorFor(symbol, colorIndex) : "var(--text-faint)";
  const tvUrl = symbol ? tradingViewUrl(symbol) : null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "var(--scrim)", zIndex: 60,
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
          paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {symbol && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: "var(--radius-full)", background: dot, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontFamily: "var(--mono)" }}>{symbol}</div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    {detail?.name || (loading ? <span className="ds-skeleton" style={{ display: "inline-block", width: 110, height: 11, borderRadius: 4 }} /> : "-")}
                  </div>
                </div>
              </div>
              <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור">
                <X size={16} />
              </Button>
            </div>

            <div style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
              {error && (
                <div style={{ padding: "8px 12px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
                  {error}
                </div>
              )}

              {/* Live price */}
              <div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 4 }}>מחיר חי</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 32, fontWeight: 700, color: "var(--text)", direction: "ltr", textAlign: "right" }}>
                  {livePrice !== null && livePrice !== undefined ? formatMoney(livePrice, privacyMode, { digits: 2 }) : "-"}
                </div>
                {detail && detail.change !== null && detail.changePct !== null ? (
                  <div style={{
                    marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
                    color: detail.change >= 0 ? "var(--gain)" : "var(--loss)", fontSize: 14, fontWeight: 700,
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
                ) : loading ? (
                  <span className="ds-skeleton" style={{ display: "inline-block", marginTop: 6, width: 140, height: 14, borderRadius: 4 }} />
                ) : null}
                {detail?.extended && (
                  <div style={{
                    marginTop: "var(--space-2)", display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 12.5,
                    color: detail.extended.changePct === null ? "var(--text-faint)" : detail.extended.changePct >= 0 ? "var(--gain)" : "var(--loss)",
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
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: "var(--space-2)" }}>תשואות</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-2)" }}>
                  {RETURN_PERIODS.map(({ key, label }) => {
                    const val = detail?.returns?.[key] ?? null;
                    const tone = val === null ? "var(--text-faint)" : val >= 0 ? "var(--gain)" : "var(--loss)";
                    return (
                      <div key={key} style={{
                        background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                        padding: "8px 6px", textAlign: "center",
                      }}>
                        <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 600, marginBottom: 3 }}>{label}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: tone }}>
                          {val === null ? (
                            loading ? <span className="ds-skeleton" style={{ display: "inline-block", width: 28, height: 12, borderRadius: 3 }} /> : "—"
                          ) : (val >= 0 ? "+" : "") + fmtPct(val)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {detail && !detail.historicalAvailable && !loading && (
                  <div style={{ marginTop: "var(--space-2)", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
                    נתוני תשואה היסטוריים (1W–1Y) אינם זמינים כרגע דרך Finnhub לנכס זה — ייתכן שהתוכנית החינמית אינה כוללת גישה לנתוני מחירים היסטוריים עבור הסימול הזה. מוצג רק שינוי יומי (1D), הזמין תמיד בתוכנית החינמית.
                  </div>
                )}
              </div>

              {/* Extra stats available for free from the quote endpoint */}
              {detail && (detail.open !== null || detail.high !== null || detail.low !== null || detail.previousClose !== null) && (
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: "var(--space-2)" }}>נתוני יום המסחר</div>
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
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: "var(--space-2)" }}>ההחזקה שלך</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12.5 }}>
                    <StatRow label="כמות" value={position.qty !== null && position.qty !== undefined ? String(position.qty) : "—"} />
                    <StatRow label="שווי" value={formatMoney(position.value, privacyMode)} />
                    <StatRow label="משקל בתיק" value={fmtPct(position.weight)} />
                  </div>
                  {position.symbol !== "CASH" && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                      <span style={{ color: "var(--text-faint)" }}>מחיר יעד</span>
                      {editingTarget ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="text" inputMode="decimal" autoFocus value={targetInput}
                            onChange={(e) => setTargetInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") setEditingTarget(false); }}
                            placeholder="ללא יעד" style={{ width: 90, fontFamily: "var(--mono)", direction: "ltr", textAlign: "left" }}
                          />
                          <Button variant="icon" onClick={saveTarget} aria-label="שמור" title="שמור"><Check size={13} /></Button>
                        </span>
                      ) : (
                        <span
                          onClick={() => setEditingTarget(true)} role="button" tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingTarget(true); } }}
                          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "var(--mono)", color: position.priceTarget != null ? "var(--text)" : "var(--text-faint)", fontWeight: 600, direction: "ltr" }}
                        >
                          {position.priceTarget != null ? formatMoney(position.priceTarget, privacyMode, { digits: 2 }) : "הגדר"}
                          <Pencil size={11} />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {detail && !detail.configured && (
                <div style={{ padding: "8px 12px", background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: 8, color: "var(--warning)", fontSize: 12.5 }}>
                  לא הצלחנו לעדכן מחירים כרגע.
                </div>
              )}

              {tvUrl && (
                <a href={tvUrl} target="_blank" rel="noopener noreferrer" className="ds-btn ds-btn-ghost"
                  style={{ textDecoration: "none" }}>
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
