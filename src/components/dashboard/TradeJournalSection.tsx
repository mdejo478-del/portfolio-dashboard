import { useMemo, useRef, useState, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  TrendingUp, TrendingDown, Wallet, Percent, Receipt, ListChecks, Plus,
  Pencil, Trash2, Download, X, Check, Filter, RefreshCw, Upload, Activity, ArrowLeftRight, AlertTriangle,
} from "lucide-react";
import { CheckboxCell } from "@/components/dashboard/ui/CheckboxCell";
import { cashEffect } from "@/lib/portfolioTypes";
import { anchorCountsTrade, buildLedger, sellContextBefore, suggestSellPnl, retPctFor, diffLedgers, planImport, planAnchorsFromHoldings, type AnchorPlan, type ImportRowInput, type LedgerDifference } from "@/lib/ledger";
import type { LedgerAnchors } from "@/lib/portfolioTypes";
import { splitDuplicates } from "@/lib/tradeDuplicates";
import { validateTrade, newErrors, errorsOf } from "@/lib/validation";
import type { Position, Trade, Ledger } from "@/lib/portfolio";
import type { TradeFormState } from "@/components/dashboard/types";
import { ACTION_OPTS, STRATEGY_OPTS, SYMOPTS, EMPTY_FORM } from "@/components/dashboard/constants";
import { fmtPct, fmtNum, formatMoney, parseNum, csvEscape, mapStrategyToOption } from "@/components/dashboard/format";
import { ActionBadge } from "@/components/dashboard/ui/Badge";
import { Button } from "@/components/dashboard/ui/Button";
import { Card } from "@/components/dashboard/ui/Card";
import { PageBanner, Field } from "@/components/dashboard/ui/Layout";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import TradeImportModal from "@/components/TradeImportModal";
import TradeColumnMappingModal from "@/components/TradeColumnMappingModal";
import { parseTradeFile, parseTradeWorkbook, decodeCsvBuffer, parseWithManualMapping, type ParseResult, type ParsedTradeRow } from "@/lib/tradeImport";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

interface TradeStats {
  realizedPnl: number; fees: number; buysSells: number; winRate: number;
  avgPnl: number; avgRet: number; sellCount: number; deposits: number;
  withdrawals: number; netPnl: number;
}

interface TradeJournalSectionProps {
  trades: Trade[];
  setTrades: Dispatch<SetStateAction<Trade[]>>;
  ledger: Ledger;
  setLedger: Dispatch<SetStateAction<Ledger>>;
  ledgerAnchors: LedgerAnchors;
  setLedgerAnchors: Dispatch<SetStateAction<LedgerAnchors>>;
  positions: Position[];
  pushUndoSnapshot: (label: string) => void;
  nextIdRef: MutableRefObject<number>;
  applyCashDelta: (delta: number) => void;
  cashFree: number;
  stats: TradeStats;
  privacyMode: boolean;
}

export function TradeJournalSection({
  trades, setTrades, ledger, setLedger, ledgerAnchors, setLedgerAnchors, positions, pushUndoSnapshot, nextIdRef, applyCashDelta, cashFree, stats, privacyMode,
}: TradeJournalSectionProps) {
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TradeFormState>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [tradeFormError, setTradeFormError] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<boolean>(false);

  // What the last import did (counts, skipped duplicates, sells left without a
  // profit) - dismissible; null when there is nothing to report.
  const [journalNotice, setJournalNotice] = useState<string[] | null>(null);
  // The saved ledger is compared with one rebuilt from the trades. Differences
  // are only SHOWN; nothing is changed until the user approves (see drift below).
  const rebuiltLedger = useMemo(() => buildLedger(trades, ledgerAnchors).ledger, [trades, ledgerAnchors]);
  const ledgerDrift = useMemo(() => diffLedgers(ledger, rebuiltLedger), [ledger, rebuiltLedger]);
  const [driftHidden, setDriftHidden] = useState<boolean>(false);
  function applyRebuiltLedger() {
    pushUndoSnapshot("עדכון מחיר ממוצע לפי העסקאות");
    setLedger(rebuiltLedger);
  }

  // Holdings bought before the journal have no trades, so trades alone can never
  // give their quantity/average cost. "Update from holdings" proposes a starting
  // point (anchor) per symbol from the holdings table - shown as before/after and
  // applied only on approval. It never changes the holdings table, the pnl saved
  // on trades, the cash or the equity history.
  const heldWithoutAvgCost = useMemo(
    () => positions.filter((p) => p.symbol !== "CASH" && typeof p.qty === "number" && p.qty > 0 && !(typeof p.avgCost === "number" && p.avgCost > 0)).map((p) => p.symbol),
    [positions]
  );
  // What the proposal was computed from; if the trades or the holdings' quantity/
  // average cost change while it is open, it no longer describes reality and is dropped.
  const holdingsSignature = useMemo(() => JSON.stringify(positions.map((p) => [p.symbol, p.qty, p.avgCost ?? null])), [positions]);
  const [holdingsPlanRaw, setHoldingsPlan] = useState<{
    plan: AnchorPlan; before: Ledger; after: Ledger; diff: LedgerDifference[]; asOf: string; signature: string; forTrades: Trade[]; forAnchors: LedgerAnchors;
  } | null>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const holdingsPlan = holdingsPlanRaw && holdingsPlanRaw.signature === holdingsSignature && holdingsPlanRaw.forTrades === trades && holdingsPlanRaw.forAnchors === ledgerAnchors
    ? holdingsPlanRaw : null;
  function openHoldingsPlan() {
    const asOf = new Date().toISOString().slice(0, 10);
    // Trades already in the journal now are part of the holdings the anchor describes.
    const lastTradeId = trades.reduce((m, t) => Math.max(m, t.id), -1);
    const plan = planAnchorsFromHoldings(positions, ledger, rebuiltLedger, ledgerAnchors, asOf, lastTradeId);
    const after = buildLedger(trades, plan.anchors).ledger;
    setHoldingsPlan({ plan, before: ledger, after, diff: diffLedgers(ledger, after), asOf, signature: holdingsSignature, forTrades: trades, forAnchors: ledgerAnchors });
    // The button can sit well below the top of the section where the proposal appears.
    requestAnimationFrame(() => planRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function applyHoldingsPlan() {
    if (!holdingsPlan) return;
    pushUndoSnapshot("עדכון מחיר ממוצע לפי האחזקות");
    setLedgerAnchors(holdingsPlan.plan.anchors);
    setLedger(holdingsPlan.after);
    setHoldingsPlan(null);
  }

  const [importResult, setImportResult] = useState<ParseResult | null>(null);
  const [importFileName, setImportFileName] = useState<string>("");
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function openAddTradeForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const isMobile = useIsMobile();
  const isTablet = useIsMobile(860);

  const [fSymbol, setFSymbol] = useState<string>("הכל");
  const [fAction, setFAction] = useState<string>("הכל");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");

  const symbolOptions = useMemo(() => {
    const set = new Set(trades.map((t) => t.symbol));
    return Array.from(set).sort();
  }, [trades]);

  const symbolSuggestions = useMemo(() => {
    const set = new Set([...SYMOPTS, ...positions.map((p) => p.symbol), ...symbolOptions]);
    return Array.from(set).sort();
  }, [positions, symbolOptions]);

  // A parsed row that reads fine but makes no sense (a date that isn't on the
  // calendar, a zero price...) is shown as an error row and skipped, instead of
  // being imported and later making the whole portfolio unsaveable.
  function withSemanticChecks(result: ParseResult): ParseResult {
    if (result.fileError || result.needsMapping) return result;
    return {
      ...result,
      rows: result.rows.map((r) => {
        if (r.error) return r;
        const t: Trade = { id: -1, date: r.date as string, symbol: r.symbol as string, action: r.action as string, qty: r.qty as number, price: r.price as number, value: (r.qty as number) * (r.price as number), fee: r.fee, pnl: null, retPct: null, strategy: r.strategy, notes: r.notes };
        const problem = errorsOf(validateTrade(t))[0];
        return problem ? { ...r, error: problem.message } : r;
      }),
    };
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
        const buffer = reader.result as ArrayBuffer;
        if (isExcel) {
          setImportResult(withSemanticChecks(await parseTradeWorkbook(buffer)));
        } else {
          // Read as raw bytes rather than text so the encoding can be
          // detected instead of assumed - CSV exports from Hebrew/Israeli
          // Excel installations are commonly Windows-1255, not UTF-8.
          setImportResult(withSemanticChecks(parseTradeFile(decodeCsvBuffer(buffer))));
        }
      } finally {
        setImportLoading(false);
      }
    };
    reader.onerror = () => { setImportResult({ fileError: "שגיאה בקריאת הקובץ. נסה שוב.", rows: [] }); setImportLoading(false); };
    reader.readAsArrayBuffer(file);
  }

  function closeImportModal() {
    setImportResult(null);
    setImportFileName("");
  }

  // Valid file rows as plain trade inputs. Valid rows always have these fields
  // (a missing one is a row error), so the casts only narrow the nullable types.
  function toImportRow(r: ParsedTradeRow): ImportRowInput & { rowNumber: number } {
    return {
      rowNumber: r.rowNumber, date: r.date as string, symbol: r.symbol as string, action: r.action as string,
      qty: r.qty as number, price: r.price as number, fee: r.fee, pnlOverride: r.pnlOverride, strategy: r.strategy, notes: r.notes,
    };
  }

  // Which valid rows of the pending file are already in the journal (same date,
  // symbol, action, quantity and price) - shown in the preview and skipped on
  // confirm, so re-importing a file can't double trades, cash and the ledger.
  const importDuplicateRows = useMemo<Set<number>>(() => {
    if (!importResult || importResult.needsMapping) return new Set<number>();
    const valid = importResult.rows.filter((r) => !r.error).map(toImportRow);
    return new Set(splitDuplicates(trades, valid).duplicates.map((r) => r.rowNumber));
  }, [importResult, trades]);

  function confirmImport(validRows: ParsedTradeRow[]) {
    const { fresh, duplicates } = splitDuplicates(trades, validRows.map(toImportRow));
    if (fresh.length === 0) {
      setJournalNotice(duplicates.length > 0 ? ["כל " + duplicates.length + " השורות בקובץ כבר קיימות ביומן - לא נוסף דבר."] : null);
      closeImportModal();
      return;
    }
    pushUndoSnapshot("ייבוא קובץ עסקאות");
    // Profits are measured against the journal as of each trade's own date, and
    // the ledger is rebuilt from every trade in date order - an old file slots in
    // where it belongs instead of being applied after everything else.
    const plan = planImport(trades, fresh, nextIdRef.current, ledgerAnchors);
    nextIdRef.current += plan.newTrades.length;
    setTrades([...trades, ...plan.newTrades]);
    setLedger(plan.ledger);
    applyCashDelta(plan.cashDelta);
    const lines = ["יובאו " + plan.newTrades.length + " עסקאות."];
    if (duplicates.length > 0) lines.push(duplicates.length + " שורות כבר היו ביומן ודולגו.");
    if (plan.unresolvedSells.length > 0) {
      lines.push(plan.unresolvedSells.length + " מכירות נשארו בלי רווח/הפסד, כי אין ביומן מספיק היסטוריית קנייה עבורן (או שהכמות הנמכרת גדולה מהכמות שנקנתה). ניתן להזין את הרווח ידנית בעריכת העסקה.");
    }
    setJournalNotice(lines);
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
  // What the journal held of this symbol right before the trade's own date (the
  // trade being edited excluded) - not the latest ledger, so a backdated sell is
  // measured against the position it actually sold from.
  const formSymbol = form.symbol.trim().toUpperCase();
  const sellCtx = useMemo(
    () => (form.action === "מכירה" && formSymbol && formSymbol !== "CASH" && form.date)
      ? sellContextBefore(trades, { date: form.date, id: editingId ?? Infinity }, formSymbol, editingId, ledgerAnchors) : null,
    [trades, ledgerAnchors, form.action, form.date, formSymbol, editingId]
  );
  const previewAvgCost = sellCtx ? sellCtx.avgCost : null;
  // The symbol has a starting point (anchor) dated on or after this trade: the trade
  // stays in the journal but does not move the ledger.
  const anchorForForm = formSymbol ? ledgerAnchors[formSymbol] : undefined;
  const anchorCoversDate = !!anchorForForm && !!form.date && (form.action === "קנייה" || form.action === "מכירה")
    && !anchorCountsTrade(anchorForForm, { id: editingId ?? Infinity, date: form.date });
  // An already-journaled trade being edited (it is part of the anchor) vs. a trade dated before it.
  const anchorAlreadyCounted = !!anchorForForm && editingId !== null && anchorForForm.lastTradeId !== undefined && editingId <= anchorForForm.lastTradeId;
  // null (not 0) when the journal can't explain the sale - see suggestSellPnl.
  const sellSuggestion = (sellCtx && previewValue !== null && qtyNum > 0 && priceNum > 0) ? suggestSellPnl(sellCtx, priceNum, qtyNum) : null;
  const previewAutoPnl = sellSuggestion ? sellSuggestion.pnl : null;
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
    if (Number.isNaN(fee)) { setTradeFormError("נא להזין עמלה תקינה (מספר, בדרך כלל שלילי, למשל -2.5)."); return; }
    // Refuse what doesn't make sense (a date that isn't on the calendar, a
    // positive fee that would add to cash...) and say why. Only problems this
    // edit would ADD count: a legacy trade that already had one can still be edited.
    const candidate: Trade = { id: editingId ?? -1, date: form.date, symbol, action: form.action, qty, price, value: qty * price, fee, pnl: null, retPct: null, strategy: form.strategy, notes: form.notes || null };
    const previous = editingId !== null ? trades.find((t) => t.id === editingId) : undefined;
    const introduced = newErrors(validateTrade(candidate, { feeSignIsError: true }), previous ? validateTrade(previous, { feeSignIsError: true }) : []);
    if (introduced.length > 0) { setTradeFormError(introduced[0].message); return; }
    pushUndoSnapshot(editingId !== null ? "עריכת עסקה" : "הוספת עסקה");
    const value = qty * price;
    let pnl: number | null = null;
    let retPct: number | null = null;

    // Only THIS trade's profit is computed here; the saved pnl/retPct of every
    // other trade are left exactly as they are.
    if (form.action === "מכירה" && symbol !== "CASH") {
      const manualNum = form.pnlManual !== "" ? parseNum(form.pnlManual) : null;
      const manual = manualNum !== null && !Number.isNaN(manualNum) ? manualNum : null;
      pnl = manual !== null
        ? manual
        : suggestSellPnl(sellContextBefore(trades, { date: form.date, id: editingId ?? Infinity }, symbol, editingId, ledgerAnchors), price, qty).pnl;
      retPct = retPctFor(pnl, value);
    }

    let nextTrades: Trade[];
    if (editingId !== null) {
      const oldTrade = trades.find((t) => t.id === editingId);
      const newTradeObj: Trade = { ...(oldTrade as Trade), date: form.date, symbol, action: form.action, qty, price, value, fee, pnl, retPct, strategy: form.strategy, notes: form.notes || null };
      applyCashDelta(cashEffect(newTradeObj) - cashEffect(oldTrade));
      nextTrades = trades.map((t) => (t.id === editingId ? newTradeObj : t));
    } else {
      const newTrade: Trade = { id: nextIdRef.current++, date: form.date, symbol, action: form.action, qty, price, value, fee, pnl, retPct, strategy: form.strategy, notes: form.notes || null };
      applyCashDelta(cashEffect(newTrade));
      nextTrades = [...trades, newTrade];
    }
    // The ledger is always rebuilt from the whole trade list (in date order), so
    // an edit replaces the old version instead of stacking on it.
    setTrades(nextTrades);
    setLedger(buildLedger(nextTrades, ledgerAnchors).ledger);
    cancelForm();
  }

  function deleteTrade(id: number) {
    const trade = trades.find((t) => t.id === id);
    pushUndoSnapshot("מחיקת עסקה");
    applyCashDelta(-cashEffect(trade));
    const nextTrades = trades.filter((t) => t.id !== id);
    setTrades(nextTrades);
    setLedger(buildLedger(nextTrades, ledgerAnchors).ledger);
    setDeleteConfirmId(null);
  }

  function toggleSelectTrade(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // "Select all" toggles everything currently visible under the active
  // filters, not the whole trade log - matches what the checkbox next to it
  // visually represents. Trades selected before a filter change stay
  // selected even while hidden, same as most table UIs (e.g. Gmail).
  const allVisibleSelected = sortedTrades.length > 0 && sortedTrades.every((t) => selectedIds.has(t.id));
  const someVisibleSelected = sortedTrades.some((t) => selectedIds.has(t.id));
  function toggleSelectAllVisible() {
    setSelectedIds((s) => {
      if (allVisibleSelected) {
        const next = new Set(s);
        for (const t of sortedTrades) next.delete(t.id);
        return next;
      }
      return new Set([...s, ...sortedTrades.map((t) => t.id)]);
    });
  }

  function deleteSelectedTrades() {
    const toDelete = trades.filter((t) => selectedIds.has(t.id));
    if (toDelete.length === 0) { setBulkDeleteConfirm(false); return; }
    const deletingAll = toDelete.length === trades.length;
    pushUndoSnapshot(deletingAll ? "מחיקת כל העסקאות" : "מחיקת " + toDelete.length + " עסקאות");
    const cashDelta = toDelete.reduce((sum, t) => sum - cashEffect(t), 0);
    applyCashDelta(cashDelta);
    const nextTrades = trades.filter((t) => !selectedIds.has(t.id));
    setTrades(nextTrades);
    setLedger(buildLedger(nextTrades, ledgerAnchors).ledger);
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
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
    <>
      {/* Trade journal banner */}
      <PageBanner icon={<ListChecks size={20} />} title="יומן מסחר חכם ומקצועי (Smart Trade Log)" subtitle="כל העסקאות, הסיכומים והפעולות במקום אחד" />

      {journalNotice && (
        <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", marginBottom: "var(--space-4)", background: "var(--info-subtle)", border: "1px solid var(--info-subtle-border)", borderRadius: "var(--radius-md)", fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
          <div style={{ flex: 1 }}>{journalNotice.map((line, i) => <div key={i}>{line}</div>)}</div>
          <Button variant="icon" onClick={() => setJournalNotice(null)} aria-label="סגור הודעה" title="סגור"><X size={14} /></Button>
        </div>
      )}

      {ledgerDrift.length > 0 && !driftHidden && (
        <div role="alert" style={{ padding: "14px 16px", marginBottom: "var(--space-5)", background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: "var(--radius-md)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "var(--warning)", marginBottom: 6 }}>
            <AlertTriangle size={16} /> המחיר הממוצע השמור ביומן שונה ממה שמחושב מהעסקאות
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 10 }}>
            הנתון השמור נבנה בגרסאות קודמות והצטבר עם הזמן (למשל אחרי עריכה או מחיקה של עסקה), ולכן אינו תואם את רשימת העסקאות.
            לא שיניתי כלום. אם תאשר, הכמות והמחיר הממוצע יחושבו מחדש מכל העסקאות לפי תאריך. הרווח/הפסד ששמור בעסקאות עצמן לא ישתנה, וגם המחיר הממוצע הידני בטבלת האחזקות לא ייגע.
          </div>
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table>
              <thead>
                <tr><th>סימול</th><th className="num">כמות שמורה</th><th className="num">מחיר ממוצע שמור</th><th className="num">כמות מחושבת</th><th className="num">מחיר ממוצע מחושב</th></tr>
              </thead>
              <tbody>
                {ledgerDrift.map((d) => (
                  <tr key={d.symbol}>
                    <td style={{ fontWeight: 700 }}>{d.symbol}</td>
                    <td className="num">{d.stored ? fmtNum(d.stored.qty, d.stored.qty % 1 !== 0 ? 2 : 0) : "אין"}</td>
                    <td className="num">{d.stored ? formatMoney(d.stored.avgCost, privacyMode, { digits: 2 }) : "אין"}</td>
                    <td className="num">{d.rebuilt ? fmtNum(d.rebuilt.qty, d.rebuilt.qty % 1 !== 0 ? 2 : 0) : "אין"}</td>
                    <td className="num">{d.rebuilt ? formatMoney(d.rebuilt.avgCost, privacyMode, { digits: 2 }) : "אין"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {heldWithoutAvgCost.length > 0 && (
            <div data-missing-avgcost={heldWithoutAvgCost.length} style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 10 }}>
              חסר מחיר ממוצע באחזקות: <strong>{heldWithoutAvgCost.join(", ")}</strong>. נכסים אלה יישארו לפי העסקאות ביומן (אפשר להזין מחיר ממוצע בעיפרון שבטבלת האחזקות).
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={applyRebuiltLedger}><Check size={15} /> עדכן לפי העסקאות</Button>
            <Button variant="ghost" onClick={openHoldingsPlan}>עדכן לפי האחזקות</Button>
            <Button variant="ghost" onClick={() => setDriftHidden(true)}>השאר כמו שזה</Button>
          </div>
        </div>
      )}

      {holdingsPlan && (
        <div ref={planRef} role="dialog" aria-label="עדכון לפי האחזקות" style={{ padding: "14px 16px", marginBottom: "var(--space-5)", background: "var(--info-subtle)", border: "1px solid var(--info-subtle-border)", borderRadius: "var(--radius-md)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>עדכון המחיר הממוצע לפי טבלת האחזקות - לפני ואחרי</div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 10 }}>
            לכל נכס שיש לו באחזקות גם כמות וגם מחיר ממוצע תישמר נקודת פתיחה לתאריך {holdingsPlan.asOf}: הכמות והמחיר הממוצע מהאחזקות. עסקאות שכבר ביומן עכשיו נחשבות כחלק מהאחזקות ולא ייספרו שוב. עסקה חדשה מ-{holdingsPlan.asOf} והלאה תעדכן את הממוצע, ועסקה חדשה שתירשם עם תאריך מוקדם יותר תישמר ביומן בלי להשפיע עליו. נכסים שיש בחישוב ואין באחזקות יוסרו ממנו.
            טבלת האחזקות, הרווח/הפסד ששמור בעסקאות, המזומן והגרף לא ישתנו.
          </div>
          {holdingsPlan.diff.length > 0 ? (
            <div style={{ overflowX: "auto", marginBottom: 10 }}>
              <table>
                <thead>
                  <tr><th>סימול</th><th className="num">לפני: כמות</th><th className="num">לפני: ממוצע</th><th className="num">אחרי: כמות</th><th className="num">אחרי: ממוצע</th></tr>
                </thead>
                <tbody>
                  {holdingsPlan.diff.map((d) => (
                    <tr key={d.symbol}>
                      <td style={{ fontWeight: 700 }}>{d.symbol}</td>
                      <td className="num">{d.stored ? fmtNum(d.stored.qty, d.stored.qty % 1 !== 0 ? 2 : 0) : "אין"}</td>
                      <td className="num">{d.stored ? formatMoney(d.stored.avgCost, privacyMode, { digits: 2 }) : "אין"}</td>
                      <td className="num">{d.rebuilt ? fmtNum(d.rebuilt.qty, d.rebuilt.qty % 1 !== 0 ? 2 : 0) : "יוסר"}</td>
                      <td className="num">{d.rebuilt ? formatMoney(d.rebuilt.avgCost, privacyMode, { digits: 2 }) : "יוסר"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, marginBottom: 10 }}>אין הבדל בכמות או במחיר הממוצע; יישמרו רק נקודות הפתיחה.</div>
          )}
          <div style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 12 }}>
            {holdingsPlan.plan.anchored.length > 0 && <div>נקודת פתיחה תיווצר עבור: <strong>{holdingsPlan.plan.anchored.join(", ")}</strong></div>}
            {holdingsPlan.plan.flattened.length > 0 && <div>יוסרו (אין באחזקות): <strong>{holdingsPlan.plan.flattened.join(", ")}</strong></div>}
            {holdingsPlan.plan.missingAvgCost.length > 0 && <div>חסר מחיר ממוצע באחזקות (יישארו לפי העסקאות): <strong>{holdingsPlan.plan.missingAvgCost.join(", ")}</strong></div>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={applyHoldingsPlan}><Check size={15} /> אשר ועדכן</Button>
            <Button variant="ghost" onClick={() => setHoldingsPlan(null)}>ביטול</Button>
          </div>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(3, 1fr)" : "repeat(6, 1fr)",
        gap: isMobile ? 10 : 14, marginBottom: 22,
      }}>
        <Card label="מזומן פנוי" value={formatMoney(cashFree, privacyMode)} icon={<Wallet size={15} color="var(--text-dim)" />} />
        <Card label="רווח/הפסד ממומש" value={formatMoney(stats.realizedPnl, privacyMode)} tone={stats.realizedPnl >= 0 ? "green" : "red"} icon={stats.realizedPnl >= 0 ? <TrendingUp size={15} color="var(--gain)" /> : <TrendingDown size={15} color="var(--loss)" />} />
        <Card label="אחוז הצלחה" value={fmtPct(stats.winRate)} sub={stats.sellCount + " עסקאות מכירה"} icon={<Percent size={15} color="var(--text-dim)" />} />
        <Card label="מספר עסקאות" value={fmtNum(stats.buysSells)} sub={trades.length + " שורות כולל"} icon={<Activity size={15} color="var(--text-dim)" />} />
        <Card label="סך עמלות" value={formatMoney(stats.fees, privacyMode)} tone="red" icon={<Receipt size={15} color="var(--loss)" />} />
        <Card label="ממוצע רווח לעסקה" value={formatMoney(stats.avgPnl, privacyMode)} tone={stats.avgPnl >= 0 ? "green" : "red"} sub={fmtPct(stats.avgRet) + " תשואה ממוצעת"} icon={stats.avgPnl >= 0 ? <TrendingUp size={15} color="var(--gain)" /> : <TrendingDown size={15} color="var(--loss)" />} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "var(--space-3)", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={fileInputRef} type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            style={{ display: "none" }} onChange={handleFileSelected}
          />
          <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={importLoading}>
            {importLoading ? <RefreshCw size={15} className="spin-icon" /> : <Upload size={15} />}
            {importLoading ? "טוען קובץ..." : "העלאת קובץ עסקאות (CSV / Excel)"}
          </Button>
          <Button variant="ghost" onClick={exportCSV}>
            <Download size={15} /> ייצוא CSV
          </Button>
          <Button variant="ghost" onClick={openHoldingsPlan}
            title="מציע נקודת פתיחה (כמות ומחיר ממוצע) לכל נכס לפי טבלת האחזקות - מציג לפני ואחרי ומשנה רק אחרי אישור">
            עדכן לפי האחזקות
          </Button>
          <Button variant="primary" onClick={() => { if (showForm && editingId === null) { cancelForm(); } else { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); } }}>
            <Plus size={15} /> {showForm && editingId === null ? "סגור טופס" : "הוסף עסקה"}
          </Button>
        </div>
      </div>

      {showForm && (
        <div ref={formRef} style={{ background: "var(--panel)", border: "1px solid " + (editingId !== null ? "var(--info-subtle-border)" : "var(--border)"), borderRadius: "var(--radius-lg)", padding: 18, marginBottom: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              {editingId !== null ? <Pencil size={15} color="var(--info)" /> : <Plus size={15} color="var(--accent)" />}
              {editingId !== null ? "עריכת עסקה" : "עסקה חדשה"}
            </div>
            <Button variant="icon" onClick={cancelForm}><X size={15} /></Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: "var(--space-3)" }}>
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
                  placeholder={previewAutoPnl !== null ? formatMoney(previewAutoPnl, privacyMode) : "לדוגמה: 250"} />
              </Field>
            )}
            <Field label="אסטרטגיה / סיבה">
              <select value={form.strategy} onChange={(e) => updateForm("strategy", e.target.value)}>
                {STRATEGY_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: isMobile ? "auto" : "span 2" }}>
              <Field label="הערות"><textarea value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} placeholder="פרטים נוספים, סיבה, הקשר..." /></Field>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>שווי כולל משוער</div>
              <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{previewValue !== null ? formatMoney(previewValue, privacyMode) : "-"}</div>
            </div>
            {form.action === "מכירה" && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>רווח/הפסד ממומש {form.pnlManual !== "" ? "(ידני)" : "(מוצע אוטומטית)"}</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: effectivePnl == null ? "var(--text)" : effectivePnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{effectivePnl !== null ? formatMoney(effectivePnl, privacyMode) : "-"}</div>
              </div>
            )}
            {form.action === "מכירה" && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>אחוז ממומש מהעסקה</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: effectiveRetPct == null ? "var(--text)" : effectiveRetPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{effectiveRetPct !== null ? fmtPct(effectiveRetPct) : "-"}</div>
              </div>
            )}
            {previewAvgCost !== null && form.action === "מכירה" && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>עלות ממוצעת ביומן עד תאריך העסקה (למעקב בלבד)</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{formatMoney(previewAvgCost, privacyMode, { digits: 2 })}</div>
              </div>
            )}
          </div>

          {anchorCoversDate && anchorForForm && (
            <div role="status" style={{ marginTop: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--info-subtle)", border: "1px solid var(--info-subtle-border)", borderRadius: 8, fontSize: 12.5, lineHeight: 1.6 }}>
              {anchorAlreadyCounted
                ? <>עסקה זו כבר הייתה ביומן כשנקבעה נקודת הפתיחה של {formSymbol} ({anchorForForm.asOf}), ולכן היא כבר נספרת בה ולא תשנה את המחיר הממוצע שוב.</>
                : <>ל-{formSymbol} יש נקודת פתיחה (כמות ומחיר ממוצע) לתאריך {anchorForForm.asOf}. עסקה שמתוארכת לפני התאריך הזה נשמרת ביומן, אבל לא משנה את המחיר הממוצע.</>}
              {form.action === "מכירה" ? " לכן אי אפשר לחשב רווח/הפסד אוטומטית - הזן אותו ידנית." : ""}
            </div>
          )}
          {form.action === "מכירה" && form.pnlManual === "" && !anchorCoversDate && sellSuggestion?.warning === "no-history" && (
            <div role="alert" style={{ marginTop: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: 8, color: "var(--warning)", fontSize: 12.5, lineHeight: 1.6 }}>
              אין ביומן יחידות של {formSymbol} עד התאריך שנבחר, ולכן אי אפשר לחשב רווח/הפסד אוטומטית. הזן רווח/הפסד ידנית בשדה למעלה, או שמור בלי - אז יוצג &quot;-&quot; ולא 0. כדאי לבדוק שלא חסרה ביומן עסקת קנייה.
            </div>
          )}
          {form.action === "מכירה" && form.pnlManual === "" && sellSuggestion?.warning === "exceeds-holding" && (
            <div role="alert" style={{ marginTop: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: 8, color: "var(--warning)", fontSize: 12.5, lineHeight: 1.6 }}>
              אתה מוכר {fmtNum(qtyNum, qtyNum % 1 !== 0 ? 2 : 0)} יחידות של {formSymbol}, אבל ביומן יש רק {fmtNum(sellSuggestion.heldQty, sellSuggestion.heldQty % 1 !== 0 ? 2 : 0)} עד התאריך שנבחר. הכמות ביומן לא תרד מתחת ל-0, ולכן אי אפשר לחשב רווח/הפסד אוטומטית - הזן אותו ידנית. כנראה חסרה ביומן עסקת קנייה.
            </div>
          )}

          {tradeFormError && (
            <div style={{ marginTop: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
              {tradeFormError}
            </div>
          )}

          <div className="idash-form-actions" style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <Button variant="primary" onClick={submitTrade}><Check size={15} /> {editingId !== null ? "עדכן עסקה" : "שמור עסקה"}</Button>
            <Button variant="ghost" onClick={cancelForm}>ביטול</Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5, 1fr)", gap: 10, marginBottom: 14, alignItems: "end" }}>
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
        <Button variant="ghost" onClick={() => { setFSymbol("הכל"); setFAction("הכל"); setFFrom(""); setFTo(""); }}>נקה סינון</Button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>מציג {sortedTrades.length} מתוך {trades.length} עסקאות</div>
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>{selectedIds.size} נבחרו</span>
            {bulkDeleteConfirm ? (
              <>
                <span style={{ fontSize: 12, color: "var(--loss)" }}>למחוק לצמיתות?</span>
                <Button variant="danger" onClick={deleteSelectedTrades} style={{ padding: "5px 10px", fontSize: 12, gap: "var(--space-1)" }}>
                  <Check size={13} /> אישור
                </Button>
                <Button variant="ghost" onClick={() => setBulkDeleteConfirm(false)} style={{ padding: "5px 10px", fontSize: 12 }}>ביטול</Button>
              </>
            ) : (
              <>
                <Button variant="danger" onClick={() => setBulkDeleteConfirm(true)} style={{ padding: "5px 10px", fontSize: 12, gap: "var(--space-1)" }}>
                  <Trash2 size={13} /> מחק נבחרים
                </Button>
                <Button variant="ghost" onClick={() => setSelectedIds(new Set())} style={{ padding: "5px 10px", fontSize: 12 }}>נקה בחירה</Button>
              </>
            )}
          </div>
        )}
      </div>

      {sortedTrades.length === 0 ? (
        trades.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={24} />}
            title="עדיין אין עסקאות"
            subtitle="כל קנייה, מכירה, הפקדה או משיכה יופיעו כאן"
            actionLabel="+ הוסף עסקה ראשונה"
            onAction={openAddTradeForm}
          />
        ) : (
          <EmptyState
            compact
            icon={<Filter size={18} />}
            title="לא נמצאו עסקאות תואמות לסינון"
            actionLabel="נקה סינון"
            onAction={() => { setFSymbol("הכל"); setFAction("הכל"); setFFrom(""); setFTo(""); }}
          />
        )
      ) : (
      <>
      <div className="idash-scroll-hint">
        <ArrowLeftRight size={12} /> גלול הצידה כדי לראות את כל העמודות
      </div>
      <div className="idash-scroll-table" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "auto", maxHeight: 480 }}>
        <table>
          <thead style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}>
            <tr>
              <th className="center" style={{ width: 34 }}>
                <CheckboxCell checked={allVisibleSelected} indeterminate={someVisibleSelected && !allVisibleSelected} onChange={toggleSelectAllVisible} ariaLabel="בחר הכל" />
              </th>
              <th className="num">תאריך</th><th>נכס</th><th className="center">פעולה</th><th className="num">כמות</th>
              <th className="num">מחיר</th><th className="num">שווי כולל</th><th className="num">עמלה</th>
              <th className="num">רווח/הפסד</th><th className="num">תשואה%</th><th>אסטרטגיה</th><th>הערות</th><th className="center">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((t) => (
              <tr key={t.id} style={
                deleteConfirmId === t.id ? { background: "var(--loss-subtle)" }
                  : selectedIds.has(t.id) ? { background: "var(--accent-subtle)" }
                  : undefined
              }>
                <td className="center">
                  <CheckboxCell checked={selectedIds.has(t.id)} onChange={() => toggleSelectTrade(t.id)} ariaLabel={"בחר עסקה " + t.symbol + " " + t.date} />
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }}>{t.date}</td>
                <td style={{ fontWeight: 700 }}>{t.symbol}</td>
                <td className="center"><ActionBadge action={t.action} /></td>
                <td className="num">{fmtNum(t.qty, t.qty % 1 !== 0 ? 2 : 0)}</td>
                <td className="num">{formatMoney(t.price, privacyMode, { digits: 2 })}</td>
                <td className="num">{formatMoney(t.value, privacyMode)}</td>
                <td className="num" style={{ color: "var(--text-faint)" }}>{formatMoney(t.fee, privacyMode)}</td>
                <td className="num" style={{ fontWeight: 600, color: t.pnl == null ? "var(--text-faint)" : t.pnl >= 0 ? "var(--gain)" : "var(--loss)" }}>{t.pnl == null ? "-" : formatMoney(t.pnl, privacyMode)}</td>
                <td className="num" style={{ color: t.retPct == null ? "var(--text-faint)" : t.retPct >= 0 ? "var(--gain)" : "var(--loss)" }}>{t.retPct == null ? "-" : fmtPct(t.retPct)}</td>
                <td style={{ color: "var(--text-dim)" }}>{t.strategy}</td>
                <td style={{ color: "var(--text-faint)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.notes || ""}>{t.notes || "-"}</td>
                <td className="center">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    <Button variant="icon" onClick={() => startEdit(t)} aria-label="עריכה" title="עריכה"><Pencil size={13} /></Button>
                    {deleteConfirmId === t.id ? (
                      <>
                        <Button variant="danger" onClick={() => deleteTrade(t.id)} style={{ padding: "4px 8px", fontSize: 11.5, gap: "var(--space-1)" }}><Check size={12} /> אישור</Button>
                        <Button variant="icon" onClick={() => setDeleteConfirmId(null)} aria-label="ביטול" title="ביטול"><X size={13} /></Button>
                      </>
                    ) : (
                      <Button variant="icon" danger onClick={() => setDeleteConfirmId(t.id)} aria-label="מחיקה" title="מחיקה"><Trash2 size={13} /></Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      <div style={{ marginTop: "var(--space-5)", textAlign: "center", color: "var(--text-faint)", fontSize: 11.5 }}>
        כל הנתונים מבוססים על קובץ האקסל שהועלה · החישובים מתעדכנים אוטומטית עם כל עסקה שנוספה, נערכת או נמחקת
      </div>

      {importResult?.needsMapping && (
        <TradeColumnMappingModal
          request={importResult.needsMapping}
          fileName={importFileName}
          onCancel={closeImportModal}
          onContinue={(mapping) => {
            const request = importResult.needsMapping!;
            setImportResult(withSemanticChecks(parseWithManualMapping(request.table, request.headerRowIndex, mapping)));
          }}
        />
      )}
      {importResult && !importResult.needsMapping && (
        <TradeImportModal
          result={importResult}
          fileName={importFileName}
          privacyMode={privacyMode}
          duplicateRowNumbers={importDuplicateRows}
          onConfirm={confirmImport}
          onClose={closeImportModal}
        />
      )}
    </>
  );
}
