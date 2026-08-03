"use client";

import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode, type ChangeEvent } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Percent, Receipt, ListChecks, Plus, ShieldCheck,
  AlertTriangle, ArrowUpCircle, ArrowDownCircle, PiggyBank, Activity, Pencil, Trash2,
  Download, X, Check, Filter, Landmark, LogOut, RefreshCw, Upload, Undo2, Eye, EyeOff, Bell, FileText,
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { savePortfolioAction, rebuildEquityHistoryAction } from "@/app/actions/portfolio";
import { getPricesAction } from "@/app/actions/prices";
import type { ExtendedQuote } from "@/lib/prices";
import { cashEffect } from "@/lib/portfolioTypes";
import type { Position, Trade, Ledger, PortfolioData, EquityPoint } from "@/lib/portfolio";
import StockDetailDrawer from "@/components/StockDetailDrawer";
import TradeImportModal from "@/components/TradeImportModal";
import { parseTradeFile, parseTradeWorkbook, type ParseResult, type ParsedTradeRow } from "@/lib/tradeImport";

export type Tone = "green" | "amber" | "red" | "blue";

interface PositionEval {
  status: string;
  tone: Tone;
  priority: string;
  action: string;
  weight: number;
  dev: number;
}
type EvaluatedPosition = Position & PositionEval;

interface Alert {
  id: string;
  tone: Tone;
  title: string;
  message: string;
}

interface TradeFormState {
  date: string;
  symbol: string;
  action: string;
  qty: string;
  price: string;
  fee: string;
  strategy: string;
  notes: string;
  pnlManual: string;
}
interface PositionFormState {
  symbol: string;
  qty: string;
  price: string;
}
interface PosEditFields {
  qty: string;
  min: string;
  max: string;
  dilute: string;
}
interface UndoSnapshot {
  label: string;
  positions: Position[];
  trades: Trade[];
  ledger: Ledger;
  nextPositionId: number;
  nextTradeId: number;
}

const SYMBOL_COLORS: Record<string, string> = {
  NVDA: "#22D3A8", IBIT: "#4FA3F7", PLTR: "#A78BFA", TSLA: "#FF5A5F",
  GOOG: "#F2A93B", SOFI: "#34D399", RKLB: "#FB923C", ETH: "#8B93FF", CASH: "#94A3B8",
};
const FALLBACK_COLORS = ["#22D3A8", "#4FA3F7", "#A78BFA", "#FF5A5F", "#F2A93B", "#34D399", "#8B93FF", "#F472B6", "#60A5FA", "#FBBF24"];
export function colorFor(symbol: string, idx: number): string {
  return SYMBOL_COLORS[symbol] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

const TRADINGVIEW_SYMBOL_MAP: Record<string, string | null> = { ETH: "ETHUSD", CASH: null };
export function tradingViewUrl(symbol: string): string | null {
  if (TRADINGVIEW_SYMBOL_MAP[symbol] === null) return null;
  const tvSymbol = TRADINGVIEW_SYMBOL_MAP[symbol] || symbol;
  return "https://www.tradingview.com/symbols/" + tvSymbol + "/";
}

export function fmtUSD(n: number | null | undefined, opts: { digits?: number } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  const digits = opts.digits !== undefined ? opts.digits : (abs < 1000 ? 2 : 0);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (n < 0 ? "-$" : "$") + s;
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return (n * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
}
function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function parseNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (s === "") return NaN;
  s = s.replace(/\s/g, "");
  // Handle period used as a thousands separator (e.g. "10.000" meaning ten thousand,
  // common in Hebrew/European number formatting) - only when the whole string is
  // digit groups of exactly 3 separated by periods, so a real decimal like "150.5"
  // or "12.75" is never misinterpreted.
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  // Strip comma thousands separators (e.g. "10,000" -> "10000")
  s = s.replace(/,/g, "");
  return parseFloat(s);
}

export const PRIVACY_MASK = "•••••";
export function formatMoney(n: number | null | undefined, masked: boolean, opts: { digits?: number } = {}): string {
  return masked ? PRIVACY_MASK : fmtUSD(n, opts);
}

function evaluatePosition(p: Position, total: number, masked: boolean): PositionEval {
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

export const TONE_STYLES: Record<Tone, { bg: string; border: string; text: string }> = {
  green: { bg: "rgba(46,204,113,0.12)", border: "rgba(46,204,113,0.35)", text: "#5BE39D" },
  amber: { bg: "rgba(242,169,59,0.12)", border: "rgba(242,169,59,0.35)", text: "#F5BE6B" },
  red: { bg: "rgba(255,90,95,0.12)", border: "rgba(255,90,95,0.35)", text: "#FF8589" },
  blue: { bg: "rgba(79,163,247,0.12)", border: "rgba(79,163,247,0.35)", text: "#7FBBFA" },
};

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const s = TONE_STYLES[tone] || TONE_STYLES.green;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: s.bg, border: "1px solid " + s.border, color: s.text,
      borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

// Pre-market/after-hours price, shown only when the market's actually in one
// of those windows (see fetchExtendedHoursQuote) - never during the regular
// session, where the live Finnhub price above already covers it.
function ExtendedPriceBadge({ quote, privacyMode }: { quote: ExtendedQuote | null | undefined; privacyMode: boolean }) {
  if (!quote) return null;
  const tone = quote.changePct === null ? "var(--text-faint)" : quote.changePct >= 0 ? "#5BE39D" : "#FF8589";
  return (
    <div style={{ fontSize: 10.5, marginTop: 2, color: tone, whiteSpace: "nowrap" }}>
      {quote.session === "pre" ? "טרום-פתיחה" : "אחרי סגירה"}: {formatMoney(quote.price, privacyMode, { digits: 2 })}
      {quote.changePct !== null && " (" + (quote.changePct >= 0 ? "+" : "") + fmtPct(quote.changePct) + ")"}
    </div>
  );
}

function Card({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: string; tone?: Tone; icon?: ReactNode }) {
  const s = tone ? TONE_STYLES[tone] : null;
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--text-dim)", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2, lineHeight: 1.3 }}>{label}</span>
        {icon}
      </div>
      <span style={{ fontFamily: "var(--mono)", fontSize: 23, fontWeight: 700, lineHeight: 1.2, color: s ? s.text : "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      {sub && <span style={{ color: "var(--text-faint)", fontSize: 12, lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}

const ACTION_LABELS: Record<string, { label: string; tone: Tone; icon: ReactNode }> = {
  "קנייה": { label: "קנייה", tone: "green", icon: <ArrowUpCircle size={14} /> },
  "מכירה": { label: "מכירה", tone: "red", icon: <ArrowDownCircle size={14} /> },
  "הפקדה": { label: "הפקדה", tone: "blue", icon: <PiggyBank size={14} /> },
  "משיכה": { label: "משיכה", tone: "amber", icon: <ArrowDownCircle size={14} /> },
};
function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_LABELS[action] || { label: action, tone: "amber" as Tone, icon: null };
  const s = TONE_STYLES[meta.tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, border: "1px solid " + s.border, color: s.text,
      borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>{meta.icon}{meta.label}</span>
  );
}

const SYMOPTS = ["NVDA", "IBIT", "PLTR", "TSLA", "GOOG", "SOFI", "RKLB", "ETH", "CASH", "AMAT", "HOOD", "DUOL", "MSTR", "AMZN", "CIBR", "META", "PANW", "OKLO", "CRWD", "IREN", "NFLX"];
const STRATEGY_OPTS = [
  "📈 קנייה DCA",
  "🚨 מכירה דילול",
  "➕ הפקדה",
  "⚙️ אחר",
];
function mapStrategyToOption(s: string | null | undefined): string {
  const str = String(s || "");
  if (str.includes("הפקדה")) return "➕ הפקדה";
  if (str.includes("דילול") || str.includes("מכירה")) return "🚨 מכירה דילול";
  if (str.includes("DCA") || str.includes("קנייה")) return "📈 קנייה DCA";
  return "⚙️ אחר";
}
const ACTION_OPTS = ["קנייה", "מכירה", "הפקדה", "משיכה"];

const EMPTY_FORM: TradeFormState = {
  date: new Date().toISOString().slice(0, 10),
  symbol: "NVDA", action: "קנייה",
  qty: "", price: "", fee: "-2.5", strategy: "📈 קנייה DCA", notes: "", pnlManual: "",
};

const EMPTY_POSITION_FORM: PositionFormState = { symbol: "", qty: "", price: "" };

const PRICE_REFRESH_INTERVAL_MS = 75_000;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

interface InvestmentDashboardProps {
  userName: string;
  initialPositions: Position[];
  initialTrades: Trade[];
  initialLedger: Ledger;
  initialNextPositionId: number;
  initialNextTradeId: number;
  initialEquityHistory: EquityPoint[];
}

export default function InvestmentDashboard({
  userName,
  initialPositions,
  initialTrades,
  initialLedger,
  initialNextPositionId,
  initialNextTradeId,
  initialEquityHistory,
}: InvestmentDashboardProps) {
  const [privacyMode, setPrivacyMode] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string>("");
  useEffect(() => {
    function onError(e: ErrorEvent) { setGlobalError(String((e && e.message) || e)); }
    function onRejection(e: PromiseRejectionEvent) { setGlobalError(String((e && e.reason && e.reason.message) || (e && e.reason) || e)); }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const [positions, setPositions] = useState<Position[]>(initialPositions);
  const nextPosId = useRef<number>(initialNextPositionId);
  const [editingPosId, setEditingPosId] = useState<number | null>(null);
  const [posEditFields, setPosEditFields] = useState<PosEditFields>({ qty: "", min: "", max: "", dilute: "" });
  const [deletePosConfirmId, setDeletePosConfirmId] = useState<number | null>(null);
  const [showAddPosition, setShowAddPosition] = useState<boolean>(false);
  const [posForm, setPosForm] = useState<PositionFormState>(EMPTY_POSITION_FORM);
  const [posFormError, setPosFormError] = useState<string>("");

  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const nextId = useRef<number>(initialNextTradeId);
  const [ledger, setLedger] = useState<Ledger>(initialLedger);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TradeFormState>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [tradeFormError, setTradeFormError] = useState<string>("");

  const [importResult, setImportResult] = useState<ParseResult | null>(null);
  const [importFileName, setImportFileName] = useState<string>("");
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  const positionsRef = useRef<Position[]>(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  const tradesRef = useRef<Trade[]>(trades);
  useEffect(() => { tradesRef.current = trades; }, [trades]);
  const ledgerRef = useRef<Ledger>(ledger);
  useEffect(() => { ledgerRef.current = ledger; }, [ledger]);

  // Autosave: strictly sequential, never more than one save in flight. Without
  // this, two rapid edits (e.g. adding two trades back-to-back) fire two
  // overlapping save requests, and if the OLDER one happens to resolve AFTER
  // the newer one (perfectly normal on a real network), it silently
  // overwrites the file with stale data - the newer trade looks saved in the
  // UI but is gone from disk. This queue always reads the latest ref values
  // at send-time and, if state changed again mid-save, immediately runs one
  // more save right after - never dropping a change, never racing.
  const saveInFlight = useRef<boolean>(false);
  const savePending = useRef<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");

  const runSave = useCallback(async () => {
    if (saveInFlight.current) { savePending.current = true; return; }
    saveInFlight.current = true;
    try {
      for (;;) {
        savePending.current = false;
        const data: PortfolioData = {
          positions: positionsRef.current,
          trades: tradesRef.current,
          ledger: ledgerRef.current,
          nextPositionId: nextPosId.current,
          nextTradeId: nextId.current,
        };
        setSaveStatus("saving");
        try {
          await savePortfolioAction(data);
          setSaveStatus("idle");
        } catch (err) {
          setSaveStatus("error");
          setGlobalError(String((err && (err as Error).message) || err));
        }
        if (!savePending.current) break;
      }
    } finally {
      saveInFlight.current = false;
    }
  }, []);

  const skipNextSave = useRef<boolean>(true);
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    runSave();
  }, [positions, trades, ledger, runSave]);

  // Periodic backup save: a safety net independent of the change-triggered
  // save above, in case a transient failure was missed or dismissed.
  useEffect(() => {
    const interval = setInterval(() => { runSave(); }, 15_000);
    return () => clearInterval(interval);
  }, [runSave]);

  const [pricesConfigured, setPricesConfigured] = useState<boolean | null>(null);
  const [pricesLoading, setPricesLoading] = useState<boolean>(false);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceError, setPriceError] = useState<string>("");
  const [extendedPrices, setExtendedPrices] = useState<Record<string, ExtendedQuote | null>>({});

  const refreshPrices = useCallback(async () => {
    const symbols = positionsRef.current.filter((p) => p.symbol !== "CASH").map((p) => p.symbol);
    setPricesLoading(true);
    setPriceError("");
    try {
      const result = await getPricesAction(symbols);
      setPricesConfigured(result.configured);
      if (result.configured) {
        setPositions((ps) => ps.map((p) => {
          // Prefer the pre-market/after-hours tick when the market's in one of
          // those windows, so the portfolio's value reflects the latest known
          // price rather than freezing at the last regular-session close - the
          // badge under the price still labels it so it reads as a thin/less
          // reliable quote, not a regular-session price.
          const newPrice = result.extended[p.symbol]?.price ?? result.prices[p.symbol];
          if (newPrice == null || p.qty == null) return p;
          return { ...p, price: newPrice, value: p.qty * newPrice };
        }));
        setExtendedPrices(result.extended);
        setLastPriceUpdate(new Date());
      }
    } catch {
      setPriceError("שגיאה בעדכון מחירים. נסה שוב.");
    } finally {
      setPricesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPrices();
    const interval = setInterval(refreshPrices, PRICE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  function openDetail(symbol: string) { if (symbol !== "CASH") setDetailSymbol(symbol); }

  const [fSymbol, setFSymbol] = useState<string>("הכל");
  const [fAction, setFAction] = useState<string>("הכל");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");

  const total = useMemo(() => positions.reduce((a, p) => a + p.value, 0), [positions]);
  const evaluated = useMemo<EvaluatedPosition[]>(() => positions.map((p) => ({ ...p, ...evaluatePosition(p, total, privacyMode) })), [positions, total, privacyMode]);
  const needsAction = evaluated.filter((p) => p.status !== "✅ תקין" && !p.hodl);
  const pieData = evaluated.map((p) => ({ name: p.symbol, value: p.value, weight: p.weight }));

  // Portfolio Health: a quick-glance score built from the same status/weight
  // rules already used per-position, just rolled up into one summary.
  const portfolioHealth = useMemo(() => {
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

    return { score, tone, diversification, risk, cashPct: cashPos ? cashPos.weight : 0, cashTone, needsStrengthen, weightBreaches };
  }, [evaluated]);

  // Alerts: only conditions that genuinely need attention (never one per
  // healthy position - that would be noise). Ids are deterministic and
  // content-based (e.g. "below-min:RKLB") so dismissing one only suppresses
  // that specific occurrence - if the same condition resolves and later
  // recurs, it reappears as a fresh alert (handled by the GC effect below).
  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = [];
    for (const p of evaluated) {
      if (p.hodl) continue; // HODL positions are exempt from rebalancing by design
      const isCash = p.symbol === "CASH";
      if (p.status === "דורש חיזוק") {
        list.push({
          id: "below-min:" + p.symbol, tone: "amber",
          title: isCash ? "אחוז המזומן נמוך מהיעד" : p.symbol + " מתחת ליעד המינימום",
          message: p.action,
        });
      } else if (p.status === "חריגה - דילול נדרש") {
        list.push({
          id: "dilute-breach:" + p.symbol, tone: "red",
          title: isCash ? "אחוז המזומן גבוה משמעותית מהיעד" : p.symbol + " חריגה - נדרש דילול",
          message: p.action,
        });
      } else if (p.status === "מעל היעד") {
        list.push({
          id: "over-max:" + p.symbol, tone: "amber",
          title: isCash ? "אחוז המזומן מעל היעד" : p.symbol + " מעל יעד המקסימום",
          message: p.action,
        });
      } else if (p.status === "✅ תקין") {
        // A quiet positive callout: only when weight sits right at the center
        // of the target range, not for merely "somewhere inside" it (that's
        // the normal/expected state for most positions, and would be noise).
        const mid = (p.min + p.max) / 2;
        if (Math.abs(p.weight - mid) <= 0.015) {
          list.push({
            id: "on-target:" + p.symbol, tone: "green",
            title: (isCash ? "אחוז המזומן" : p.symbol) + " הגיע ליעד המשקל",
            message: "המשקל הנוכחי (" + fmtPct(p.weight) + ") קרוב מאוד ליעד האידיאלי.",
          });
        }
      }
    }

    const problemCount = portfolioHealth.needsStrengthen.length + portfolioHealth.weightBreaches.length;
    if (problemCount >= 3 || portfolioHealth.score < 50) {
      list.push({
        id: "rebalance-recommended", tone: portfolioHealth.tone === "red" ? "red" : "amber",
        title: "מומלץ איזון מחדש כולל",
        message: problemCount + " נכסים דורשים תשומת לב וציון בריאות התיק הוא " + portfolioHealth.score + "/100.",
      });
    }

    const priority: Record<Tone, number> = { red: 0, amber: 1, blue: 2, green: 3 };
    return list.sort((a, b) => priority[a.tone] - priority[b.tone]);
  }, [evaluated, portfolioHealth]);

  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [seenAlertIds, setSeenAlertIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setDismissedAlertIds(new Set(JSON.parse(localStorage.getItem("alerts_dismissed_v1") || "[]")));
      setSeenAlertIds(new Set(JSON.parse(localStorage.getItem("alerts_seen_v1") || "[]")));
    } catch { /* ignore malformed/unavailable storage */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("alerts_dismissed_v1", JSON.stringify([...dismissedAlertIds])); } catch { /* ignore */ }
  }, [dismissedAlertIds]);
  useEffect(() => {
    try { localStorage.setItem("alerts_seen_v1", JSON.stringify([...seenAlertIds])); } catch { /* ignore */ }
  }, [seenAlertIds]);
  // Garbage-collect ids for alerts whose underlying condition no longer holds,
  // so if the same condition recurs later it shows up again instead of
  // staying permanently suppressed by a stale dismissal.
  useEffect(() => {
    const currentIds = new Set(alerts.map((a) => a.id));
    setDismissedAlertIds((prev) => new Set([...prev].filter((id) => currentIds.has(id))));
    setSeenAlertIds((prev) => new Set([...prev].filter((id) => currentIds.has(id))));
  }, [alerts]);

  const visibleAlerts = useMemo(() => alerts.filter((a) => !dismissedAlertIds.has(a.id)), [alerts, dismissedAlertIds]);
  const unseenAlertCount = useMemo(() => visibleAlerts.filter((a) => !seenAlertIds.has(a.id)).length, [visibleAlerts, seenAlertIds]);

  function dismissAlert(id: string) {
    setDismissedAlertIds((prev) => new Set([...prev, id]));
  }
  function markAlertsSeen() {
    setSeenAlertIds((prev) => new Set([...prev, ...visibleAlerts.map((a) => a.id)]));
  }

  const [alertsOpen, setAlertsOpen] = useState<boolean>(false);
  function toggleAlerts() {
    setAlertsOpen((open) => {
      const next = !open;
      if (next) markAlertsSeen();
      return next;
    });
  }

  // Equity curve: the server keeps one snapshot per day (see savePortfolio),
  // returned as initialEquityHistory. Here we additionally overlay today's
  // live total so the chart's last point stays current between saves,
  // without waiting for a round-trip to the server. equityHistoryOverride
  // holds a freshly rebuilt-from-trades series after the user triggers a
  // rebuild, without needing a full page reload.
  const [equityHistoryOverride, setEquityHistoryOverride] = useState<EquityPoint[] | null>(null);
  const [rebuildingEquity, setRebuildingEquity] = useState<boolean>(false);
  const [equityRebuildWarnings, setEquityRebuildWarnings] = useState<string[]>([]);

  const equityChartData = useMemo<EquityPoint[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const history = [...(equityHistoryOverride ?? initialEquityHistory)];
    const last = history[history.length - 1];
    if (last && last.date === today) {
      history[history.length - 1] = { date: today, value: total };
    } else {
      history.push({ date: today, value: total });
    }
    return history;
  }, [equityHistoryOverride, initialEquityHistory, total]);

  const equityAth = useMemo(
    () => equityChartData.reduce((max, p) => Math.max(max, p.value), 0),
    [equityChartData]
  );
  const equityReturn = useMemo(() => {
    const first = equityChartData[0]?.value;
    return first && first > 0 ? (total - first) / first : null;
  }, [equityChartData, total]);

  async function handleRebuildEquityHistory() {
    setRebuildingEquity(true);
    setEquityRebuildWarnings([]);
    try {
      const result = await rebuildEquityHistoryAction();
      setEquityHistoryOverride(result.history);
      setEquityRebuildWarnings(result.warnings);
    } catch (err) {
      setGlobalError(String((err && (err as Error).message) || err));
    } finally {
      setRebuildingEquity(false);
    }
  }
  // Holdings sort largest position first; CASH always anchors the bottom regardless of size.
  // colorFor keeps using each row's original index so dot colors stay identical to the pie/ticker.
  const tableRows = useMemo(
    () => evaluated.map((p, i) => ({ p, i })).sort((a, b) => {
      const aCash = a.p.symbol === "CASH" ? 1 : 0;
      const bCash = b.p.symbol === "CASH" ? 1 : 0;
      if (aCash !== bCash) return aCash - bCash;
      return b.p.value - a.p.value;
    }),
    [evaluated]
  );

  function startEditPosQty(p: Position) {
    setEditingPosId(p.id);
    setPosEditFields({
      qty: p.symbol === "CASH" ? String(p.value) : String(p.qty),
      min: String(Math.round(p.min * 1000) / 10),
      max: String(Math.round(p.max * 1000) / 10),
      dilute: String(Math.round(p.dilute * 1000) / 10),
    });
  }
  function cancelPosEdit() { setEditingPosId(null); setPosEditFields({ qty: "", min: "", max: "", dilute: "" }); }
  function updatePosEditField(field: keyof PosEditFields, val: string) { setPosEditFields((f) => ({ ...f, [field]: val })); }
  function savePosQty(p: Position) {
    const qtyNum = parseNum(posEditFields.qty);
    const minNum = parseNum(posEditFields.min);
    const maxNum = parseNum(posEditFields.max);
    const diluteNum = parseNum(posEditFields.dilute);
    if (Number.isNaN(qtyNum) || qtyNum < 0) { cancelPosEdit(); return; }
    pushUndoSnapshot("עריכת נכס בתיק");
    const min = !Number.isNaN(minNum) ? minNum / 100 : p.min;
    const max = !Number.isNaN(maxNum) ? maxNum / 100 : p.max;
    const dilute = !Number.isNaN(diluteNum) ? diluteNum / 100 : p.dilute;
    setPositions((ps) => ps.map((row) => {
      if (row.id !== p.id) return row;
      const updated = { ...row, min, max, dilute };
      if (row.symbol === "CASH") return { ...updated, value: qtyNum };
      return { ...updated, qty: qtyNum, value: qtyNum * (row.price ?? 0) };
    }));
    cancelPosEdit();
  }
  function deletePosition(id: number) {
    pushUndoSnapshot("מחיקת נכס מהתיק");
    setPositions((ps) => {
      const target = ps.find((p) => p.id === id);
      if (target && target.symbol === "CASH") return ps;
      return ps.filter((p) => p.id !== id);
    });
    setDeletePosConfirmId(null);
  }
  function updatePosForm(field: keyof PositionFormState, val: string) { setPosForm((f) => ({ ...f, [field]: val })); setPosFormError(""); }
  function submitNewPosition() {
    const symbol = (posForm.symbol || "").trim().toUpperCase();
    const qty = parseNum(posForm.qty);
    const price = parseNum(posForm.price);
    if (!symbol) { setPosFormError("נא להזין סימול נכס."); return; }
    if (Number.isNaN(qty) || qty <= 0) { setPosFormError("נא להזין כמות תקינה (מספר גדול מ-0)."); return; }
    if (Number.isNaN(price) || price <= 0) { setPosFormError("נא להזין מחיר תקין (מספר גדול מ-0)."); return; }
    if (positions.some((p) => p.symbol === symbol)) { setPosFormError("נכס בסימול " + symbol + " כבר קיים בתיק. ערוך את הכמות שלו ישירות בטבלה במקום."); return; }
    pushUndoSnapshot("הוספת נכס לתיק");
    const value = qty * price;
    setPositions((ps) => [...ps, {
      id: nextPosId.current++, symbol, qty, price, value, weight: 0,
      dev: 0, min: 0, max: 1, dilute: 1.5, hodl: false,
    }]);
    setPosForm(EMPTY_POSITION_FORM);
    setPosFormError("");
    setShowAddPosition(false);
  }

  const symbolOptions = useMemo(() => {
    const set = new Set(trades.map((t) => t.symbol));
    return Array.from(set).sort();
  }, [trades]);

  const symbolSuggestions = useMemo(() => {
    const set = new Set([...SYMOPTS, ...positions.map((p) => p.symbol), ...symbolOptions]);
    return Array.from(set).sort();
  }, [positions, symbolOptions]);

  const stats = useMemo(() => {
    const sells = trades.filter((t) => t.action === "מכירה");
    const wins = sells.filter((t) => t.pnl !== null && t.pnl > 0);
    const realizedPnl = trades.reduce((a, t) => a + (t.pnl || 0), 0);
    const fees = trades.reduce((a, t) => a + (t.fee || 0), 0);
    const buysSells = trades.filter((t) => t.action !== "הפקדה" && t.action !== "משיכה").length;
    const winRate = sells.length ? wins.length / sells.length : 0;
    const avgPnl = sells.length ? sells.reduce((a, t) => a + (t.pnl || 0), 0) / sells.length : 0;
    const rets = sells.filter((t) => t.retPct !== null).map((t) => t.retPct as number);
    const avgRet = rets.length ? rets.reduce((a, r) => a + r, 0) / rets.length : 0;
    const deposits = trades.filter((t) => t.action === "הפקדה").reduce((a, t) => a + t.value, 0);
    return { realizedPnl, fees, buysSells, winRate, avgPnl, avgRet, sellCount: sells.length, deposits };
  }, [trades]);

  // Portfolio Summary: a plain-language readout built entirely from data the
  // system already has (weights, saved equity snapshots, the trade journal) -
  // no live prices or external calls, so it's free and always available.
  const portfolioSummary = useMemo<string[]>(() => {
    const lines: string[] = [];

    const first = equityChartData[0];
    if (first && first.value > 0 && equityChartData.length > 1) {
      const sign = equityReturn !== null && equityReturn >= 0 ? "+" : "";
      lines.push("שווי התיק " + formatMoney(total, privacyMode) + ", שינוי של " + sign + fmtPct(equityReturn) + " מאז תחילת המעקב (" + first.date + ").");
    } else {
      lines.push("שווי התיק " + formatMoney(total, privacyMode) + ". המעקב אחר התפתחות התיק החל היום.");
    }
    const prev = equityChartData[equityChartData.length - 2];
    if (prev && prev.value > 0) {
      const dayChange = (total - prev.value) / prev.value;
      lines.push("לעומת נקודת המדידה הקודמת: " + (dayChange >= 0 ? "+" : "") + fmtPct(dayChange) + ".");
    }

    const nonCash = [...evaluated].filter((p) => p.symbol !== "CASH").sort((a, b) => b.weight - a.weight);
    if (nonCash.length > 0) {
      const top = nonCash.slice(0, 3).map((p) => p.symbol + " (" + fmtPct(p.weight) + ")").join(", ");
      lines.push("המרכיבים הגדולים ביותר לפי משקל בתיק: " + top + ".");
    }

    if (stats.sellCount > 0) {
      const bySymbol = new Map<string, number>();
      for (const t of trades) {
        if (t.pnl === null) continue;
        bySymbol.set(t.symbol, (bySymbol.get(t.symbol) || 0) + t.pnl);
      }
      const ranked = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 1 && ranked[0][1] !== ranked[ranked.length - 1][1]) {
        const [bestSym, bestPnl] = ranked[0];
        const [worstSym, worstPnl] = ranked[ranked.length - 1];
        lines.push("לפי רווח/הפסד ממומש: " + bestSym + " תרמה הכי הרבה (" + formatMoney(bestPnl, privacyMode) + "), " + worstSym + " הכי פחות (" + formatMoney(worstPnl, privacyMode) + ").");
      } else if (ranked.length === 1) {
        lines.push("רווח/הפסד ממומש עד כה: " + ranked[0][0] + " (" + formatMoney(ranked[0][1], privacyMode) + ").");
      }
    }

    lines.push(
      portfolioHealth.needsStrengthen.length > 0
        ? "נכסים שדורשים חיזוק: " + portfolioHealth.needsStrengthen.map((p) => p.symbol).join(", ") + "."
        : "אין נכסים מתחת ליעד המינימום כרגע."
    );

    lines.push(
      portfolioHealth.weightBreaches.length > 0
        ? "חריגות משקל שדורשות תשומת לב: " + portfolioHealth.weightBreaches.map((p) => p.symbol).join(", ") + "."
        : "אין חריגות משקל כרגע."
    );

    lines.push("אחוז המזומן בתיק: " + fmtPct(portfolioHealth.cashPct) + ".");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const recentCount = trades.filter((t) => t.date >= cutoffStr).length;
    lines.push(
      "ב-30 הימים האחרונים בוצעו " + recentCount + " עסקאות. רווח/הפסד ממומש מצטבר: " + formatMoney(stats.realizedPnl, privacyMode) + "."
    );

    return lines;
  }, [evaluated, portfolioHealth, stats, trades, equityChartData, equityReturn, total, privacyMode]);

  const cashFree = useMemo(() => {
    const cashPos = positions.find((p) => p.symbol === "CASH");
    return cashPos ? cashPos.value : 0;
  }, [positions]);

  function applyCashDelta(delta: number) {
    if (!delta) return;
    setPositions((ps) => {
      if (ps.some((p) => p.symbol === "CASH")) {
        return ps.map((p) => (p.symbol === "CASH" ? { ...p, value: p.value + delta } : p));
      }
      return [...ps, {
        id: nextPosId.current++, symbol: "CASH", qty: null, price: null,
        value: delta, weight: 0, dev: 0, min: 0, max: 1, dilute: 1.5,
      }];
    });
  }

  function pushUndoSnapshot(label: string) {
    setUndoSnapshot({
      label,
      positions: JSON.parse(JSON.stringify(positions)),
      trades: JSON.parse(JSON.stringify(trades)),
      ledger: JSON.parse(JSON.stringify(ledger)),
      nextPositionId: nextPosId.current,
      nextTradeId: nextId.current,
    });
  }

  function undoLastAction() {
    if (!undoSnapshot) return;
    setPositions(undoSnapshot.positions);
    setTrades(undoSnapshot.trades);
    setLedger(undoSnapshot.ledger);
    nextPosId.current = undoSnapshot.nextPositionId;
    nextId.current = undoSnapshot.nextTradeId;
    setUndoSnapshot(null);
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setImportFileName(file.name);
    const lowerName = file.name.toLowerCase();
    const isExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    const isCsv = lowerName.endsWith(".csv");
    if (!isExcel && !isCsv) {
      setImportResult({
        fileError: "פורמט קובץ לא נתמך. יש להעלות קובץ CSV (.csv) או Excel (.xlsx/.xls).",
        rows: [],
      });
      return;
    }
    setImportLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (isExcel) {
          const buffer = reader.result as ArrayBuffer;
          setImportResult(await parseTradeWorkbook(buffer));
        } else {
          const text = typeof reader.result === "string" ? reader.result : "";
          setImportResult(parseTradeFile(text));
        }
      } finally {
        setImportLoading(false);
      }
    };
    reader.onerror = () => { setImportResult({ fileError: "שגיאה בקריאת הקובץ. נסה שוב.", rows: [] }); setImportLoading(false); };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "utf-8");
  }

  function closeImportModal() {
    setImportResult(null);
    setImportFileName("");
  }

  function confirmImport(validRows: ParsedTradeRow[]) {
    if (validRows.length === 0) { closeImportModal(); return; }
    pushUndoSnapshot("ייבוא קובץ עסקאות");
    const chronological = [...validRows].sort((a, b) => (a.date as string).localeCompare(b.date as string));
    let workingLedger: Ledger = { ...ledger };
    let cashDelta = 0;
    const newTrades: Trade[] = [];

    for (const row of chronological) {
      const symbol = row.symbol as string;
      const action = row.action as string;
      const qty = row.qty as number;
      const price = row.price as number;
      const value = qty * price;
      let pnl: number | null = null;
      let retPct: number | null = null;

      if (action === "קנייה" && symbol !== "CASH") {
        const cur = workingLedger[symbol] || { qty: 0, avgCost: price };
        const newQty = cur.qty + qty;
        const newAvg = newQty > 0 ? (cur.qty * cur.avgCost + qty * price) / newQty : price;
        workingLedger = { ...workingLedger, [symbol]: { qty: newQty, avgCost: newAvg } };
      } else if (action === "מכירה" && symbol !== "CASH") {
        const cur = workingLedger[symbol] || { qty: 0, avgCost: price };
        const autoPnl = Math.round((price - cur.avgCost) * qty * 100) / 100;
        pnl = row.pnlOverride !== null ? row.pnlOverride : autoPnl;
        retPct = (value - pnl) !== 0 ? pnl / (value - pnl) : 0;
        workingLedger = { ...workingLedger, [symbol]: { qty: cur.qty - qty, avgCost: cur.avgCost } };
      }

      const trade: Trade = {
        id: nextId.current++, date: row.date as string, symbol, action, qty, price, value,
        fee: row.fee, pnl, retPct, strategy: row.strategy, notes: row.notes,
      };
      cashDelta += cashEffect(trade);
      newTrades.push(trade);
    }

    setLedger(workingLedger);
    setTrades((ts) => [...ts, ...newTrades]);
    applyCashDelta(cashDelta);
    closeImportModal();
  }

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (fSymbol !== "הכל" && t.symbol !== fSymbol) return false;
      if (fAction !== "הכל" && t.action !== fAction) return false;
      if (fFrom && t.date < fFrom) return false;
      if (fTo && t.date > fTo) return false;
      return true;
    });
  }, [trades, fSymbol, fAction, fFrom, fTo]);

  const sortedTrades = useMemo(() => [...filteredTrades].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.id - a.id;
  }), [filteredTrades]);

  function updateForm(field: keyof TradeFormState, val: string) { setForm((f) => ({ ...f, [field]: val })); setTradeFormError(""); }

  const qtyNum = parseNum(form.qty);
  const priceNum = parseNum(form.price);
  const previewValue = (!Number.isNaN(qtyNum) && !Number.isNaN(priceNum)) ? qtyNum * priceNum : null;
  const previewAvgCost = form.symbol !== "CASH" && ledger[form.symbol] ? ledger[form.symbol].avgCost : null;
  const previewAutoPnl = (form.action === "מכירה" && previewValue !== null && previewAvgCost !== null)
    ? Math.round((priceNum - previewAvgCost) * qtyNum * 100) / 100 : null;
  const pnlManualNum = form.pnlManual !== "" ? parseNum(form.pnlManual) : null;
  const effectivePnl = (form.action === "מכירה")
    ? (pnlManualNum !== null && !Number.isNaN(pnlManualNum) ? pnlManualNum : previewAutoPnl)
    : null;
  const effectiveRetPct = (form.action === "מכירה" && effectivePnl !== null && previewValue !== null && (previewValue - effectivePnl) !== 0)
    ? effectivePnl / (previewValue - effectivePnl) : null;

  function startEdit(t: Trade) {
    setEditingId(t.id);
    setForm({
      date: t.date, symbol: t.symbol, action: t.action,
      qty: String(t.qty), price: String(t.price), fee: String(t.fee != null ? t.fee : -2.5),
      strategy: mapStrategyToOption(t.strategy), notes: t.notes || "",
      pnlManual: t.action === "מכירה" && t.pnl != null ? String(t.pnl) : "",
    });
    setShowForm(true);
  }
  function cancelForm() { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setTradeFormError(""); }

  function submitTrade() {
    const symbol = (form.symbol || "").trim().toUpperCase();
    const qty = parseNum(form.qty);
    const price = parseNum(form.price);
    const fee = parseNum(form.fee || "0");
    if (!symbol) { setTradeFormError("נא להזין סימול נכס."); return; }
    if (Number.isNaN(qty) || qty <= 0) { setTradeFormError("נא להזין כמות תקינה (מספר גדול מ-0)."); return; }
    if (Number.isNaN(price) || price <= 0) { setTradeFormError("נא להזין מחיר תקין (מספר גדול מ-0)."); return; }
    if (!form.date) { setTradeFormError("נא לבחור תאריך."); return; }
    pushUndoSnapshot(editingId !== null ? "עריכת עסקה" : "הוספת עסקה");
    const value = qty * price;
    let pnl: number | null = null;
    let retPct: number | null = null;
    const newLedger: Ledger = { ...ledger };

    if (form.action === "קנייה" && symbol !== "CASH") {
      const cur = newLedger[symbol] || { qty: 0, avgCost: price };
      const newQty = cur.qty + qty;
      const newAvg = newQty > 0 ? (cur.qty * cur.avgCost + qty * price) / newQty : price;
      newLedger[symbol] = { qty: newQty, avgCost: newAvg };
    } else if (form.action === "מכירה" && symbol !== "CASH") {
      const cur = newLedger[symbol] || { qty: 0, avgCost: price };
      const autoPnl = Math.round((price - cur.avgCost) * qty * 100) / 100;
      const manualNum = form.pnlManual !== "" ? parseNum(form.pnlManual) : null;
      pnl = (manualNum !== null && !Number.isNaN(manualNum)) ? manualNum : autoPnl;
      retPct = (value - pnl) !== 0 ? pnl / (value - pnl) : 0;
      newLedger[symbol] = { qty: cur.qty - qty, avgCost: cur.avgCost };
    }

    if (editingId !== null) {
      const oldTrade = trades.find((t) => t.id === editingId);
      const newTradeObj: Trade = { ...(oldTrade as Trade), date: form.date, symbol, action: form.action, qty, price, value, fee, pnl, retPct, strategy: form.strategy, notes: form.notes || null };
      applyCashDelta(cashEffect(newTradeObj) - cashEffect(oldTrade));
      setTrades((ts) => ts.map((t) => (t.id === editingId ? newTradeObj : t)));
    } else {
      const newTrade: Trade = { id: nextId.current++, date: form.date, symbol, action: form.action, qty, price, value, fee, pnl, retPct, strategy: form.strategy, notes: form.notes || null };
      applyCashDelta(cashEffect(newTrade));
      setTrades((t) => [...t, newTrade]);
    }
    setLedger(newLedger);
    cancelForm();
  }

  function deleteTrade(id: number) {
    const trade = trades.find((t) => t.id === id);
    pushUndoSnapshot("מחיקת עסקה");
    applyCashDelta(-cashEffect(trade));
    setTrades((ts) => ts.filter((t) => t.id !== id));
    setDeleteConfirmId(null);
  }

  function exportCSV() {
    const headers = ["תאריך", "נכס", "סוג פעולה", "כמות", "מחיר", "שווי כולל", "עמלה", "רווח/הפסד", "תשואה%", "אסטרטגיה", "הערות"];
    const rows = sortedTrades.map((t) => [
      t.date, t.symbol, t.action, t.qty, t.price, t.value, t.fee,
      t.pnl != null ? t.pnl : "", t.retPct != null ? (t.retPct * 100).toFixed(2) : "", t.strategy, t.notes || "",
    ]);
    const csv = "﻿" + [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trade-journal.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div dir="rtl" style={{ fontFamily: "var(--sans)", background: "var(--bg)", color: "var(--text)", minHeight: "100%", width: "100%", boxSizing: "border-box" }}>
      <style>{`
        :root {
          --bg: #0A0E13; --panel: #10161D; --panel-2: #141B23; --border: #1F2A35;
          --text: #E8EDF2; --text-dim: #8B98AB; --text-faint: #4E5A6B;
          --mono: 'SF Mono','Consolas','Roboto Mono',monospace;
          --sans: 'Segoe UI', 'Arial', sans-serif;
          --accent: #22D3A8;
        }
        * { box-sizing: border-box; }
        .idash table { border-collapse: collapse; width: 100%; }
        .idash th { text-align: right; font-size: 11.5px; color: var(--text-faint); font-weight: 600; padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px; }
        .idash td { padding: 9px 12px; font-size: 13px; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: right; vertical-align: middle; }
        .idash th.num, .idash td.num { text-align: right; }
        .idash td.num { font-family: var(--mono); direction: ltr; unicode-bidi: plaintext; }
        .idash th.center, .idash td.center { text-align: center; }
        .idash tr:hover td { background: rgba(255,255,255,0.02); }
        .idash input, .idash select, .idash textarea {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: var(--sans); width: 100%;
        }
        .idash textarea { resize: vertical; min-height: 60px; font-family: var(--sans); }
        .idash input:focus, .idash select:focus, .idash textarea:focus { outline: none; border-color: var(--accent); }
        .idash button.primary { background: var(--accent); color: #04342C; border: none; border-radius: 10px; padding: 10px 18px; font-weight: 700; font-size: 13.5px; cursor: pointer; }
        .idash button.primary:hover { background: #2EE6BA; }
        .idash button.ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); border-radius: 10px; padding: 10px 18px; font-weight: 600; font-size: 13.5px; cursor: pointer; }
        .idash button.ghost:hover { border-color: var(--text-dim); color: var(--text); }
        .idash button.icon-btn { background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 7px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .idash button.icon-btn:hover { border-color: var(--text-dim); color: var(--text); }
        .idash button.icon-btn.danger:hover { border-color: #FF8589; color: #FF8589; }
        .ticker-track { display: flex; gap: 28px; animation: ticker 32s linear infinite; white-space: nowrap; }
        .ticker-wrap:hover .ticker-track { animation-play-state: paused; }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .spin-icon { animation: spin 0.9s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .idash ::-webkit-scrollbar { height: 8px; width: 8px; }
        .idash ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        @media (max-width: 860px) {
          .idash-grid2 { grid-template-columns: 1fr !important; }
          .idash-kpis { grid-template-columns: repeat(2, 1fr) !important; }
          .idash-form-grid { grid-template-columns: 1fr 1fr !important; }
          .idash-filters { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      <div className="idash" style={{ padding: "0 0 40px" }}>

        {globalError && (
          <div style={{ background: "#7A1F24", color: "#FFD5D7", padding: "10px 20px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span>שגיאה טכנית: {globalError}</span>
            <button type="button" onClick={() => setGlobalError("")} style={{ background: "transparent", border: "1px solid #FFD5D7", color: "#FFD5D7", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12 }}>סגור</button>
          </div>
        )}

        {/* App header */}
        <div style={{
          background: "linear-gradient(180deg, #131C24 0%, #0D1319 100%)",
          borderBottom: "1px solid var(--border)", padding: "16px 20px 18px",
        }}>
          {/* Compact title row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, background: "rgba(34,211,168,0.12)",
                border: "1px solid rgba(34,211,168,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Landmark size={17} color="var(--accent)" />
              </div>
              <h1 style={{ fontSize: 16.5, fontWeight: 800, margin: 0, letterSpacing: 0.2 }}>
                ניהול סיכונים ותיק השקעות
              </h1>
            </div>
            <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
              שלום, <strong style={{ color: "var(--text-dim)" }}>{userName}</strong>
            </span>
          </div>

          {/* Single row: balances on one side, account actions on the other */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>שווי תיק כולל</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800, color: "#5BE39D" }}>{formatMoney(total, privacyMode)}</span>
              </div>
              <div style={{ width: 1, height: 20, background: "var(--border)" }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>מזומן פנוי</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800 }}>{formatMoney(cashFree, privacyMode)}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <AlertsBell
                alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
                open={alertsOpen} onToggle={toggleAlerts} onClose={() => setAlertsOpen(false)} onDismiss={dismissAlert}
              />
              <button
                type="button" className="ghost" onClick={undoLastAction} disabled={!undoSnapshot}
                title={undoSnapshot ? "בטל: " + undoSnapshot.label : "אין פעולה לביטול"}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
                  opacity: undoSnapshot ? 1 : 0.45, cursor: undoSnapshot ? "pointer" : "not-allowed",
                }}
              >
                <Undo2 size={15} /> בטל פעולה אחרונה
              </button>
              <button
                type="button" onClick={() => setPrivacyMode((v) => !v)}
                title={privacyMode ? "כבה מצב פרטיות והצג נתונים כספיים" : "הפעל מצב פרטיות - הסתרת נתונים כספיים"}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
                  borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer",
                  background: privacyMode ? "rgba(79,163,247,0.15)" : "transparent",
                  border: "1px solid " + (privacyMode ? "rgba(79,163,247,0.45)" : "var(--border)"),
                  color: privacyMode ? "#7FBBFA" : "var(--text-dim)",
                }}
              >
                {privacyMode ? <EyeOff size={15} /> : <Eye size={15} />}
                {privacyMode ? "מצב פרטיות פעיל" : "הסתר מידע רגיש"}
              </button>
              <form action={logout}>
                <button type="submit" className="ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px" }}>
                  <LogOut size={15} /> התנתקות
                </button>
              </form>
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 20px 0" }}>

          {/* Ticker */}
          <div className="ticker-wrap" style={{
            display: "flex", alignItems: "center", gap: 14,
            border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel)", padding: "10px 16px", marginBottom: 24,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", boxShadow: "0 0 0 3px rgba(34,211,168,0.18)" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: 0.4, whiteSpace: "nowrap" }}>הקצאה חיה</span>
            </div>
            <div style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
            <div style={{
              position: "relative", overflow: "hidden", flex: 1, minWidth: 0,
              WebkitMaskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
              maskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
            }}>
              <div className="ticker-track">
                {[...evaluated, ...evaluated].map((p, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 12.5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: TONE_STYLES[p.tone].text, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: "var(--text)" }}>{p.symbol}</span>
                    <span style={{ color: "var(--text-faint)" }}>{fmtPct(p.weight)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <PortfolioHealthCard health={portfolioHealth} />

          <EquityCurveCard
            data={equityChartData} total={total} ath={equityAth} returnPct={equityReturn} privacyMode={privacyMode}
            onRebuild={handleRebuildEquityHistory} rebuilding={rebuildingEquity} rebuildWarnings={equityRebuildWarnings}
            canRebuild={trades.length > 0}
          />

          <PageBanner icon={<Wallet size={20} />} title="החזקות בתיק" subtitle="כל הנכסים, המשקלים ויעדי ההקצאה במקום אחד" />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              {pricesConfigured === false
                ? "לא הוגדר מפתח API למחירים חיים. הוסף FINNHUB_API_KEY לקובץ .env.local כדי להפעיל עדכון אוטומטי."
                : lastPriceUpdate
                  ? "מחירים עודכנו לאחרונה: " + lastPriceUpdate.toLocaleTimeString("he-IL")
                  : "טוען מחירים..."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{
                display: "flex", alignItems: "center", gap: 5, fontSize: 11.5,
                color: saveStatus === "error" ? "#FF8589" : "var(--text-faint)",
              }}>
                {saveStatus === "saving" ? (
                  <><RefreshCw size={12} className="spin-icon" /> שומר...</>
                ) : saveStatus === "error" ? (
                  <>⚠ שגיאה בשמירה - ינסה שוב אוטומטית</>
                ) : (
                  <>✓ נשמר</>
                )}
              </span>
              <button type="button" className="ghost" onClick={refreshPrices} disabled={pricesLoading}
                style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={14} className={pricesLoading ? "spin-icon" : undefined} /> רענון מחירים
              </button>
            </div>
          </div>
          {priceError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(255,90,95,0.1)", border: "1px solid rgba(255,90,95,0.35)", borderRadius: 8, color: "#FF8589", fontSize: 12.5 }}>
              {priceError}
            </div>
          )}

          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, overflow: "auto", marginBottom: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>נכס</th><th className="num">כמות</th><th className="num">מחיר</th><th className="num">שווי</th>
                  <th className="num">משקל</th><th className="num">סטייה</th><th className="num">יעד מינימום</th>
                  <th className="num">יעד מקסימום</th><th className="num">רף דילול</th><th className="center">סטטוס</th>
                  <th className="center">עדיפות</th><th className="center">פעולה מומלצת</th><th className="center">ניהול</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(({ p, i }) => (
                  <tr key={p.id} style={p.symbol === "CASH" ? { background: "rgba(148,163,184,0.07)", borderTop: "1px solid var(--border)" } : undefined}>
                    <td
                      onClick={() => openDetail(p.symbol)}
                      title={p.symbol !== "CASH" ? "פתח כרטיס פרטי מניה" : undefined}
                      style={{ fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, cursor: p.symbol !== "CASH" ? "pointer" : "default" }}
                    >
                      {tradingViewUrl(p.symbol) ? (
                        <a href={tradingViewUrl(p.symbol) || undefined} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "var(--text)", textDecoration: "none", borderBottom: "1px dashed var(--text-faint)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderBottomColor = "var(--accent)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderBottomColor = "var(--text-faint)"; }}
                          title={"פתח גרף TradingView עבור " + p.symbol}>
                          {p.symbol}
                        </a>
                      ) : p.symbol}
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: colorFor(p.symbol, i), display: "inline-block", flexShrink: 0 }} />
                    </td>
                    <td className="num" style={{ color: "var(--text-dim)" }}>
                      {editingPosId === p.id ? (
                        <input type="text" inputMode="decimal" autoFocus value={posEditFields.qty} onChange={(e) => updatePosEditField("qty", e.target.value)}
                          style={{ width: 80 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
                      ) : (
                        p.qty !== null && p.qty !== undefined ? fmtNum(p.qty, p.qty % 1 !== 0 ? 2 : 0) : (p.symbol === "CASH" ? "—" : "-")
                      )}
                    </td>
                    <td className="num" style={{ color: "var(--text-dim)" }}>
                      {p.price !== null && p.price !== undefined ? formatMoney(p.price, privacyMode, { digits: 2 }) : "-"}
                      <ExtendedPriceBadge quote={extendedPrices[p.symbol]} privacyMode={privacyMode} />
                    </td>
                    <td className="num" style={{ fontWeight: p.symbol === "CASH" ? 800 : 600, color: p.symbol === "CASH" ? "var(--text)" : undefined }}>{formatMoney(p.value, privacyMode)}</td>
                    <td className="num">{fmtPct(p.weight)}</td>
                    <td className="num" style={{ color: p.dev < 0 ? "#FF8589" : p.dev > 0 ? "#5BE39D" : "var(--text-faint)" }}>{p.dev === 0 ? "0.00%" : fmtPct(p.dev)}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>
                      {editingPosId === p.id ? (
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                          <input type="text" inputMode="decimal" value={posEditFields.min} onChange={(e) => updatePosEditField("min", e.target.value)}
                            style={{ width: 50 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                        </span>
                      ) : fmtPct(p.min, 0)}
                    </td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>
                      {editingPosId === p.id ? (
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                          <input type="text" inputMode="decimal" value={posEditFields.max} onChange={(e) => updatePosEditField("max", e.target.value)}
                            style={{ width: 50 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                        </span>
                      ) : fmtPct(p.max, 0)}
                    </td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>
                      {editingPosId === p.id ? (
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                          <input type="text" inputMode="decimal" value={posEditFields.dilute} onChange={(e) => updatePosEditField("dilute", e.target.value)}
                            style={{ width: 50 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                        </span>
                      ) : fmtPct(p.dilute, 0)}
                    </td>
                    <td className="center"><Badge tone={p.tone}>{p.status}</Badge></td>
                    <td className="center"><Badge tone={p.priority === "גבוהה" ? "red" : p.priority === "בינונית" ? "amber" : "green"}>{p.priority}</Badge></td>
                    <td className="center">
                      <span style={{
                        display: "inline-block", fontWeight: 700, fontSize: 12.5,
                        color: TONE_STYLES[p.tone].text, background: TONE_STYLES[p.tone].bg,
                        border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: 8,
                        padding: "5px 10px", whiteSpace: "nowrap",
                      }}>{p.action}</span>
                    </td>
                    <td className="center">
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                        {editingPosId === p.id ? (
                          <>
                            <button type="button" className="icon-btn" onClick={() => savePosQty(p)} aria-label="שמור" title="שמור"><Check size={13} /></button>
                            <button type="button" className="icon-btn" onClick={cancelPosEdit} aria-label="ביטול" title="ביטול"><X size={13} /></button>
                          </>
                        ) : (
                          <button type="button" className="icon-btn" onClick={() => startEditPosQty(p)} aria-label="ערוך כמות ויעדים" title="ערוך כמות ויעדי הקצאה"><Pencil size={13} /></button>
                        )}
                        {p.symbol === "CASH" ? (
                          <span style={{ color: "var(--text-faint)", display: "inline-flex", alignItems: "center", padding: "0 4px" }} title="שורת המזומן מסונכרנת עם יומן המסחר ולא ניתנת להסרה">🔒</span>
                        ) : deletePosConfirmId === p.id ? (
                          <>
                            <button type="button" onClick={() => deletePosition(p.id)} style={{ background: "rgba(255,90,95,0.15)", border: "1px solid rgba(255,90,95,0.4)", color: "#FF8589", borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Check size={12} /> אישור</button>
                            <button type="button" onClick={() => setDeletePosConfirmId(null)} className="icon-btn" aria-label="ביטול" title="ביטול"><X size={13} /></button>
                          </>
                        ) : (
                          <button type="button" className="icon-btn danger" onClick={() => setDeletePosConfirmId(p.id)} aria-label="הסר נכס" title="הסר נכס"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {evaluated.length === 0 && (
                  <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>אין החזקות בתיק עדיין. הוסף נכס ראשון למטה.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--panel-2)" }}>
                  <td colSpan={3} style={{ fontWeight: 800, fontSize: 14.5, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "13px 12px" }}>סך הכל התיק</td>
                  <td className="num" style={{ fontWeight: 800, fontSize: 15.5, color: "#5BE39D", borderBottom: "none", borderTop: "1px solid var(--border)", padding: "13px 12px" }}>{formatMoney(total, privacyMode)}</td>
                  <td className="num" style={{ fontWeight: 800, fontSize: 14.5, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "13px 12px" }}>100.0%</td>
                  <td colSpan={8} style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 20 }}>
            לחיצה על העיפרון בכל שורה מאפשרת לערוך כמות ויעדי הקצאה (מינימום/מקסימום/רף דילול) לכל נכס.
          </div>

          <div style={{ marginBottom: 20 }}>
            {showAddPosition ? (
              <div style={{ background: "var(--panel)", border: "1px solid rgba(34,211,168,0.4)", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <Plus size={15} color="var(--accent)" /> הוספת נכס חדש לתיק
                  </div>
                  <button type="button" className="icon-btn" onClick={() => { setShowAddPosition(false); setPosForm(EMPTY_POSITION_FORM); setPosFormError(""); }}><X size={15} /></button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }} className="idash-form-grid">
                  <Field label="סימול">
                    <input type="text" value={posForm.symbol} onChange={(e) => updatePosForm("symbol", e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder="לדוגמה: AAPL" />
                  </Field>
                  <Field label="כמות יחידות">
                    <input type="text" inputMode="decimal" value={posForm.qty} onChange={(e) => updatePosForm("qty", e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder="0" />
                  </Field>
                  <Field label="מחיר ליחידה $">
                    <input type="text" inputMode="decimal" value={posForm.price} onChange={(e) => updatePosForm("price", e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder="0.00" />
                  </Field>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button type="button" onClick={submitNewPosition} className="primary" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Check size={15} /> הוסף לתיק</button>
                  </div>
                </div>
                {posFormError && (
                  <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,90,95,0.1)", border: "1px solid rgba(255,90,95,0.35)", borderRadius: 8, color: "#FF8589", fontSize: 12.5 }}>
                    {posFormError}
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-faint)" }}>
                  שווי יחושב אוטומטית (כמות × מחיר) והמשקלים בתיק יתעדכנו בהתאם. יעדי הקצאה לנכס חדש יוגדרו כברירת מחדל וניתן יהיה לעדכן בהמשך.
                </div>
              </div>
            ) : (
              <button
                type="button" className="primary" onClick={() => setShowAddPosition(true)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 22px", fontSize: 14, boxShadow: "0 6px 18px rgba(34,211,168,0.35)" }}
              >
                <Plus size={16} /> הוסף נכס לתיק
              </button>
            )}
          </div>

          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 30, maxWidth: 640, marginRight: "auto", marginLeft: "auto" }}>
            <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 700, marginBottom: 16, textAlign: "center" }}>הקצאת נכסים</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 auto", width: 210, height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={95} paddingAngle={2}
                      onClick={(data) => openDetail(String(data.name))}>
                      {pieData.map((p, i) => (
                        <Cell key={p.name} fill={colorFor(p.name, i)} stroke="var(--panel)" strokeWidth={2}
                          style={{ cursor: p.name !== "CASH" ? "pointer" : "default" }} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(val, name) => [formatMoney(Number(val), privacyMode), String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: "0 1 260px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px" }}>
                {pieData.map((p, i) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: colorFor(p.name, i), flexShrink: 0 }} />
                    <span style={{ color: "var(--text-dim)" }}>{p.name}</span>
                    <span style={{ marginRight: "auto", fontFamily: "var(--mono)", color: "var(--text)", fontWeight: 600 }}>{fmtPct(p.weight)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <SectionTitle icon={<ShieldCheck size={16} />} text="המלצות Position Sizing" />
          <div style={{ marginBottom: 34 }}>
            {needsAction.length === 0 ? (
              <div style={{ background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.3)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 10, color: "#5BE39D", fontSize: 13.5 }}>
                <ShieldCheck size={18} /> כל הנכסים במשקל היעד – אין פעולות נדרשות כרגע.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {needsAction.map((p) => (
                  <div key={p.symbol} style={{ background: "var(--panel)", border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: 14, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{p.symbol}</span>
                      <Badge tone={p.tone}><AlertTriangle size={12} />{p.priority}</Badge>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 6 }}>{p.status} · משקל נוכחי: {fmtPct(p.weight)}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: TONE_STYLES[p.tone].text }}>{p.action}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trade journal banner */}
          <PageBanner icon={<ListChecks size={20} />} title="יומן מסחר חכם ומקצועי (Smart Trade Log)" subtitle="כל העסקאות, הסיכומים והפעולות במקום אחד" />

          <div className="idash-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginBottom: 22 }}>
            <Card label="מזומן פנוי" value={formatMoney(cashFree, privacyMode)} icon={<Wallet size={15} color="#8B98AB" />} />
            <Card label="רווח/הפסד ממומש" value={formatMoney(stats.realizedPnl, privacyMode)} tone={stats.realizedPnl >= 0 ? "green" : "red"} icon={stats.realizedPnl >= 0 ? <TrendingUp size={15} color="#5BE39D" /> : <TrendingDown size={15} color="#FF8589" />} />
            <Card label="אחוז הצלחה" value={fmtPct(stats.winRate)} sub={stats.sellCount + " עסקאות מכירה"} icon={<Percent size={15} color="#8B98AB" />} />
            <Card label="מספר עסקאות" value={fmtNum(stats.buysSells)} sub={trades.length + " שורות כולל"} icon={<Activity size={15} color="#8B98AB" />} />
            <Card label="סך עמלות" value={formatMoney(stats.fees, privacyMode)} tone="red" icon={<Receipt size={15} color="#FF8589" />} />
            <Card label="ממוצע רווח לעסקה" value={formatMoney(stats.avgPnl, privacyMode)} tone={stats.avgPnl >= 0 ? "green" : "red"} sub={fmtPct(stats.avgRet) + " תשואה ממוצעת"} icon={stats.avgPnl >= 0 ? <TrendingUp size={15} color="#5BE39D" /> : <TrendingDown size={15} color="#FF8589" />} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                ref={fileInputRef} type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                style={{ display: "none" }} onChange={handleFileSelected}
              />
              <button className="ghost" onClick={() => fileInputRef.current?.click()} disabled={importLoading}
                style={{ display: "flex", alignItems: "center", gap: 6, opacity: importLoading ? 0.6 : 1 }}>
                {importLoading ? <RefreshCw size={15} className="spin-icon" /> : <Upload size={15} />}
                {importLoading ? "טוען קובץ..." : "העלאת קובץ עסקאות (CSV / Excel)"}
              </button>
              <button className="ghost" onClick={exportCSV} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Download size={15} /> ייצוא CSV
              </button>
              <button className="primary" onClick={() => { if (showForm && editingId === null) { cancelForm(); } else { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); } }} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Plus size={15} /> {showForm && editingId === null ? "סגור טופס" : "הוסף עסקה"}
              </button>
            </div>
          </div>

          {showForm && (
            <div style={{ background: "var(--panel)", border: "1px solid " + (editingId !== null ? "rgba(79,163,247,0.4)" : "var(--border)"), borderRadius: 14, padding: 18, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 8 }}>
                  {editingId !== null ? <Pencil size={15} color="#7FBBFA" /> : <Plus size={15} color="var(--accent)" />}
                  {editingId !== null ? "עריכת עסקה" : "עסקה חדשה"}
                </div>
                <button type="button" className="icon-btn" onClick={cancelForm}><X size={15} /></button>
              </div>
              <div className="idash-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <Field label="תאריך"><input type="date" value={form.date} onChange={(e) => updateForm("date", e.target.value)} /></Field>
                <Field label="נכס / סימול">
                  <input type="text" list="symbol-suggestions" value={form.symbol} onChange={(e) => updateForm("symbol", e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") submitTrade(); }} placeholder="הקלד או בחר סימול" />
                  <datalist id="symbol-suggestions">{symbolSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
                </Field>
                <Field label="סוג פעולה">
                  <select value={form.action} onChange={(e) => {
                    const newAction = e.target.value;
                    updateForm("action", newAction);
                    if (newAction === "הפקדה" && (form.fee === "-2.5" || form.fee === "")) updateForm("fee", "0");
                    if (newAction !== "הפקדה" && form.fee === "0") updateForm("fee", "-2.5");
                  }}>
                    {ACTION_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="כמות יחידות"><input type="text" inputMode="decimal" value={form.qty} onChange={(e) => updateForm("qty", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitTrade(); }} placeholder="0" /></Field>
                <Field label="מחיר ליחידה $"><input type="text" inputMode="decimal" value={form.price} onChange={(e) => updateForm("price", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitTrade(); }} placeholder="0.00" /></Field>
                <Field label="עמלה $"><input type="text" inputMode="decimal" value={form.fee} onChange={(e) => updateForm("fee", e.target.value)} /></Field>
                {form.action === "מכירה" && (
                  <Field label="רווח/הפסד ממומש $ (ידני)">
                    <input type="text" inputMode="decimal" value={form.pnlManual} onChange={(e) => updateForm("pnlManual", e.target.value)}
                      placeholder={previewAutoPnl !== null ? fmtUSD(previewAutoPnl) : "לדוגמה: 250"} />
                  </Field>
                )}
                <Field label="אסטרטגיה / סיבה">
                  <select value={form.strategy} onChange={(e) => updateForm("strategy", e.target.value)}>
                    {STRATEGY_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <div style={{ gridColumn: "span 2" }}>
                  <Field label="הערות"><textarea value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} placeholder="פרטים נוספים, סיבה, הקשר..." /></Field>
                </div>
              </div>

              <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>שווי כולל משוער</div>
                  <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{previewValue !== null ? fmtUSD(previewValue) : "-"}</div>
                </div>
                {form.action === "מכירה" && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>רווח/הפסד ממומש {form.pnlManual !== "" ? "(ידני)" : "(מוצע אוטומטית)"}</div>
                    <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: effectivePnl == null ? "var(--text)" : effectivePnl >= 0 ? "#5BE39D" : "#FF8589" }}>{effectivePnl !== null ? fmtUSD(effectivePnl) : "-"}</div>
                  </div>
                )}
                {form.action === "מכירה" && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>אחוז ממומש מהעסקה</div>
                    <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: effectiveRetPct == null ? "var(--text)" : effectiveRetPct >= 0 ? "#5BE39D" : "#FF8589" }}>{effectiveRetPct !== null ? fmtPct(effectiveRetPct) : "-"}</div>
                  </div>
                )}
                {previewAvgCost !== null && form.action === "מכירה" && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>עלות ממוצעת נוכחית (למעקב בלבד)</div>
                    <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{fmtUSD(previewAvgCost, { digits: 2 })}</div>
                  </div>
                )}
              </div>

              {tradeFormError && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(255,90,95,0.1)", border: "1px solid rgba(255,90,95,0.35)", borderRadius: 8, color: "#FF8589", fontSize: 12.5 }}>
                  {tradeFormError}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button type="button" onClick={submitTrade} className="primary" style={{ display: "flex", alignItems: "center", gap: 6 }}><Check size={15} /> {editingId !== null ? "עדכן עסקה" : "שמור עסקה"}</button>
                <button type="button" className="ghost" onClick={cancelForm}>ביטול</button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="idash-filters" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 14, alignItems: "end" }}>
            <Field label={<span style={{ display: "flex", alignItems: "center", gap: 5 }}><Filter size={12} />סינון לפי נכס</span>}>
              <select value={fSymbol} onChange={(e) => setFSymbol(e.target.value)}>
                <option value="הכל">כל הנכסים</option>
                {symbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="סוג פעולה">
              <select value={fAction} onChange={(e) => setFAction(e.target.value)}>
                <option value="הכל">כל הפעולות</option>
                {ACTION_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="מתאריך"><input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></Field>
            <Field label="עד תאריך"><input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} /></Field>
            <button type="button" className="ghost" onClick={() => { setFSymbol("הכל"); setFAction("הכל"); setFFrom(""); setFTo(""); }}>נקה סינון</button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>מציג {sortedTrades.length} מתוך {trades.length} עסקאות</div>

          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, overflow: "auto", maxHeight: 480 }}>
            <table>
              <thead style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}>
                <tr>
                  <th className="num">תאריך</th><th>נכס</th><th className="center">פעולה</th><th className="num">כמות</th>
                  <th className="num">מחיר</th><th className="num">שווי כולל</th><th className="num">עמלה</th>
                  <th className="num">רווח/הפסד</th><th className="num">תשואה%</th><th>אסטרטגיה</th><th>הערות</th><th className="center">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrades.map((t) => (
                  <tr key={t.id} style={deleteConfirmId === t.id ? { background: "rgba(255,90,95,0.06)" } : undefined}>
                    <td className="num" style={{ color: "var(--text-dim)" }}>{t.date}</td>
                    <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                    <td className="center"><ActionBadge action={t.action} /></td>
                    <td className="num">{fmtNum(t.qty, t.qty % 1 !== 0 ? 2 : 0)}</td>
                    <td className="num">{formatMoney(t.price, privacyMode, { digits: 2 })}</td>
                    <td className="num">{formatMoney(t.value, privacyMode)}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>{formatMoney(t.fee, privacyMode)}</td>
                    <td className="num" style={{ fontWeight: 600, color: t.pnl == null ? "var(--text-faint)" : t.pnl >= 0 ? "#5BE39D" : "#FF8589" }}>{t.pnl == null ? "-" : formatMoney(t.pnl, privacyMode)}</td>
                    <td className="num" style={{ color: t.retPct == null ? "var(--text-faint)" : t.retPct >= 0 ? "#5BE39D" : "#FF8589" }}>{t.retPct == null ? "-" : fmtPct(t.retPct)}</td>
                    <td style={{ color: "var(--text-dim)" }}>{t.strategy}</td>
                    <td style={{ color: "var(--text-faint)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.notes || ""}>{t.notes || "-"}</td>
                    <td className="center">
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                        <button type="button" className="icon-btn" onClick={() => startEdit(t)} aria-label="עריכה" title="עריכה"><Pencil size={13} /></button>
                        {deleteConfirmId === t.id ? (
                          <>
                            <button type="button" onClick={() => deleteTrade(t.id)} style={{ background: "rgba(255,90,95,0.15)", border: "1px solid rgba(255,90,95,0.4)", color: "#FF8589", borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Check size={12} /> אישור</button>
                            <button type="button" className="icon-btn" onClick={() => setDeleteConfirmId(null)} aria-label="ביטול" title="ביטול"><X size={13} /></button>
                          </>
                        ) : (
                          <button type="button" className="icon-btn danger" onClick={() => setDeleteConfirmId(t.id)} aria-label="מחיקה" title="מחיקה"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedTrades.length === 0 && (
                  <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>לא נמצאו עסקאות תואמות לסינון</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 11.5 }}>
            כל הנתונים מבוססים על קובץ האקסל שהועלה · החישובים מתעדכנים אוטומטית עם כל עסקה שנוספה, נערכת או נמחקת
          </div>

          <div style={{ marginTop: 34 }}>
            <PortfolioSummaryCard lines={portfolioSummary} />
          </div>
        </div>
      </div>

      <StockDetailDrawer
        symbol={detailSymbol}
        position={positions.find((p) => p.symbol === detailSymbol)}
        colorIndex={Math.max(0, evaluated.findIndex((p) => p.symbol === detailSymbol))}
        privacyMode={privacyMode}
        onClose={() => setDetailSymbol(null)}
      />

      {importResult && (
        <TradeImportModal
          result={importResult}
          fileName={importFileName}
          onConfirm={confirmImport}
          onClose={closeImportModal}
        />
      )}
    </div>
  );
}

interface PortfolioHealthData {
  score: number;
  tone: Tone;
  diversification: "טוב" | "בינוני" | "חלש";
  risk: "תקין" | "גבוה" | "נמוך";
  cashPct: number;
  cashTone: Tone;
  needsStrengthen: EvaluatedPosition[];
  weightBreaches: EvaluatedPosition[];
}

function AlertsBell({
  alerts, unseenCount, seenIds, open, onToggle, onClose, onDismiss,
}: {
  alerts: Alert[]; unseenCount: number; seenIds: Set<string>;
  open: boolean; onToggle: () => void; onClose: () => void; onDismiss: (id: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button" className="ghost" onClick={onToggle}
        title="התראות"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "9px 12px" }}
      >
        <Bell size={15} />
        {unseenCount > 0 && (
          <span style={{
            position: "absolute", top: -5, left: -5, minWidth: 16, height: 16, borderRadius: 999,
            background: "#FF5A5F", color: "#fff", fontSize: 10, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
          }}>
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0, width: 340, maxWidth: "90vw",
            maxHeight: 420, overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 12, zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
          }}>
            <div style={{
              padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13.5,
              display: "flex", alignItems: "center", gap: 8, color: "var(--text)",
            }}>
              <Bell size={14} color="var(--accent)" /> התראות{alerts.length > 0 ? " (" + alerts.length + ")" : ""}
            </div>

            {alerts.length === 0 ? (
              <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 }}>
                ✅ אין התראות שדורשות תשומת לב כרגע.
              </div>
            ) : (
              alerts.map((a) => {
                const s = TONE_STYLES[a.tone];
                const isNew = !seenIds.has(a.id);
                return (
                  <div key={a.id} style={{
                    padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 9, alignItems: "flex-start",
                    background: isNew ? "rgba(34,211,168,0.04)" : "transparent",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, flexShrink: 0, background: s.text }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{a.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.4 }}>{a.message}</div>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => onDismiss(a.id)} title="סגור התראה" aria-label="סגור התראה">
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HealthChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const s = TONE_STYLES[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5,
      background: s.bg, border: "1px solid " + s.border, borderRadius: 8, padding: "5px 10px", whiteSpace: "nowrap",
    }}>
      <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>{label}:</span>
      <span style={{ color: s.text, fontWeight: 700 }}>{value}</span>
    </span>
  );
}

function PortfolioHealthCard({ health }: { health: PortfolioHealthData }) {
  const s = TONE_STYLES[health.tone];
  const toneIcon = health.tone === "green" ? "🟢" : health.tone === "amber" ? "🟡" : "🔴";
  const riskTone: Tone = health.risk === "תקין" ? "green" : health.risk === "גבוה" ? "red" : "blue";
  const diversificationTone: Tone = health.diversification === "טוב" ? "green" : health.diversification === "בינוני" ? "amber" : "red";

  return (
    <div style={{
      background: s.bg, border: "1px solid " + s.border, borderRadius: 14,
      padding: "16px 20px", marginBottom: 22, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>
          <span>{toneIcon}</span> בריאות התיק
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800, color: s.text }}>
          ציון: {health.score}/100
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <HealthChip label="פיזור" value={health.diversification} tone={diversificationTone} />
        <HealthChip label="סיכון" value={health.risk} tone={riskTone} />
        <HealthChip label="Cash" value={fmtPct(health.cashPct)} tone={health.cashTone} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
        <div>
          <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>צריך לחזק: </span>
          <span style={{ color: "var(--text)" }}>
            {health.needsStrengthen.length > 0 ? health.needsStrengthen.map((p) => p.symbol).join(", ") : "אין נכסים מתחת ליעד"}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>חריגות משקל: </span>
          <span style={{ color: health.weightBreaches.length > 0 ? "#FF8589" : "var(--text)" }}>
            {health.weightBreaches.length > 0 ? health.weightBreaches.map((p) => p.symbol).join(", ") : "אין חריגות משקל"}
          </span>
        </div>
      </div>
    </div>
  );
}

function EquityCurveCard({
  data, total, ath, returnPct, privacyMode, onRebuild, rebuilding, rebuildWarnings, canRebuild,
}: {
  data: EquityPoint[]; total: number; ath: number; returnPct: number | null; privacyMode: boolean;
  onRebuild: () => void; rebuilding: boolean; rebuildWarnings: string[]; canRebuild: boolean;
}) {
  const tone: Tone = returnPct === null ? "blue" : returnPct >= 0 ? "green" : "red";
  const s = TONE_STYLES[tone];

  // Recharts' Area only draws a curve/fill once there are 2+ points, and a
  // single point can also get swallowed by its default entrance animation -
  // so for a brand-new history (or a still-degenerate value range) we render
  // an explicit "first point recorded today" state instead of an empty chart.
  const values = data.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const hasRange = data.length >= 2 && rawMax > rawMin;
  const padding = hasRange ? Math.max((rawMax - rawMin) * 0.12, rawMax * 0.01, 1) : 0;
  const yDomain: [number, number] = [rawMin - padding, rawMax + padding];

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>
          <TrendingUp size={16} color="var(--accent)" /> התפתחות התיק
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{formatMoney(total, privacyMode)}</span>
          {returnPct !== null && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: s.text }}>
              {returnPct >= 0 ? "+" : ""}{fmtPct(returnPct)} מצטבר
            </span>
          )}
          <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>שיא (ATH): {formatMoney(ath, privacyMode)}</span>
          {canRebuild && (
            <button type="button" className="ghost" onClick={onRebuild} disabled={rebuilding}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11.5 }}>
              <RefreshCw size={12} className={rebuilding ? "spin-icon" : undefined} />
              {rebuilding ? "משחזר..." : "שחזור היסטוריה מיומן המסחר"}
            </button>
          )}
        </div>
      </div>

      <div style={{ width: "100%", height: 160 }}>
        {hasRange ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis domain={yDomain} hide />
              <ReferenceLine y={ath} stroke="var(--text-faint)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(label) => String(label)}
                formatter={(val) => [formatMoney(Number(val), privacyMode), "שווי"]}
              />
              <Area
                type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#equityFill)"
                dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--accent)", boxShadow: "0 0 0 4px rgba(34,211,168,0.15)" }} />
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>נקודת המדידה הראשונה נרשמה היום</span>
          </div>
        )}
      </div>

      {!hasRange && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-faint)" }}>
          המערכת שומרת נקודת שווי יומית - הגרף יתמלא בהדרגה ככל שיעברו ימים
          {canRebuild ? ", או לחץ \"שחזור היסטוריה מיומן המסחר\" כדי למלא אותו מיד לפי עסקאות העבר." : "."}
        </div>
      )}

      {rebuildWarnings.length > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(242,169,59,0.1)", border: "1px solid rgba(242,169,59,0.35)", borderRadius: 8, color: "#F5BE6B", fontSize: 11.5 }}>
          {rebuildWarnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
    </div>
  );
}

function PortfolioSummaryCard({ lines }: { lines: string[] }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14,
      padding: "16px 20px", marginBottom: 22, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>
        <FileText size={16} color="var(--accent)" /> סיכום התיק
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
            <span style={{ color: "var(--text-dim)" }}>{line}</span>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 11, color: "var(--text-faint)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        סיכום אוטומטי על בסיס נתוני המערכת בלבד · לא ייעוץ השקעות
      </div>
    </div>
  );
}

function PageBanner({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{
      background: "linear-gradient(90deg, rgba(34,211,168,0.16) 0%, rgba(34,211,168,0.03) 100%)",
      border: "1px solid rgba(34,211,168,0.35)", borderRight: "5px solid var(--accent)",
      borderRadius: 12, padding: "20px 24px", marginBottom: 22,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{
        color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
        width: 40, height: 40, borderRadius: 10, background: "rgba(34,211,168,0.15)", flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 23, fontWeight: 800, color: "var(--text)", letterSpacing: 0.2, lineHeight: 1.25 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4, letterSpacing: 0.4 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
      <span style={{ color: "var(--accent)", display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}
