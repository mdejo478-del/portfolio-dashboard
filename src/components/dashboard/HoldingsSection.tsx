import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Wallet, RefreshCw, Archive, Plus, Check, X, Pencil, Trash2, ShieldCheck, AlertTriangle, ArrowLeftRight, Inbox, PieChart as PieChartIcon, Lock } from "lucide-react";
import type { Position } from "@/lib/portfolio";
import type { ExtendedQuote } from "@/lib/prices";
import type { EvaluatedPosition, PosEditFields, PositionFormState } from "@/components/dashboard/types";
import { EMPTY_POSITION_FORM } from "@/components/dashboard/constants";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { colorFor, tradingViewUrl, fmtNum, fmtPct, formatMoney, parseNum } from "@/components/dashboard/format";
import { Badge } from "@/components/dashboard/ui/Badge";
import { PageBanner, SectionTitle, Field } from "@/components/dashboard/ui/Layout";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import { ExtendedPriceBadge } from "@/components/dashboard/ExtendedPriceBadge";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

interface HoldingsSectionProps {
  evaluated: EvaluatedPosition[];
  positions: Position[];
  setPositions: Dispatch<SetStateAction<Position[]>>;
  nextPosIdRef: MutableRefObject<number>;
  pushUndoSnapshot: (label: string) => void;
  total: number;
  privacyMode: boolean;
  extendedPrices: Record<string, ExtendedQuote | null>;
  openDetail: (symbol: string) => void;
  pricesConfigured: boolean | null;
  lastPriceUpdate: Date | null;
  pricesLoading: boolean;
  priceError: string;
  refreshPrices: () => void;
  saveStatus: "idle" | "saving" | "error";
  backupRunning: boolean;
  backupDoneAt: number | null;
  onBackupNow: () => void;
}

export function HoldingsSection({
  evaluated, positions, setPositions, nextPosIdRef, pushUndoSnapshot, total, privacyMode, extendedPrices, openDetail,
  pricesConfigured, lastPriceUpdate, pricesLoading, priceError, refreshPrices, saveStatus, backupRunning, backupDoneAt, onBackupNow,
}: HoldingsSectionProps) {
  const isMobile = useIsMobile();
  const [editingPosId, setEditingPosId] = useState<number | null>(null);
  const [posEditFields, setPosEditFields] = useState<PosEditFields>({ qty: "", min: "", max: "", dilute: "" });
  const [deletePosConfirmId, setDeletePosConfirmId] = useState<number | null>(null);
  const [showAddPosition, setShowAddPosition] = useState<boolean>(false);
  const [posForm, setPosForm] = useState<PositionFormState>(EMPTY_POSITION_FORM);
  const [posFormError, setPosFormError] = useState<string>("");
  const addPositionRef = useRef<HTMLDivElement>(null);

  function openAddPositionForm() {
    setShowAddPosition(true);
    requestAnimationFrame(() => addPositionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const needsAction = evaluated.filter((p) => p.status !== "✅ תקין" && !p.hodl);
  const pieData = evaluated.map((p) => ({ name: p.symbol, value: p.value, weight: p.weight }));

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
      id: nextPosIdRef.current++, symbol, qty, price, value, weight: 0,
      dev: 0, min: 0, max: 1, dilute: 1.5, hodl: false,
    }]);
    setPosForm(EMPTY_POSITION_FORM);
    setPosFormError("");
    setShowAddPosition(false);
  }

  // Mobile: one card per position instead of a 13-column table you have to
  // scroll sideways through to compare numbers - same data/actions, just
  // stacked so everything for one holding is visible at a glance.
  function renderPositionCard(p: EvaluatedPosition, i: number) {
    const isEditing = editingPosId === p.id;
    return (
      <div key={p.id} style={{
        background: p.symbol === "CASH" ? "var(--row-highlight)" : "var(--panel)",
        border: "1px solid var(--border)", borderRadius: 14, padding: 14, marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-2)", marginBottom: 10 }}>
          <div
            onClick={() => openDetail(p.symbol)}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 700, fontSize: 16.5, cursor: p.symbol !== "CASH" ? "pointer" : "default" }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 999, background: colorFor(p.symbol, i), flexShrink: 0 }} />
            {tradingViewUrl(p.symbol) ? (
              <a href={tradingViewUrl(p.symbol) || undefined} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "var(--text)", textDecoration: "none", borderBottom: "1px dashed var(--text-faint)" }}>
                {p.symbol}
              </a>
            ) : p.symbol}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Badge tone={p.tone} size="md">{p.status}</Badge>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600 }}>שווי</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 21, fontWeight: 700, color: p.symbol === "CASH" ? "var(--text)" : undefined }}>
              {formatMoney(p.value, privacyMode)}
            </div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600 }}>משקל</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 21, fontWeight: 700 }}>{fmtPct(p.weight)}</div>
          </div>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontSize: 14,
          paddingTop: 10, borderTop: "1px solid var(--border)",
        }}>
          <CardStat label="כמות">
            {isEditing ? (
              <input type="text" inputMode="decimal" autoFocus value={posEditFields.qty} onChange={(e) => updatePosEditField("qty", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
            ) : (
              p.qty !== null && p.qty !== undefined ? fmtNum(p.qty, p.qty % 1 !== 0 ? 2 : 0) : (p.symbol === "CASH" ? "—" : "-")
            )}
          </CardStat>
          <CardStat label="מחיר">
            {p.price !== null && p.price !== undefined
              ? formatMoney(p.price, privacyMode, { digits: 2 })
              : p.symbol === "CASH" ? "—" : <span title="לא הצלחנו לעדכן מחיר עבור נכס זה" style={{ color: "var(--text-faint)" }}>לא זמין</span>}
            <ExtendedPriceBadge quote={extendedPrices[p.symbol]} privacyMode={privacyMode} />
          </CardStat>
          <CardStat label="סטייה">
            <span style={{ color: p.dev < 0 ? "var(--loss)" : p.dev > 0 ? "var(--gain)" : "var(--text-faint)" }}>{p.dev === 0 ? "0.00%" : fmtPct(p.dev)}</span>
          </CardStat>
          <CardStat label="עדיפות">
            <Badge tone={p.priority === "גבוהה" ? "red" : p.priority === "בינונית" ? "amber" : "green"} size="md">{p.priority}</Badge>
          </CardStat>
          {isEditing ? (
            <>
              <CardStat label="יעד מינימום">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posEditFields.min} onChange={(e) => updatePosEditField("min", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                </span>
              </CardStat>
              <CardStat label="יעד מקסימום">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posEditFields.max} onChange={(e) => updatePosEditField("max", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                </span>
              </CardStat>
              <CardStat label="רף דילול">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posEditFields.dilute} onChange={(e) => updatePosEditField("dilute", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                </span>
              </CardStat>
            </>
          ) : (
            <>
              <CardStat label="יעד">{fmtPct(p.min, 0)} – {fmtPct(p.max, 0)}</CardStat>
              <CardStat label="רף דילול">{fmtPct(p.dilute, 0)}</CardStat>
            </>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <span style={{
            display: "block", fontWeight: 700, fontSize: 14, textAlign: "center",
            color: TONE_STYLES[p.tone].text, background: TONE_STYLES[p.tone].bg,
            border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: 8, padding: "8px 10px",
          }}>{p.action}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: 10 }}>
          {isEditing ? (
            <>
              <button type="button" className="icon-btn" onClick={() => savePosQty(p)} aria-label="שמור" title="שמור"><Check size={15} /></button>
              <button type="button" className="icon-btn" onClick={cancelPosEdit} aria-label="ביטול" title="ביטול"><X size={15} /></button>
            </>
          ) : (
            <button type="button" className="icon-btn" onClick={() => startEditPosQty(p)} aria-label="ערוך כמות ויעדים" title="ערוך כמות ויעדי הקצאה"><Pencil size={15} /></button>
          )}
          {p.symbol === "CASH" ? (
            <span style={{ color: "var(--text-faint)", display: "inline-flex", alignItems: "center", padding: "0 4px" }} title="שורת המזומן מסונכרנת עם יומן המסחר ולא ניתנת להסרה"><Lock size={13} /></span>
          ) : deletePosConfirmId === p.id ? (
            <>
              <button type="button" onClick={() => deletePosition(p.id)} style={{ background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", color: "var(--loss)", borderRadius: 7, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-1)" }}><Check size={13} /> אישור</button>
              <button type="button" onClick={() => setDeletePosConfirmId(null)} className="icon-btn" aria-label="ביטול" title="ביטול"><X size={15} /></button>
            </>
          ) : (
            <button type="button" className="icon-btn danger" onClick={() => setDeletePosConfirmId(p.id)} aria-label="הסר נכס" title="הסר נכס"><Trash2 size={15} /></button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageBanner icon={<Wallet size={20} />} title="החזקות בתיק" subtitle="כל הנכסים, המשקלים ויעדי ההקצאה במקום אחד" />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: "var(--space-3)" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {pricesConfigured === false
            ? "לא הצלחנו לעדכן מחירים כרגע."
            : lastPriceUpdate
              ? "מחירים עודכנו לאחרונה: " + lastPriceUpdate.toLocaleTimeString("he-IL")
              : <>טוען מחירים <span className="ds-skeleton" style={{ display: "inline-block", width: 70, height: 10, borderRadius: 4, verticalAlign: "middle" }} /></>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 11.5,
            color: saveStatus === "error" ? "var(--loss)" : "var(--text-faint)",
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
          <button type="button" className="ghost" onClick={onBackupNow} disabled={backupRunning}
            title="שומר עותק גיבוי מיידי של נתוני התיק, בנוסף לגיבוי האוטומטי"
            style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {backupRunning ? (
              <><RefreshCw size={14} className="spin-icon" /> יוצר גיבוי...</>
            ) : backupDoneAt !== null ? (
              <>✓ גיבוי נוצר</>
            ) : (
              <><Archive size={14} /> צור גיבוי עכשיו</>
            )}
          </button>
        </div>
      </div>
      {priceError && (
        <div style={{ marginBottom: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
          {priceError}
        </div>
      )}

      {isMobile ? (
        <div style={{ marginBottom: "var(--space-5)" }}>
          {tableRows.map(({ p, i }) => renderPositionCard(p, i))}
          {evaluated.length === 0 && (
            <EmptyState
              icon={<Inbox size={24} />}
              title="עדיין אין פוזיציות בתיק"
              subtitle="התחל בהוספת מניה או הפקדת מזומן"
              actionLabel="+ הוסף פוזיציה ראשונה"
              onAction={openAddPositionForm}
            />
          )}
          {evaluated.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 16px",
            }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>סך הכל התיק</span>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: "var(--gain)" }}>{formatMoney(total, privacyMode)}</span>
            </div>
          )}
        </div>
      ) : (
      <>
      <div className="idash-scroll-hint">
        <ArrowLeftRight size={12} /> גלול הצידה כדי לראות את כל העמודות
      </div>
      <div className="idash-scroll-table holdings-table" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, overflow: "auto", marginBottom: "var(--space-5)" }}>
        <table>
          <colgroup>
            <col style={{ width: 100 }} /><col style={{ width: 68 }} /><col style={{ width: 88 }} /><col style={{ width: 78 }} />
            <col style={{ width: 58 }} /><col style={{ width: 145 }} /><col style={{ width: 181 }} /><col style={{ width: 52 }} />
            <col style={{ width: 50 }} /><col style={{ width: 50 }} /><col style={{ width: 55 }} /><col style={{ width: 66 }} />
            <col style={{ width: 92 }} />
          </colgroup>
          <thead style={{ background: "var(--panel)" }}>
            <tr>
              <th>נכס</th><th className="num">כמות</th><th className="num">מחיר</th><th className="num">שווי</th>
              <th className="num">משקל</th><th className="center">סטטוס</th><th className="center">פעולה מומלצת</th>
              <th className="num tight">סטייה</th><th className="num tight" title="יעד מינימום">מינ&apos;</th>
              <th className="num tight" title="יעד מקסימום">מקס&apos;</th><th className="num tight" title="רף דילול">דילול</th>
              <th className="center tight">עדיפות</th><th className="center">ניהול</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ p, i }) => (
              <tr key={p.id} className={p.symbol === "CASH" ? "row-cash" : undefined}>
                <td
                  onClick={() => openDetail(p.symbol)}
                  title={p.symbol !== "CASH" ? "פתח כרטיס פרטי מניה" : undefined}
                  style={{ fontWeight: 700, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: "var(--space-2)", cursor: p.symbol !== "CASH" ? "pointer" : "default" }}
                >
                  {tradingViewUrl(p.symbol) ? (
                    <a href={tradingViewUrl(p.symbol) || undefined} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="symbol-link"
                      title={"פתח גרף TradingView עבור " + p.symbol}>
                      {p.symbol}
                    </a>
                  ) : p.symbol}
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: colorFor(p.symbol, i), display: "inline-block", flexShrink: 0 }} />
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }}>
                  {editingPosId === p.id ? (
                    <input type="text" inputMode="decimal" autoFocus value={posEditFields.qty} onChange={(e) => updatePosEditField("qty", e.target.value)}
                      style={{ width: 56 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
                  ) : (
                    p.qty !== null && p.qty !== undefined ? fmtNum(p.qty, p.qty % 1 !== 0 ? 2 : 0) : (p.symbol === "CASH" ? "—" : "-")
                  )}
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }} title={extendedPrices[p.symbol] ? (extendedPrices[p.symbol]?.session === "pre" ? "טרום-פתיחה" : "אחרי סגירה") + ": " + formatMoney(extendedPrices[p.symbol]!.price, privacyMode, { digits: 2 }) : undefined}>
                  {p.price !== null && p.price !== undefined
                    ? formatMoney(p.price, privacyMode, { digits: 2 })
                    : p.symbol === "CASH" ? "—" : <span title="לא הצלחנו לעדכן מחיר עבור נכס זה" style={{ color: "var(--text-faint)" }}>לא זמין</span>}
                </td>
                <td className="num" style={{ fontWeight: p.symbol === "CASH" ? 700 : 600, color: p.symbol === "CASH" ? "var(--text)" : undefined }}>{formatMoney(p.value, privacyMode)}</td>
                <td className="num">{fmtPct(p.weight)}</td>
                <td className="center"><Badge tone={p.tone} size="md">{p.status}</Badge></td>
                <td className="center">
                  <span title={p.action} style={{
                    display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
                    fontWeight: 700, fontSize: 14,
                    color: TONE_STYLES[p.tone].text, background: TONE_STYLES[p.tone].bg,
                    border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: 8,
                    padding: "6px 11px", whiteSpace: "nowrap",
                  }}>{p.action}</span>
                </td>
                <td className="num tight" style={{ color: p.dev < 0 ? "var(--loss)" : p.dev > 0 ? "var(--gain)" : "var(--text-faint)" }}>{p.dev === 0 ? "0.00%" : fmtPct(p.dev)}</td>
                <td className="num tight" style={{ color: "var(--text-faint)" }}>
                  {editingPosId === p.id ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                      <input type="text" inputMode="decimal" value={posEditFields.min} onChange={(e) => updatePosEditField("min", e.target.value)}
                        style={{ width: 34, padding: "6px 3px", textAlign: "center" }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                    </span>
                  ) : fmtPct(p.min, 0)}
                </td>
                <td className="num tight" style={{ color: "var(--text-faint)" }}>
                  {editingPosId === p.id ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                      <input type="text" inputMode="decimal" value={posEditFields.max} onChange={(e) => updatePosEditField("max", e.target.value)}
                        style={{ width: 34, padding: "6px 3px", textAlign: "center" }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                    </span>
                  ) : fmtPct(p.max, 0)}
                </td>
                <td className="num tight" style={{ color: "var(--text-faint)" }}>
                  {editingPosId === p.id ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                      <input type="text" inputMode="decimal" value={posEditFields.dilute} onChange={(e) => updatePosEditField("dilute", e.target.value)}
                        style={{ width: 34, padding: "6px 3px", textAlign: "center" }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />%
                    </span>
                  ) : fmtPct(p.dilute, 0)}
                </td>
                <td className="center tight"><Badge tone={p.priority === "גבוהה" ? "red" : p.priority === "בינונית" ? "amber" : "green"} size="md">{p.priority}</Badge></td>
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
                      <span style={{ color: "var(--text-faint)", display: "inline-flex", alignItems: "center", padding: "0 4px" }} title="שורת המזומן מסונכרנת עם יומן המסחר ולא ניתנת להסרה"><Lock size={13} /></span>
                    ) : deletePosConfirmId === p.id ? (
                      <>
                        <button type="button" onClick={() => deletePosition(p.id)} style={{ background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", color: "var(--loss)", borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-1)" }}><Check size={12} /> אישור</button>
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
              <tr><td colSpan={13} style={{ padding: 0, border: "none" }}>
                <EmptyState
                  icon={<Inbox size={24} />}
                  title="עדיין אין פוזיציות בתיק"
                  subtitle="התחל בהוספת מניה או הפקדת מזומן"
                  actionLabel="+ הוסף פוזיציה ראשונה"
                  onAction={openAddPositionForm}
                />
              </td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--panel-2)" }}>
              <td colSpan={3} style={{ fontWeight: 700, fontSize: 16, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 12px" }}>סך הכל התיק</td>
              <td className="num" style={{ fontWeight: 700, fontSize: 17, color: "var(--gain)", borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 12px" }}>{formatMoney(total, privacyMode)}</td>
              <td className="num" style={{ fontWeight: 700, fontSize: 13.5, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 4px" }}>100.0%</td>
              <td colSpan={8} style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }} />
            </tr>
          </tfoot>
        </table>
      </div>
      </>
      )}

      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: "var(--space-5)" }}>
        לחיצה על העיפרון {isMobile ? "" : "בכל שורה "}מאפשרת לערוך כמות ויעדי הקצאה (מינימום/מקסימום/רף דילול) לכל נכס.
      </div>

      <div style={{ marginBottom: "var(--space-5)" }}>
        {showAddPosition ? (
          <div ref={addPositionRef} style={{ background: "var(--panel)", border: "1px solid var(--accent-subtle-border)", borderRadius: 14, padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Plus size={15} color="var(--accent)" /> הוספת נכס חדש לתיק
              </div>
              <button type="button" className="icon-btn" onClick={() => { setShowAddPosition(false); setPosForm(EMPTY_POSITION_FORM); setPosFormError(""); }}><X size={15} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: "var(--space-3)" }}>
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
              <div style={{ marginTop: 10, padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
                {posFormError}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-faint)" }}>
              שווי יחושב אוטומטית (כמות × מחיר) והמשקלים בתיק יתעדכנו בהתאם. יעדי הקצאה לנכס חדש יוגדרו כברירת מחדל וניתן יהיה לעדכן בהמשך.
            </div>
          </div>
        ) : (
          <button
            type="button" className="primary" onClick={openAddPositionForm}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 22px", fontSize: 14 }}
          >
            <Plus size={16} /> הוסף נכס לתיק
          </button>
        )}
      </div>

      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 30, maxWidth: 640, marginRight: "auto", marginLeft: "auto" }}>
        <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 700, marginBottom: "var(--space-4)", textAlign: "center" }}>הקצאת נכסים</div>
        {pieData.length === 0 ? (
          <EmptyState
            compact
            icon={<PieChartIcon size={18} />}
            title="אין עדיין נתונים להצגה"
            subtitle="ברגע שתוסיף פוזיציה, הקצאת התיק תופיע כאן כגרף עוגה"
          />
        ) : (
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
        )}
      </div>

      <SectionTitle icon={<ShieldCheck size={16} />} text="המלצות Position Sizing" />
      <div style={{ marginBottom: 34 }}>
        {evaluated.length === 0 ? (
          <EmptyState
            compact
            icon={<ShieldCheck size={18} />}
            title="אין עדיין המלצות"
            subtitle="המלצות לאיזון והתאמת פוזיציות יופיעו כאן ברגע שיתווספו נכסים לתיק"
          />
        ) : needsAction.length === 0 ? (
          <div style={{ background: "var(--gain-subtle)", border: "1px solid var(--gain-subtle-border)", borderRadius: 14, padding: "var(--space-4)", display: "flex", alignItems: "center", gap: 10, color: "var(--gain)", fontSize: 13.5 }}>
            <ShieldCheck size={18} /> כל הנכסים במשקל היעד – אין פעולות נדרשות כרגע.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
            {needsAction.map((p) => (
              <div key={p.symbol} style={{ background: "var(--panel)", border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
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
    </>
  );
}

function CardStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>{children}</span>
    </div>
  );
}
