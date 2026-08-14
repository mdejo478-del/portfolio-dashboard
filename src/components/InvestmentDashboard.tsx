"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { AlertCircle } from "lucide-react";
import { savePortfolioAction, rebuildEquityHistoryAction, backupNowAction, ackAlertsAction } from "@/app/actions/portfolio";
import { getPricesAction } from "@/app/actions/prices";
import { getMorningBriefAction, type MorningBriefResult } from "@/app/actions/morningBrief";
import type { ExtendedQuote } from "@/lib/prices";
import type { Position, Trade, Ledger, PortfolioData, EquityPoint, AlertAck, HealthScoreAck } from "@/lib/portfolio";
import { ALERT_RULES, isNewOccurrence, priceTargetSide, isPriceTargetNewOccurrence } from "@/lib/alertRules";
import StockDetailDrawer from "@/components/StockDetailDrawer";

import type { Tone, EvaluatedPosition, Alert, UndoSnapshot } from "@/components/dashboard/types";
import { TONE_STYLES, PRICE_REFRESH_INTERVAL_MS } from "@/components/dashboard/constants";
import { fmtPct, formatMoney } from "@/components/dashboard/format";
import { evaluatePosition } from "@/components/dashboard/evaluatePosition";
import { computeBigMovers } from "@/components/dashboard/morningBriefUtils";
import { computePortfolioHealth } from "@/lib/portfolioHealth";
import { Header } from "@/components/dashboard/Header";
import { HoldingsSection } from "@/components/dashboard/HoldingsSection";
import { MorningBriefDrawer } from "@/components/dashboard/MorningBriefDrawer";
import { TradeJournalSection } from "@/components/dashboard/TradeJournalSection";
import { PortfolioHealthCard } from "@/components/dashboard/PortfolioHealthCard";
import { EquityCurveCard } from "@/components/dashboard/EquityCurveCard";
import { PortfolioSummaryCard } from "@/components/dashboard/PortfolioSummaryCard";

// Errors we throw ourselves (validation messages, rate limits, "session
// expired", etc.) are already clear Hebrew sentences - safe to show as-is.
// Anything else (network failures, unexpected server/runtime errors) is
// usually raw English and would read like a stack trace to the user, so it
// falls back to a friendly, context-specific message instead.
function toUserMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return /[֐-׿]/.test(raw) ? raw : fallback;
}

interface InvestmentDashboardProps {
  userName: string;
  initialPositions: Position[];
  initialTrades: Trade[];
  initialLedger: Ledger;
  initialNextPositionId: number;
  initialNextTradeId: number;
  initialEquityHistory: EquityPoint[];
  initialAlertAcks: Record<string, AlertAck>;
  initialHealthScoreAck?: HealthScoreAck;
  initialCashIdleSince: string | null;
}

export default function InvestmentDashboard({
  userName,
  initialPositions,
  initialTrades,
  initialLedger,
  initialNextPositionId,
  initialNextTradeId,
  initialEquityHistory,
  initialAlertAcks,
  initialHealthScoreAck,
  initialCashIdleSince,
}: InvestmentDashboardProps) {
  const [privacyMode, setPrivacyMode] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string>("");
  useEffect(() => {
    const fallback = "אירעה שגיאה בלתי צפויה. נסה לרענן את הדף.";
    function onError(e: ErrorEvent) { setGlobalError(toUserMessage(e && e.message, fallback)); }
    function onRejection(e: PromiseRejectionEvent) { setGlobalError(toUserMessage(e && e.reason && e.reason.message, fallback)); }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const [positions, setPositions] = useState<Position[]>(initialPositions);
  const nextPosId = useRef<number>(initialNextPositionId);

  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const nextId = useRef<number>(initialNextTradeId);
  const [ledger, setLedger] = useState<Ledger>(initialLedger);

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
          const message = err instanceof Error ? err.message : String(err);
          setSaveStatus("error");
          if (message === "SESSION_EXPIRED") {
            // A generic "retry automatically" error is actively misleading here -
            // every retry against a dead session will fail the same way, so the
            // user needs to actually re-authenticate, not wait. Force a real
            // navigation instead of relying on the server action's own redirect,
            // which doesn't reliably reach the client from this non-form call.
            setGlobalError("ההתחברות פגה - מעביר אותך להתחברות מחדש כדי שהשינויים האחרונים לא יאבדו.");
            window.location.assign("/login");
            return;
          }
          setGlobalError(toUserMessage(err, "השמירה נכשלה. נסה שוב."));
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

  // Warn before closing/navigating away while a save is still in flight or
  // has failed - otherwise the tab can be closed right after an edit and the
  // change silently never reaches disk, with no chance to notice or retry.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (saveInFlight.current || savePending.current || saveStatus === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  const [backupRunning, setBackupRunning] = useState<boolean>(false);
  const [backupDoneAt, setBackupDoneAt] = useState<number | null>(null);
  useEffect(() => {
    if (backupDoneAt === null) return;
    const t = setTimeout(() => setBackupDoneAt(null), 4000);
    return () => clearTimeout(t);
  }, [backupDoneAt]);

  async function handleBackupNow() {
    setBackupRunning(true);
    try {
      const result = await backupNowAction();
      setBackupDoneAt(result.createdAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "SESSION_EXPIRED") {
        setGlobalError("ההתחברות פגה - מעביר אותך להתחברות מחדש.");
        window.location.assign("/login");
        return;
      }
      setGlobalError(toUserMessage(err, "יצירת הגיבוי נכשלה. נסה שוב."));
    } finally {
      setBackupRunning(false);
    }
  }

  const [pricesConfigured, setPricesConfigured] = useState<boolean | null>(null);
  const [pricesLoading, setPricesLoading] = useState<boolean>(false);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceError, setPriceError] = useState<string>("");
  const [extendedPrices, setExtendedPrices] = useState<Record<string, ExtendedQuote | null>>({});
  // Day-over-day % change per symbol, straight from Finnhub's quote response
  // (`dp`) - captured here rather than with a second per-symbol fetch, since
  // the single-day-drop alert (#6) only needs the number the price refresh
  // already receives.
  const [dayChangePct, setDayChangePct] = useState<Record<string, number | null>>({});

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
        setDayChangePct(result.dayChangePct);
        setLastPriceUpdate(new Date());
      }
    } catch {
      setPriceError("לא הצלחנו לעדכן מחירים כרגע. ננסה שוב אוטומטית.");
    } finally {
      setPricesLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount, then poll - the canonical data-fetching Effect.
    // refreshPrices sets loading/error state synchronously before its first
    // await, which is exactly what it should do (show a loading state right
    // away rather than waiting a tick), so it doesn't fit the "avoid
    // setState in an Effect" guidance the linter defaults to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPrices();
    const interval = setInterval(refreshPrices, PRICE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  function openDetail(symbol: string) { if (symbol !== "CASH") setDetailSymbol(symbol); }

  // Morning Brief: fetched once on load, not polled - it's a daily-cadence
  // digest (cached earnings/news server-side, see dailySnapshot.ts), not a
  // live feed like the price refresh below.
  const [morningBrief, setMorningBrief] = useState<MorningBriefResult | null>(null);
  const [morningBriefLoading, setMorningBriefLoading] = useState<boolean>(true);
  const [morningBriefError, setMorningBriefError] = useState<string>("");
  const [briefDrawerOpen, setBriefDrawerOpen] = useState<boolean>(false);
  // Derived from dayChangePct (already fetched by the price-refresh cycle
  // above) instead of Morning Brief issuing its own separate quote fetch for
  // the same symbols - see the comment on getMorningBriefAction.
  const bigMovers = useMemo(() => computeBigMovers(positions, dayChangePct), [positions, dayChangePct]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMorningBriefAction();
        if (!cancelled) setMorningBrief(result);
      } catch {
        if (!cancelled) setMorningBriefError("לא הצלחנו לטעון את ה-Morning Brief כרגע.");
      } finally {
        if (!cancelled) setMorningBriefLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const total = useMemo(() => positions.reduce((a, p) => a + p.value, 0), [positions]);
  const evaluated = useMemo<EvaluatedPosition[]>(() => positions.map((p) => ({ ...p, ...evaluatePosition(p, total, privacyMode) })), [positions, total, privacyMode]);

  // Portfolio Health: a quick-glance score built from the same status/weight
  // rules already used per-position, just rolled up into one summary. The
  // formula itself lives in a shared module (src/lib/portfolioHealth.ts) so
  // the server-side daily snapshot job can compute the same score.
  const portfolioHealth = useMemo(() => computePortfolioHealth(evaluated), [evaluated]);

  // Equity curve: the server keeps one snapshot per day (see savePortfolio),
  // returned as initialEquityHistory. Here we additionally overlay today's
  // live total so the chart's last point stays current between saves,
  // without waiting for a round-trip to the server. equityHistoryOverride
  // holds a freshly rebuilt-from-trades series after the user triggers a
  // rebuild, without needing a full page reload. Lives above the alerts
  // block below since the ATH-drawdown alert (#3) needs equityAth.
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
      const message = err instanceof Error ? err.message : String(err);
      if (message === "SESSION_EXPIRED") {
        setGlobalError("ההתחברות פגה - מעביר אותך להתחברות מחדש.");
        window.location.assign("/login");
        return;
      }
      setGlobalError(toUserMessage(err, "שחזור ההיסטוריה נכשל. נסה שוב."));
    } finally {
      setRebuildingEquity(false);
    }
  }

  // Drawdown from the portfolio's all-time high (negative while below it, 0
  // at a fresh high) - feeds alert #3.
  const athDrawdownPct = useMemo(() => (equityAth > 0 ? (total - equityAth) / equityAth : 0), [total, equityAth]);

  // What the user has already been shown, per-alert-occurrence - persisted
  // server-side (data/portfolios/<userId>.json) rather than localStorage, so
  // it survives a reload, a different device, or a fresh login instead of
  // either repeating every time or (the previous bug) staying silently
  // suppressed forever once a worsening condition was dismissed once.
  const [alertAcksState, setAlertAcksState] = useState<Record<string, AlertAck>>(initialAlertAcks);
  const [healthScoreAckState, setHealthScoreAckState] = useState<HealthScoreAck | undefined>(initialHealthScoreAck);

  // Cash-idle tracking (#4): mirrors the exact rule the server applies in
  // savePortfolio/dailySnapshot (cash weight over its own max target),
  // recomputed live here so crossing the threshold mid-session (a big
  // deposit, or other positions dropping in value) is reflected immediately
  // instead of waiting for the next save/daily check. The server remains
  // the source of truth for what's actually persisted; this is a client
  // mirror so "how many days idle" doesn't need a round-trip to compute.
  const [cashIdleSince, setCashIdleSince] = useState<string | null>(initialCashIdleSince);
  useEffect(() => {
    // Genuinely needs to be an Effect, not a derived/render-time value: it
    // remembers *when* cash first crossed its threshold, which isn't
    // something the current evaluated[] snapshot alone can tell you - only
    // "is it over threshold right now" is derivable from props, "since
    // when" requires carrying state forward across renders.
    const cashPos = evaluated.find((p) => p.symbol === "CASH");
    const overThreshold = Boolean(cashPos && cashPos.weight > cashPos.max);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCashIdleSince((prev) => (overThreshold ? (prev ?? new Date().toISOString().slice(0, 10)) : null));
  }, [evaluated]);

  // Alerts: only conditions that genuinely need attention. Two shapes:
  //  - Persistent conditions (weight deviation #2, ATH drawdown #3, the
  //    aggregate rebalance recommendation) stay listed for as long as the
  //    underlying condition holds, whether or not they're "new" - opening
  //    the bell or dismissing one only clears its new/unseen highlight, via
  //    a server-persisted ack (alertAcksState, survives reload/device) that
  //    re-arms once the tracked value has moved at least the type's rearm
  //    step away from what was last acknowledged - not on every tiny wiggle,
  //    but also not suppressed forever while things keep getting worse (the
  //    bug the old localStorage id-only dedup had).
  //  - Event alerts (price target crossed #1, idle cash #4, single-day drop
  //    #6, the "on target" callout) are one-time notices: they only appear
  //    while unacknowledged for their current occurrence, and disappear
  //    once acked - reappearing only on a genuinely new event (price
  //    crosses again, cash resolves then goes idle again, a new trading
  //    day's drop).
  const { alerts, alertTrackedValues, newAlertIds } = useMemo(() => {
    const list: Alert[] = [];
    const trackedValues: Record<string, number> = {};
    const newIds = new Set<string>();

    function pushPersistent(id: string, tone: Tone, title: string, message: string, value: number, step: number) {
      trackedValues[id] = value;
      if (isNewOccurrence(value, alertAcksState[id], step)) newIds.add(id);
      list.push({ id, tone, title, message });
    }
    function pushIfNew(id: string, tone: Tone, title: string, message: string, isNew: boolean, value: number) {
      if (!isNew) return;
      trackedValues[id] = value;
      newIds.add(id);
      list.push({ id, tone, title, message });
    }

    for (const p of evaluated) {
      const isCash = p.symbol === "CASH";

      if (!p.hodl) {
        if (p.status === "דורש חיזוק") {
          pushPersistent("below-min:" + p.symbol, "amber",
            isCash ? "אחוז המזומן נמוך מהיעד" : p.symbol + " מתחת ליעד המינימום",
            p.action, p.dev, ALERT_RULES.devRearmStep);
        } else if (p.status === "חריגה - דילול נדרש") {
          pushPersistent("dilute-breach:" + p.symbol, "red",
            isCash ? "אחוז המזומן גבוה משמעותית מהיעד" : p.symbol + " חריגה - נדרש דילול",
            p.action, p.dev, ALERT_RULES.devRearmStep);
        } else if (p.status === "מעל היעד") {
          pushPersistent("over-max:" + p.symbol, "amber",
            isCash ? "אחוז המזומן מעל היעד" : p.symbol + " מעל יעד המקסימום",
            p.action, p.dev, ALERT_RULES.devRearmStep);
        } else if (p.status === "✅ תקין") {
          // A quiet positive callout: only when weight sits right at the center
          // of the target range, not for merely "somewhere inside" it (that's
          // the normal/expected state for most positions, and would be noise).
          const mid = (p.min + p.max) / 2;
          if (Math.abs(p.weight - mid) <= 0.015) {
            // Magnitude-based rather than presence-only, so drifting away
            // from target and later returning counts as a fresh occurrence
            // instead of being suppressed forever after the first time.
            const id = "on-target:" + p.symbol;
            pushIfNew(id, "green", (isCash ? "אחוז המזומן" : p.symbol) + " הגיע ליעד המשקל",
              "המשקל הנוכחי (" + fmtPct(p.weight) + ") קרוב מאוד ליעד האידיאלי.",
              isNewOccurrence(p.weight, alertAcksState[id], 0.03), p.weight);
          }
        }
      }

      // #1 price target crossed (up or down) - independent of the weight
      // range above, since price and weight can cross at different times
      // (weight also depends on the rest of the portfolio's value).
      if (!isCash && p.priceTarget != null && p.price != null) {
        const side = priceTargetSide(p.price, p.priceTarget);
        const id = "price-target:" + p.symbol;
        const isNew = isPriceTargetNewOccurrence(side, alertAcksState[id]);
        pushIfNew(id, "blue",
          p.symbol + (side === 1 ? " חצה כלפי מעלה את מחיר היעד" : " חצה כלפי מטה את מחיר היעד"),
          p.symbol + " במחיר " + formatMoney(p.price, privacyMode, { digits: 2 }) + " (יעד: " + formatMoney(p.priceTarget, privacyMode, { digits: 2 }) + ").",
          isNew, side);
      }

      // #6 single-day drop >5% - id includes today's date, so a new trading
      // day's drop is automatically a fresh occurrence.
      if (!isCash) {
        const changePct = dayChangePct[p.symbol];
        if (changePct != null && changePct <= ALERT_RULES.dailyDropThreshold) {
          const today = new Date().toISOString().slice(0, 10);
          const id = "day-drop:" + p.symbol + ":" + today;
          pushIfNew(id, "red", p.symbol + " ירד " + fmtPct(Math.abs(changePct)) + " היום",
            "ירידה חדה תוך יום מסחר בודד - ייתכן אירוע חדשותי משמעותי.",
            !alertAcksState[id], 1);
        }
      }
    }

    // #3 ATH drawdown - stays listed while the drawdown holds, re-highlights
    // as new if it worsens by another athRearmStep after being seen; the
    // hysteresis between athAlertDrawdown and athClearDrawdown just keeps it
    // from flickering right at the -10% line.
    if (athDrawdownPct <= ALERT_RULES.athAlertDrawdown) {
      pushPersistent("ath-drawdown", "red", "ירידה משמעותית משיא התיק",
        "התיק ירד " + fmtPct(Math.abs(athDrawdownPct)) + " מנקודת השיא ההיסטורית שלו.",
        athDrawdownPct, ALERT_RULES.athRearmStep);
    }

    // #4 idle cash - one-time until it resolves (cashIdleSince clears once
    // cash drops back under its own target). The id is scoped to this
    // specific idle streak's start date, not just "cash-idle" - otherwise
    // once acked it would never fire again for any *later* streak, since a
    // presence-only check has no way to tell "resolved, then went idle
    // again" apart from "still the same ongoing occurrence".
    if (cashIdleSince) {
      const days = Math.floor((new Date().getTime() - new Date(cashIdleSince + "T00:00:00Z").getTime()) / 86_400_000);
      if (days >= ALERT_RULES.cashIdleDays) {
        const id = "cash-idle:" + cashIdleSince;
        pushIfNew(id, "amber", "מזומן עודף לא מושקע",
          "אחוז המזומן מעל היעד כבר " + days + " ימים ברציפות.",
          !alertAcksState[id], 1);
      }
    }

    // #5 health score change - needs a previous breakdown to compare
    // against, so the very first-ever computation (no ack yet) just
    // silently has nothing to alert on rather than firing on nothing.
    if (healthScoreAckState) {
      const id = "health-score-change";
      const isNew = Math.abs(portfolioHealth.score - healthScoreAckState.score) >= ALERT_RULES.healthScoreRearmStep;
      if (isNew) {
        const deltas: [string, number][] = [
          ["יחס הנכסים בטווח היעד", (portfolioHealth.rangeRatio - healthScoreAckState.rangeRatio) * 60],
          ["בריאות המזומן", (portfolioHealth.cashHealth - healthScoreAckState.cashHealth) * 20],
          ["חריגות דילול/מקסימום", portfolioHealth.breachScore - healthScoreAckState.breachScore],
        ];
        const [mainDriver, mainDelta] = deltas.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
        const improved = portfolioHealth.score > healthScoreAckState.score;
        pushIfNew(id, improved ? "green" : "amber",
          "ציון בריאות התיק " + (improved ? "השתפר" : "ירד") + " ל-" + portfolioHealth.score + "/100",
          "השינוי העיקרי: " + mainDriver + " (" + (mainDelta >= 0 ? "+" : "") + Math.round(mainDelta) + " נק').",
          true, portfolioHealth.score);
      }
    }

    const problemCount = portfolioHealth.needsStrengthen.length + portfolioHealth.weightBreaches.length;
    if (problemCount >= 3 || portfolioHealth.score < 50) {
      pushPersistent("rebalance-recommended", portfolioHealth.tone === "red" ? "red" : "amber",
        "מומלץ איזון מחדש כולל",
        problemCount + " נכסים דורשים תשומת לב וציון בריאות התיק הוא " + portfolioHealth.score + "/100.",
        problemCount, 1);
    }

    const priority: Record<Tone, number> = { red: 0, amber: 1, blue: 2, green: 3 };
    list.sort((a, b) => priority[a.tone] - priority[b.tone]);
    return { alerts: list, alertTrackedValues: trackedValues, newAlertIds: newIds };
  }, [evaluated, portfolioHealth, alertAcksState, healthScoreAckState, athDrawdownPct, cashIdleSince, dayChangePct, privacyMode]);

  const unseenAlertCount = newAlertIds.size;

  // Acknowledges the given alert ids at their current tracked value/health
  // breakdown: optimistic local update (so the UI reacts immediately) plus a
  // best-effort server write - losing that write just means an alert may
  // resurface once more than strictly necessary, never a hard failure.
  function ackAlertsNow(ids: string[]) {
    if (ids.length === 0) return;
    const seenAt = new Date().toISOString();
    const acks: Record<string, { value: number }> = {};
    for (const id of ids) acks[id] = { value: alertTrackedValues[id] ?? 1 };
    setAlertAcksState((prev) => {
      const next = { ...prev };
      for (const [id, { value }] of Object.entries(acks)) next[id] = { value, seenAt };
      return next;
    });
    const healthScoreAck = ids.includes("health-score-change")
      ? { score: portfolioHealth.score, rangeRatio: portfolioHealth.rangeRatio, cashHealth: portfolioHealth.cashHealth, breachScore: portfolioHealth.breachScore }
      : undefined;
    if (healthScoreAck) setHealthScoreAckState({ ...healthScoreAck, seenAt });
    ackAlertsAction({ acks, healthScoreAck }).catch(() => { /* best-effort, see comment above */ });
  }

  function dismissAlert(id: string) {
    ackAlertsNow([id]);
  }
  function markAlertsSeen() {
    ackAlertsNow(alerts.map((a) => a.id));
  }

  const [alertsOpen, setAlertsOpen] = useState<boolean>(false);
  function toggleAlerts() {
    setAlertsOpen((open) => {
      const next = !open;
      if (next) markAlertsSeen();
      return next;
    });
  }
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
    const withdrawals = trades.filter((t) => t.action === "משיכה").reduce((a, t) => a + t.value, 0);
    // fees are stored as negative amounts (a cost), so adding them to realizedPnl
    // already subtracts the fee total - no sign-flip needed.
    const netPnl = realizedPnl + fees;
    return { realizedPnl, fees, buysSells, winRate, avgPnl, avgRet, sellCount: sells.length, deposits, withdrawals, netPnl };
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

  return (
    <div dir="rtl" style={{ fontFamily: "var(--sans)", background: "var(--bg)", color: "var(--text)", minHeight: "100%", width: "100%", boxSizing: "border-box" }}>
      <style>{`
        * { box-sizing: border-box; }
        .idash table { border-collapse: collapse; width: 100%; }
        .idash th { text-align: right; font-size: 11.5px; color: var(--text-faint); font-weight: 600; padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px; }
        .idash td { padding: 9px 12px; font-size: 13px; border-bottom: 1px solid var(--border); white-space: nowrap; text-align: right; vertical-align: middle; }
        .idash th.num, .idash td.num { text-align: right; }
        .idash td.num { font-family: var(--mono); direction: ltr; unicode-bidi: plaintext; font-variant-numeric: tabular-nums; }
        .idash .holdings-table table { table-layout: fixed; }
        .idash .holdings-table th { font-size: 12.5px; padding: 8px 8px; overflow: hidden; text-overflow: ellipsis; }
        .idash .holdings-table td { font-size: 14.5px; padding: 10px 8px; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
        .idash .holdings-table th.tight, .idash .holdings-table td.tight { padding-left: 5px; padding-right: 5px; }
        .idash th.center, .idash td.center { text-align: center; }
        .idash tr:nth-child(even) td { background: var(--row-alt); }
        .idash tr.row-cash td { background: var(--row-highlight); }
        .idash tr:hover td { background: var(--hover-overlay); }
        .idash input, .idash select, .idash textarea {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: var(--sans); width: 100%;
        }
        .idash textarea { resize: vertical; min-height: 60px; font-family: var(--sans); }
        .idash input:focus, .idash select:focus, .idash textarea:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus); }
        .idash button.primary, .idash button.ghost, .idash button.icon-btn {
          transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 80ms ease;
        }
        .idash button.primary:active, .idash button.ghost:active, .idash button.icon-btn:active { transform: scale(0.97); }
        .idash button.primary:focus-visible, .idash button.ghost:focus-visible, .idash button.icon-btn:focus-visible {
          outline: none; box-shadow: var(--shadow-focus);
        }
        .idash button.primary:disabled, .idash button.ghost:disabled, .idash button.icon-btn:disabled {
          opacity: 0.5; cursor: not-allowed; pointer-events: none;
        }
        .idash button.primary { background: var(--accent); color: var(--accent-on); border: none; border-radius: 10px; padding: 10px 18px; font-weight: 700; font-size: 13.5px; cursor: pointer; }
        .idash button.primary:hover { background: var(--accent-hover); }
        .idash button.ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); border-radius: 10px; padding: 10px 18px; font-weight: 600; font-size: 13.5px; cursor: pointer; }
        .idash button.ghost:hover { border-color: var(--text-dim); color: var(--text); }
        .idash button.icon-btn { background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 7px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .idash button.icon-btn:hover { border-color: var(--text-dim); color: var(--text); }
        .idash button.icon-btn.danger:hover { border-color: var(--loss); color: var(--loss); }
        .idash a.symbol-link { color: var(--text); text-decoration: none; border-bottom: 1px dashed var(--text-faint); transition: color 140ms ease, border-color 140ms ease; }
        .idash a.symbol-link:hover, .idash a.symbol-link:focus-visible { color: var(--accent); border-bottom-color: var(--accent); }
        .idash a.symbol-link:focus-visible { outline: none; }
        .idash .detail-trigger:focus-visible { outline: none; box-shadow: inset var(--shadow-focus); border-radius: var(--radius-sm); }
        .ticker-track { display: flex; gap: 28px; animation: ticker 32s linear infinite; white-space: nowrap; }
        .ticker-wrap:hover .ticker-track { animation-play-state: paused; }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .spin-icon { animation: spin 0.9s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .idash ::-webkit-scrollbar { height: 8px; width: 8px; }
        .idash ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .idash-scroll-table { -webkit-overflow-scrolling: touch; }
        .idash-scroll-hint { display: none; align-items: center; gap: 6px; font-size: 11px; color: var(--text-faint); margin-bottom: 8px; }
        .header-actions-compact { display: none; }
        @media (max-width: 860px) {
          .idash-grid2 { grid-template-columns: 1fr !important; }
          .morning-brief-card { order: -1; }
          .idash-scroll-hint { display: flex !important; }
          .header-actions-full { display: none !important; }
          .header-actions-compact { display: flex !important; }
        }
        @media (max-width: 640px) {
          .idash-content { padding: 14px 12px 0 !important; }
          .idash button.icon-btn { width: 34px !important; height: 34px !important; }
          .idash button.primary, .idash button.ghost { min-height: 42px; }
          /* iOS Safari auto-zooms the page on focus for any input under 16px - only visible on a real device, not in Chrome devtools emulation. */
          .idash input, .idash select, .idash textarea { font-size: 16px !important; }
          .idash-form-actions { flex-direction: column !important; }
          .idash-form-actions button { width: 100%; }
          .header-subtitle { display: none; }
          .header-greeting { font-size: 11.5px !important; }
        }
      `}</style>

      <div className="idash" style={{ padding: "0 0 40px" }}>

        {globalError && (
          // Fixed, not in normal document flow: this used to sit at the top
          // of the page and scroll away with it, so a save failure while the
          // user was scrolled down (e.g. mid trade-import, well below the
          // fold) could go completely unnoticed - the exact way a real save
          // failure was missed and a batch of trades was silently lost. Now
          // it stays on screen regardless of scroll position, at every
          // viewport width.
          <div style={{
            position: "fixed", top: "max(12px, env(safe-area-inset-top))", left: 20, right: 20, zIndex: 100,
            padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", color: "var(--loss)", borderRadius: "var(--radius-md)", fontSize: 13,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} /> {globalError}
            </span>
            <button
              type="button" onClick={() => setGlobalError("")}
              style={{ background: "transparent", border: "1px solid var(--loss-subtle-border)", color: "var(--loss)", borderRadius: "var(--radius-sm)", padding: "3px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
            >סגור</button>
          </div>
        )}

        <Header
          userName={userName} total={total} cashFree={cashFree} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode}
          visibleAlerts={alerts} unseenAlertCount={unseenAlertCount} newAlertIds={newAlertIds}
          alertsOpen={alertsOpen} toggleAlerts={toggleAlerts} closeAlerts={() => setAlertsOpen(false)} dismissAlert={dismissAlert}
          undoSnapshot={undoSnapshot} undoLastAction={undoLastAction}
        />

        <div className="idash-content" style={{ padding: "20px 20px 0" }}>

          {/* Ticker */}
          <div className="ticker-wrap" style={{
            display: "flex", alignItems: "center", gap: 14,
            border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--panel)", padding: "12px 16px", marginBottom: "var(--space-6)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--accent)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", letterSpacing: 0.4, whiteSpace: "nowrap" }}>הקצאה חיה</span>
            </div>
            <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
            <div style={{
              position: "relative", overflow: "hidden", flex: 1, minWidth: 0,
              WebkitMaskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
              maskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
            }}>
              <div className="ticker-track">
                {[...evaluated, ...evaluated].map((p, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 14 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "var(--radius-full)", background: TONE_STYLES[p.tone].text, flexShrink: 0 }} />
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

          <HoldingsSection
            evaluated={evaluated} positions={positions} setPositions={setPositions} nextPosIdRef={nextPosId}
            pushUndoSnapshot={pushUndoSnapshot} total={total} privacyMode={privacyMode} extendedPrices={extendedPrices}
            openDetail={openDetail} pricesConfigured={pricesConfigured} lastPriceUpdate={lastPriceUpdate}
            pricesLoading={pricesLoading} priceError={priceError} refreshPrices={refreshPrices} saveStatus={saveStatus}
            backupRunning={backupRunning} backupDoneAt={backupDoneAt} onBackupNow={handleBackupNow}
            morningBrief={morningBrief} bigMovers={bigMovers} morningBriefLoading={morningBriefLoading} morningBriefError={morningBriefError}
            onOpenMorningBrief={() => setBriefDrawerOpen(true)}
          />

          <TradeJournalSection
            trades={trades} setTrades={setTrades} ledger={ledger} setLedger={setLedger} positions={positions}
            pushUndoSnapshot={pushUndoSnapshot} nextIdRef={nextId} applyCashDelta={applyCashDelta}
            cashFree={cashFree} stats={stats} privacyMode={privacyMode}
          />

          <div style={{ marginTop: 34 }}>
            <PortfolioSummaryCard lines={portfolioSummary} />
          </div>
        </div>
      </div>

      <StockDetailDrawer
        symbol={detailSymbol}
        position={evaluated.find((p) => p.symbol === detailSymbol)}
        colorIndex={Math.max(0, evaluated.findIndex((p) => p.symbol === detailSymbol))}
        privacyMode={privacyMode}
        onClose={() => setDetailSymbol(null)}
        onSetPriceTarget={(symbol, priceTarget) => {
          pushUndoSnapshot("עדכון מחיר יעד");
          setPositions((ps) => ps.map((p) => (p.symbol === symbol ? { ...p, priceTarget } : p)));
        }}
      />

      <MorningBriefDrawer
        open={briefDrawerOpen}
        onClose={() => setBriefDrawerOpen(false)}
        result={morningBrief}
        bigMovers={bigMovers}
        loading={morningBriefLoading}
        error={morningBriefError}
        portfolioHealth={portfolioHealth}
        privacyMode={privacyMode}
      />
    </div>
  );
}

