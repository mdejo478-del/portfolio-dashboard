import { useMemo, useRef, useState, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  TrendingUp, TrendingDown, Wallet, Percent, Receipt, ListChecks, Plus,
  Pencil, Trash2, Download, X, Check, Filter, RefreshCw, Upload, Activity, ArrowLeftRight,
  PiggyBank, ArrowDownCircle, Scale,
} from "lucide-react";
import { cashEffect } from "@/lib/portfolioTypes";
import type { Position, Trade, Ledger } from "@/lib/portfolio";
import type { TradeFormState } from "@/components/dashboard/types";
import { ACTION_OPTS, STRATEGY_OPTS, SYMOPTS, EMPTY_FORM } from "@/components/dashboard/constants";
import { fmtUSD, fmtPct, fmtNum, formatMoney, parseNum, csvEscape, mapStrategyToOption } from "@/components/dashboard/format";
import { ActionBadge } from "@/components/dashboard/ui/Badge";
import { Card } from "@/components/dashboard/ui/Card";
import { PageBanner, Field, SectionTitle } from "@/components/dashboard/ui/Layout";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import TradeImportModal from "@/components/TradeImportModal";
import { parseTradeFile, parseTradeWorkbook, type ParseResult, type ParsedTradeRow } from "@/lib/tradeImport";
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
  positions: Position[];
  pushUndoSnapshot: (label: string) => void;
  nextIdRef: MutableRefObject<number>;
  applyCashDelta: (delta: number) => void;
  cashFree: number;
  stats: TradeStats;
  privacyMode: boolean;
}

export function TradeJournalSection({
  trades, setTrades, ledger, setLedger, positions, pushUndoSnapshot, nextIdRef, applyCashDelta, cashFree, stats, privacyMode,
}: TradeJournalSectionProps) {
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TradeFormState>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [tradeFormError, setTradeFormError] = useState<string>("");

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
        id: nextIdRef.current++, date: row.date as string, symbol, action, qty, price, value,
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
      const newTrade: Trade = { id: nextIdRef.current++, date: form.date, symbol, action: form.action, qty, price, value, fee, pnl, retPct, strategy: form.strategy, notes: form.notes || null };
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
    <>
      {/* Trade journal banner */}
      <PageBanner icon={<ListChecks size={20} />} title="יומן מסחר חכם ומקצועי (Smart Trade Log)" subtitle="כל העסקאות, הסיכומים והפעולות במקום אחד" />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(6, 1fr)", gap: isMobile ? 10 : 14, marginBottom: 22 }}>
        <Card label="מזומן פנוי" value={formatMoney(cashFree, privacyMode)} icon={<Wallet size={15} color="#8B98AB" />} />
        <Card label="רווח/הפסד ממומש" value={formatMoney(stats.realizedPnl, privacyMode)} tone={stats.realizedPnl >= 0 ? "green" : "red"} icon={stats.realizedPnl >= 0 ? <TrendingUp size={15} color="#5BE39D" /> : <TrendingDown size={15} color="#FF8589" />} />
        <Card label="אחוז הצלחה" value={fmtPct(stats.winRate)} sub={stats.sellCount + " עסקאות מכירה"} icon={<Percent size={15} color="#8B98AB" />} />
        <Card label="מספר עסקאות" value={fmtNum(stats.buysSells)} sub={trades.length + " שורות כולל"} icon={<Activity size={15} color="#8B98AB" />} />
        <Card label="סך עמלות" value={formatMoney(stats.fees, privacyMode)} tone="red" icon={<Receipt size={15} color="#FF8589" />} />
        <Card label="ממוצע רווח לעסקה" value={formatMoney(stats.avgPnl, privacyMode)} tone={stats.avgPnl >= 0 ? "green" : "red"} sub={fmtPct(stats.avgRet) + " תשואה ממוצעת"} icon={stats.avgPnl >= 0 ? <TrendingUp size={15} color="#5BE39D" /> : <TrendingDown size={15} color="#FF8589" />} />
      </div>

      <SectionTitle icon={<Scale size={16} />} text="סיכום ביצועים כספיים" />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: isMobile ? 10 : 14, marginBottom: 22 }}>
        <Card label="סה״כ הפקדות" value={formatMoney(stats.deposits, privacyMode)} tone="blue" icon={<PiggyBank size={15} color="#7FBBFA" />} />
        <Card label="סה״כ משיכות" value={formatMoney(stats.withdrawals, privacyMode)} tone="amber" icon={<ArrowDownCircle size={15} color="#F5BE6B" />} />
        <Card label="סה״כ עמלות ששולמו" value={formatMoney(stats.fees, privacyMode)} tone="red" icon={<Receipt size={15} color="#FF8589" />} />
        <Card label="רווח/הפסד ממומש" value={formatMoney(stats.realizedPnl, privacyMode)} tone={stats.realizedPnl >= 0 ? "green" : "red"} icon={stats.realizedPnl >= 0 ? <TrendingUp size={15} color="#5BE39D" /> : <TrendingDown size={15} color="#FF8589" />} />
        <Card label="Net P&L" value={formatMoney(stats.netPnl, privacyMode)} tone={stats.netPnl >= 0 ? "green" : "red"} sub="רווח/הפסד ממומש בניכוי עמלות" icon={<Scale size={15} color={stats.netPnl >= 0 ? "#5BE39D" : "#FF8589"} />} />
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
        <div ref={formRef} style={{ background: "var(--panel)", border: "1px solid " + (editingId !== null ? "rgba(79,163,247,0.4)" : "var(--border)"), borderRadius: 14, padding: 18, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 8 }}>
              {editingId !== null ? <Pencil size={15} color="#7FBBFA" /> : <Plus size={15} color="var(--accent)" />}
              {editingId !== null ? "עריכת עסקה" : "עסקה חדשה"}
            </div>
            <button type="button" className="icon-btn" onClick={cancelForm}><X size={15} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: 12 }}>
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
            <div style={{ gridColumn: isMobile ? "auto" : "span 2" }}>
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

          <div className="idash-form-actions" style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" onClick={submitTrade} className="primary" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Check size={15} /> {editingId !== null ? "עדכן עסקה" : "שמור עסקה"}</button>
            <button type="button" className="ghost" onClick={cancelForm}>ביטול</button>
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
        <button type="button" className="ghost" onClick={() => { setFSymbol("הכל"); setFAction("הכל"); setFFrom(""); setFTo(""); }}>נקה סינון</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>מציג {sortedTrades.length} מתוך {trades.length} עסקאות</div>

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
      <div className="idash-scroll-table" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, overflow: "auto", maxHeight: 480 }}>
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
          </tbody>
        </table>
      </div>
      </>
      )}

      <div style={{ marginTop: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 11.5 }}>
        כל הנתונים מבוססים על קובץ האקסל שהועלה · החישובים מתעדכנים אוטומטית עם כל עסקה שנוספה, נערכת או נמחקת
      </div>

      {importResult && (
        <TradeImportModal
          result={importResult}
          fileName={importFileName}
          onConfirm={confirmImport}
          onClose={closeImportModal}
        />
      )}
    </>
  );
}
