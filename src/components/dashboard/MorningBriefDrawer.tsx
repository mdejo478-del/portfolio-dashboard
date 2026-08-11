import { X, Flame, AlertTriangle, Calendar, Newspaper, Target, ExternalLink, CheckCircle2 } from "lucide-react";
import type { MorningBriefResult } from "@/app/actions/morningBrief";
import type { PortfolioHealthData, Tone } from "@/components/dashboard/types";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { fmtPct, formatMoney } from "@/components/dashboard/format";
import { Button } from "@/components/dashboard/ui/Button";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import { daysUntil, daysUntilLabel, earningsHourLabel } from "@/components/dashboard/morningBriefUtils";

const NEAR_EARNINGS_DAYS = 7;
const PRIORITY: Record<Tone, number> = { red: 0, amber: 1, blue: 2, green: 3 };

interface MorningBriefDrawerProps {
  open: boolean;
  onClose: () => void;
  result: MorningBriefResult | null;
  loading: boolean;
  error: string;
  portfolioHealth: PortfolioHealthData;
  privacyMode: boolean;
}

function SectionHeader({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 13.5, fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-3)" }}>
      {icon} {text}
    </div>
  );
}

export function MorningBriefDrawer({ open, onClose, result, loading, error, portfolioHealth, privacyMode }: MorningBriefDrawerProps) {
  const upcomingEarnings = result?.upcomingEarnings ?? [];
  const bigMovers = result?.bigMovers ?? [];
  const news = result?.news ?? [];

  const nearEarnings = upcomingEarnings.filter((e) => { const d = daysUntil(e.date); return d >= 0 && d <= NEAR_EARNINGS_DAYS; });
  const weightBreaches = [...portfolioHealth.needsStrengthen, ...portfolioHealth.weightBreaches];

  const dailyFocus = (() => {
    if (weightBreaches.length === 0) return { text: "אין פעולה דחופה, התיק בתוך היעדים.", tone: "green" as Tone };
    const mostUrgent = [...weightBreaches].sort((a, b) => PRIORITY[a.tone] - PRIORITY[b.tone])[0];
    return { text: mostUrgent.symbol + ": " + mostUrgent.action, tone: mostUrgent.tone };
  })();

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "var(--scrim)", zIndex: 60,
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s ease",
        }}
      />
      <div
        dir="rtl"
        style={{
          position: "fixed", top: 0, bottom: 0, right: 0, width: "min(500px, 100vw)", zIndex: 61,
          background: "var(--panel)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.35)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease", overflowY: "auto",
          display: "flex", flexDirection: "column",
          paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            <Newspaper size={17} color="var(--accent)" /> Morning Brief
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור">
            <X size={16} />
          </Button>
        </div>

        <div style={{ padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {error && (
            <div style={{ padding: "8px 12px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="ds-skeleton" style={{ display: "block", width: 100 - i * 15 + "%", height: 14, borderRadius: 4 }} />
              ))}
            </div>
          ) : (
            <>
              {/* 1. Big movers + their latest news */}
              <div>
                <SectionHeader icon={<Flame size={15} color="var(--loss)" />} text="תנודות בתיק" />
                {bigMovers.length === 0 ? (
                  <EmptyState compact icon={<Flame size={18} />} title="אין תנודות משמעותיות היום" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {bigMovers.map((m) => {
                      const latestNews = news.filter((n) => n.symbol === m.symbol).sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
                      const tone: Tone = m.changePct >= 0 ? "green" : "red";
                      return (
                        <div key={m.symbol} style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text)" }}>{m.symbol}</span>
                            <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13.5, color: TONE_STYLES[tone].text, direction: "ltr" }}>
                              {(m.changePct >= 0 ? "+" : "") + fmtPct(m.changePct)}
                            </span>
                          </div>
                          {latestNews && (
                            <a href={latestNews.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 6, textDecoration: "none" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", lineHeight: 1.4 }}>{latestNews.headline}</div>
                              {latestNews.summary && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3, lineHeight: 1.4 }}>{latestNews.summary}</div>}
                              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>{latestNews.source}</div>
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. Watch items: near earnings + weight breaches */}
              <div>
                <SectionHeader icon={<AlertTriangle size={15} color="var(--warning)" />} text="דברים לשים לב אליהם" />
                {nearEarnings.length === 0 && weightBreaches.length === 0 ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "10px 12px",
                    background: "var(--gain-subtle)", border: "1px solid var(--gain-subtle-border)", borderRadius: "var(--radius-md)",
                    color: "var(--gain)", fontSize: 13,
                  }}>
                    <CheckCircle2 size={15} /> אין אירועים חריגים היום
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {nearEarnings.map((e) => (
                      <div key={"earn-" + e.symbol} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 12.5 }}>
                        <Calendar size={13} color="var(--text-faint)" style={{ flexShrink: 0 }} />
                        <span style={{ color: "var(--text)" }}>{e.symbol} מדווחת {daysUntilLabel(e.date)}</span>
                      </div>
                    ))}
                    {weightBreaches.map((p) => (
                      <div key={"breach-" + p.symbol} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 12.5 }}>
                        <AlertTriangle size={13} color={TONE_STYLES[p.tone].text} style={{ flexShrink: 0 }} />
                        <span style={{ color: "var(--text)" }}>{p.symbol}: {p.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Full upcoming earnings calendar */}
              <div>
                <SectionHeader icon={<Calendar size={15} color="var(--accent)" />} text="דוחות קרובים" />
                {upcomingEarnings.length === 0 ? (
                  <EmptyState compact icon={<Calendar size={18} />} title="אין דוחות קרובים בטווח הנראה לעין" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {upcomingEarnings.map((e) => {
                      const hourLabel = earningsHourLabel(e.hour);
                      return (
                        <div key={e.symbol + e.date} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ color: "var(--text)", fontWeight: 600 }}>{e.symbol}</span>
                          {e.epsEstimate !== null && (
                            <span style={{ color: "var(--text-faint)", fontSize: 11, fontFamily: "var(--mono)", direction: "ltr" }}>
                              EPS צפוי: {formatMoney(e.epsEstimate, privacyMode, { digits: 2 })}
                            </span>
                          )}
                          <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>{hourLabel}</span>
                          <span style={{ color: "var(--text-dim)", fontFamily: "var(--mono)", direction: "ltr" }}>{daysUntilLabel(e.date)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 4. News feed */}
              <div>
                <SectionHeader icon={<Newspaper size={15} color="var(--accent)" />} text="חדשות" />
                {news.length === 0 ? (
                  <EmptyState compact icon={<Newspaper size={18} />} title="אין כותרות חדשות זמינות כרגע" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {news.map((n, i) => (
                      <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 2 }}>{n.symbol}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>{n.headline}</div>
                        {n.summary && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 3, lineHeight: 1.4 }}>{n.summary}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>
                          {n.source} <ExternalLink size={10} />
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. Daily Focus */}
              <div>
                <SectionHeader icon={<Target size={15} color="var(--accent)" />} text="Daily Focus" />
                <div style={{
                  padding: "10px 12px", borderRadius: "var(--radius-md)",
                  background: TONE_STYLES[dailyFocus.tone].bg, border: "1px solid " + TONE_STYLES[dailyFocus.tone].border,
                  color: TONE_STYLES[dailyFocus.tone].text, fontSize: 13, fontWeight: 600,
                }}>
                  {dailyFocus.text}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
