import { useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { Wallet, RefreshCw, Archive, Plus, Check, X, Pencil, Trash2, ShieldCheck, AlertTriangle, ArrowLeftRight, Inbox, Lock } from "lucide-react";
import type { Position, RangeWidthPreference } from "@/lib/portfolio";
// From portfolioTypes.ts, not portfolio.ts - this is a client component, and
// portfolio.ts does Node-only file I/O that must never reach the browser
// bundle (see the warning comment at the top of portfolioTypes.ts).
import { equalWeightTarget, suggestedPositionRange, totalPositionReturn } from "@/lib/portfolioTypes";
import { PositionReturnValue } from "@/components/dashboard/PositionReturnValue";
import type { ExtendedQuote } from "@/lib/prices";
import type { MorningBriefResult } from "@/app/actions/morningBrief";
import type { BigMover } from "@/components/dashboard/morningBriefUtils";
import type { EvaluatedPosition, PosEditFields, PositionFormState } from "@/components/dashboard/types";
import { EMPTY_POSITION_FORM } from "@/components/dashboard/constants";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { colorFor, tradingViewUrl, fmtNum, fmtPct, formatMoney, parseNum, PRIVACY_MASK } from "@/components/dashboard/format";
import { Badge } from "@/components/dashboard/ui/Badge";
import { Button } from "@/components/dashboard/ui/Button";
import { PageBanner, SectionTitle, Field } from "@/components/dashboard/ui/Layout";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import { ExtendedPriceBadge } from "@/components/dashboard/ExtendedPriceBadge";
import { PriceStatusMark } from "@/components/dashboard/PriceStatusMark";
import type { PriceInfo, PriceSummary } from "@/lib/priceStatus";
import { validatePosition, newErrors } from "@/lib/validation";
import { AllocationCard } from "@/components/dashboard/AllocationCard";
import { MorningBriefCard } from "@/components/dashboard/MorningBriefCard";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

interface HoldingsSectionProps {
  evaluated: EvaluatedPosition[];
  positions: Position[];
  setPositions: Dispatch<SetStateAction<Position[]>>;
  nextPosIdRef: MutableRefObject<number>;
  pushUndoSnapshot: (label: string) => void;
  total: number;
  privacyMode: boolean;
  rangeWidthPreference: RangeWidthPreference;
  extendedPrices: Record<string, ExtendedQuote | null>;
  priceInfo: Record<string, PriceInfo>;
  priceSummary: PriceSummary;
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
  morningBrief: MorningBriefResult | null;
  bigMovers: BigMover[];
  morningBriefLoading: boolean;
  morningBriefError: string;
  onOpenMorningBrief: () => void;
}

export function HoldingsSection({
  evaluated, positions, setPositions, nextPosIdRef, pushUndoSnapshot, total, privacyMode, rangeWidthPreference, extendedPrices, priceInfo, priceSummary, openDetail,
  pricesConfigured, lastPriceUpdate, pricesLoading, priceError, refreshPrices, saveStatus, backupRunning, backupDoneAt, onBackupNow,
  morningBrief, bigMovers, morningBriefLoading, morningBriefError, onOpenMorningBrief,
}: HoldingsSectionProps) {
  const isMobile = useIsMobile();
  const [editingPosId, setEditingPosId] = useState<number | null>(null);
  const [posEditFields, setPosEditFields] = useState<PosEditFields>({ qty: "", min: "", max: "", dilute: "", priceTarget: "", avgCost: "" });
  const [deletePosConfirmId, setDeletePosConfirmId] = useState<number | null>(null);
  const [showAddPosition, setShowAddPosition] = useState<boolean>(false);
  const [posForm, setPosForm] = useState<PositionFormState>(EMPTY_POSITION_FORM);
  const [posFormError, setPosFormError] = useState<string>("");
  // Why an inline edit of an existing position was not applied (see savePosQty).
  const [posEditError, setPosEditError] = useState<string>("");
  const addPositionRef = useRef<HTMLDivElement>(null);

  // Suggested min/max/dilute for the *next* position added, so a new holding
  // starts near an equal-weight target among the existing (non-CASH)
  // positions instead of a flat assumed-~10%-portfolio default - width
  // around that target comes from the user's saved range-width preference
  // (onboarding questionnaire / settings), not from any judgment about the
  // specific symbol being added. Declared above openAddPositionForm, which
  // reads it: the React Compiler can't preserve a memo that a function
  // captures before the memo's own declaration.
  const suggestedNewPositionRange = useMemo(() => {
    const nonCashCount = positions.filter((p) => p.symbol !== "CASH").length;
    const target = equalWeightTarget(nonCashCount);
    return suggestedPositionRange(target, rangeWidthPreference);
  }, [positions, rangeWidthPreference]);

  // Roll-up over only the positions that have an average cost entered, so
  // the footer can say how much of the portfolio the figure covers instead of
  // implying it's the whole portfolio's return.
  const totalReturn = useMemo(() => totalPositionReturn(positions), [positions]);

  // An extended-hours price is shown in italics with a dotted underline (and a
  // tooltip naming the session and the regular close) so it can't be mistaken
  // for a regular-session price.
  function extendedPriceStyle(symbol: string): CSSProperties | undefined {
    const info = priceInfo[symbol];
    if (!info || info.status === "pending" || info.status === "missing" || info.session === "regular") return undefined;
    return { fontStyle: "italic", textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "help" };
  }

  function openAddPositionForm() {
    setShowAddPosition(true);
    // Pre-fill min/max/dilute with the actual suggested numbers as real,
    // visible, editable field values - not just a placeholder hint. A
    // placeholder disappears the moment the field is focused/typed into and
    // is never submitted if left blank; a user who doesn't understand what
    // to enter (the exact case this feature exists for) could easily leave
    // it looking "empty" and end up submitting an unintended 0%/blank range.
    // Pre-filling means what's visibly in the field is exactly what gets
    // saved if untouched, and it's still fully editable like any other field.
    setPosForm((f) => ({
      ...f,
      min: fmtNum(suggestedNewPositionRange.min * 100, 1),
      max: fmtNum(suggestedNewPositionRange.max * 100, 1),
      dilute: fmtNum(suggestedNewPositionRange.dilute * 100, 1),
    }));
    requestAnimationFrame(() => addPositionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const needsAction = evaluated.filter((p) => p.status !== "✅ תקין" && !p.hodl);

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
    setPosEditError("");
    setEditingPosId(p.id);
    setPosEditFields({
      qty: p.symbol === "CASH" ? String(p.value) : String(p.qty),
      min: String(Math.round(p.min * 1000) / 10),
      max: String(Math.round(p.max * 1000) / 10),
      dilute: String(Math.round(p.dilute * 1000) / 10),
      priceTarget: p.priceTarget != null ? String(p.priceTarget) : "",
      avgCost: p.avgCost != null ? String(p.avgCost) : "",
    });
  }
  function cancelPosEdit() { setPosEditError(""); setEditingPosId(null); setPosEditFields({ qty: "", min: "", max: "", dilute: "", priceTarget: "", avgCost: "" }); }
  function updatePosEditField(field: keyof PosEditFields, val: string) { setPosEditFields((f) => ({ ...f, [field]: val })); }
  function savePosQty(p: Position) {
    const qtyNum = parseNum(posEditFields.qty);
    const minNum = parseNum(posEditFields.min);
    const maxNum = parseNum(posEditFields.max);
    const diluteNum = parseNum(posEditFields.dilute);
    const priceTargetNum = parseNum(posEditFields.priceTarget);
    if (Number.isNaN(qtyNum) || qtyNum < 0) { cancelPosEdit(); return; }
    const min = !Number.isNaN(minNum) ? minNum / 100 : p.min;
    const max = !Number.isNaN(maxNum) ? maxNum / 100 : p.max;
    const dilute = !Number.isNaN(diluteNum) ? diluteNum / 100 : p.dilute;
    // Blank field = no price target (clears it); a valid number sets it;
    // anything else unparseable keeps whatever was already saved.
    const priceTarget = posEditFields.priceTarget.trim() === "" ? null : (!Number.isNaN(priceTargetNum) ? priceTargetNum : (p.priceTarget ?? null));
    // Same blank/valid/unparseable rules as the price target above, except a
    // non-positive average cost is also treated as unusable (a return can't
    // be computed from it) and keeps the previous value rather than saving
    // something that would silently show no return.
    const avgCostNum = parseNum(posEditFields.avgCost);
    const avgCost = posEditFields.avgCost.trim() === "" ? null : (!Number.isNaN(avgCostNum) && avgCostNum > 0 ? avgCostNum : (p.avgCost ?? null));
    // Refuse a range or target that doesn't make sense (e.g. min above max) and
    // say why, keeping the edit open. Only problems this edit would ADD count -
    // a position that already had one before can still have its quantity edited.
    const candidate: Position = { ...p, min, max, dilute, priceTarget, qty: qtyNum, avgCost, value: p.symbol === "CASH" ? qtyNum : qtyNum * (p.price ?? 0) };
    const introduced = newErrors(validatePosition(candidate), validatePosition(p));
    if (introduced.length > 0) { setPosEditError(introduced[0].message); return; }
    pushUndoSnapshot("עריכת נכס בתיק");
    setPositions((ps) => ps.map((row) => {
      if (row.id !== p.id) return row;
      const updated = { ...row, min, max, dilute, priceTarget };
      if (row.symbol === "CASH") return { ...updated, value: qtyNum };
      return { ...updated, avgCost, qty: qtyNum, value: qtyNum * (row.price ?? 0) };
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
    // Allocation targets are optional at add-time - a blank field falls back
    // to the equal-weight-among-existing-positions suggestion (shaped by the
    // user's saved range-width preference - see suggestedNewPositionRange
    // above) rather than a flat assumed-~10%-portfolio default, so a
    // quick-added position still gets a sane starting range instead of an
    // effectively unmanaged one.
    const minNum = parseNum(posForm.min);
    const maxNum = parseNum(posForm.max);
    const diluteNum = parseNum(posForm.dilute);
    const min = !Number.isNaN(minNum) ? minNum / 100 : suggestedNewPositionRange.min;
    const max = !Number.isNaN(maxNum) ? maxNum / 100 : suggestedNewPositionRange.max;
    const dilute = !Number.isNaN(diluteNum) ? diluteNum / 100 : suggestedNewPositionRange.dilute;
    const priceTargetNum = parseNum(posForm.priceTarget);
    const priceTarget = !Number.isNaN(priceTargetNum) ? priceTargetNum : null;
    // Optional. Unlike price/qty above, a bad value here is a validation
    // error rather than silently dropped - the user typed it on purpose, and
    // a quietly-ignored average cost would just look like the feature broke.
    const avgCostNum = parseNum(posForm.avgCost);
    if (posForm.avgCost.trim() !== "" && (Number.isNaN(avgCostNum) || avgCostNum <= 0)) {
      setPosFormError("מחיר ממוצע חייב להיות מספר גדול מ-0 (או להשאיר ריק).");
      return;
    }
    const avgCost = posForm.avgCost.trim() === "" ? null : avgCostNum;
    const introduced = newErrors(validatePosition({
      id: -1, symbol, qty, price, value: qty * price, weight: 0, dev: 0, min, max, dilute, hodl: false, priceTarget, avgCost,
    }), []);
    if (introduced.length > 0) { setPosFormError(introduced[0].message); return; }
    pushUndoSnapshot("הוספת נכס לתיק");
    const value = qty * price;
    setPositions((ps) => [...ps, {
      id: nextPosIdRef.current++, symbol, qty, price, value, weight: 0,
      dev: 0, min, max, dilute, hodl: false, priceTarget, avgCost,
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
        border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14, marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-2)", marginBottom: 10 }}>
          <div
            onClick={() => openDetail(p.symbol)}
            className={p.symbol !== "CASH" ? "detail-trigger" : undefined}
            role={p.symbol !== "CASH" ? "button" : undefined}
            tabIndex={p.symbol !== "CASH" ? 0 : undefined}
            onKeyDown={p.symbol !== "CASH" ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p.symbol); } } : undefined}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 700, fontSize: 16.5, cursor: p.symbol !== "CASH" ? "pointer" : "default" }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "var(--radius-full)", background: colorFor(p.symbol, i), flexShrink: 0 }} />
            {tradingViewUrl(p.symbol) ? (
              <a href={tradingViewUrl(p.symbol) || undefined} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="symbol-link">
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
              ? <span style={extendedPriceStyle(p.symbol)}>{formatMoney(p.price, privacyMode, { digits: 2 })}</span>
              : p.symbol === "CASH" ? "—" : <span title="לא הצלחנו לעדכן מחיר עבור נכס זה" style={{ color: "var(--text-faint)" }}>לא זמין</span>}
            {p.symbol !== "CASH" && <PriceStatusMark info={priceInfo[p.symbol]} />}
            <ExtendedPriceBadge quote={extendedPrices[p.symbol]} privacyMode={privacyMode} />
          </CardStat>
          {p.symbol !== "CASH" && (
            <>
              <CardStat label="מחיר ממוצע">
                {isEditing ? (
                  <input type="text" inputMode="decimal" value={posEditFields.avgCost} onChange={(e) => updatePosEditField("avgCost", e.target.value)}
                    placeholder="לא הוזן" onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
                ) : p.avgCost != null && p.avgCost > 0
                  ? formatMoney(p.avgCost, privacyMode, { digits: 2 })
                  : <span style={{ color: "var(--text-faint)" }}>—</span>}
              </CardStat>
              <CardStat label="תשואה">
                <PositionReturnValue position={p} privacyMode={privacyMode} />
              </CardStat>
            </>
          )}
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

        <div style={{ marginTop: 10, textAlign: "center" }}>
          <Badge tone={p.tone} size="md" style={{ display: "block" }}>{p.action}</Badge>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: 10 }}>
          {isEditing ? (
            <>
              <Button variant="icon" onClick={() => savePosQty(p)} aria-label="שמור" title="שמור"><Check size={15} /></Button>
              <Button variant="icon" onClick={cancelPosEdit} aria-label="ביטול" title="ביטול"><X size={15} /></Button>
            </>
          ) : (
            <Button variant="icon" onClick={() => startEditPosQty(p)} aria-label="ערוך כמות, מחיר ממוצע ויעדים" title="ערוך כמות, מחיר ממוצע ויעדי הקצאה"><Pencil size={15} /></Button>
          )}
          {p.symbol === "CASH" ? (
            <span style={{ color: "var(--text-faint)", display: "inline-flex", alignItems: "center", padding: "0 4px" }} title="שורת המזומן מסונכרנת עם יומן המסחר ולא ניתנת להסרה"><Lock size={13} /></span>
          ) : deletePosConfirmId === p.id ? (
            <>
              <Button variant="danger" onClick={() => deletePosition(p.id)} style={{ padding: "6px 10px", fontSize: 12.5, gap: "var(--space-1)" }}><Check size={13} /> אישור</Button>
              <Button variant="icon" onClick={() => setDeletePosConfirmId(null)} aria-label="ביטול" title="ביטול"><X size={15} /></Button>
            </>
          ) : (
            <Button variant="icon" danger onClick={() => setDeletePosConfirmId(p.id)} aria-label="הסר נכס" title="הסר נכס"><Trash2 size={15} /></Button>
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
            // Deliberately worded without any "will retry"/"right now" framing:
            // pricesConfigured === false means the server told us it has no
            // FINNHUB_API_KEY at all (prices.ts's getQuotes returns this
            // directly, it never throws for a missing key) - a permanent
            // configuration state, not a transient failure, so promising a
            // retry here would be a false promise that can never come true.
            // priceError (rendered separately below) covers the genuinely
            // transient case - network/timeout/rate-limit - and keeps its
            // own "ננסה שוב אוטומטית" wording, which is accurate there.
            ? "עדכון מחירים חי אינו מוגדר במערכת זו"
            : lastPriceUpdate
              ? <>
                {"מחירים עודכנו לאחרונה: " + lastPriceUpdate.toLocaleTimeString("he-IL")}
                {(priceSummary.stale > 0 || priceSummary.missing > 0) && (
                  <span data-price-summary="problem" style={{ color: "var(--warning)", fontWeight: 600 }} title="לסימולים אלה לא התקבל מחיר עדכני - הסטטוס מופיע מתחת למחיר בטבלה">
                    {" · " + [priceSummary.stale > 0 ? priceSummary.stale + " ישנים" : "", priceSummary.missing > 0 ? priceSummary.missing + " חסרים" : ""].filter(Boolean).join(", ")}
                  </span>
                )}
                {priceSummary.extended > 0 && (
                  <span data-price-summary="extended" style={{ color: "var(--info)", fontWeight: 600 }} title="מחיר מסחר מורחב פחות אמין ממחיר סשן רגיל">
                    {" · " + priceSummary.extended + " במסחר מורחב"}
                  </span>
                )}
              </>
              : priceSummary.stale + priceSummary.missing > 0
                ? <span style={{ color: "var(--warning)", fontWeight: 600 }}>לא התקבלו מחירים עדכניים</span>
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
          <Button variant="ghost" onClick={refreshPrices} disabled={pricesLoading}>
            <RefreshCw size={14} className={pricesLoading ? "spin-icon" : undefined} /> רענון מחירים
          </Button>
          <Button variant="ghost" onClick={onBackupNow} disabled={backupRunning}
            title="שומר עותק גיבוי מיידי של נתוני התיק, בנוסף לגיבוי האוטומטי">
            {backupRunning ? (
              <><RefreshCw size={14} className="spin-icon" /> יוצר גיבוי...</>
            ) : backupDoneAt !== null ? (
              <>✓ גיבוי נוצר</>
            ) : (
              <><Archive size={14} /> צור גיבוי עכשיו</>
            )}
          </Button>
        </div>
      </div>
      {priceError && (
        <div style={{ marginBottom: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
          {priceError}
        </div>
      )}
      {posEditError && (
        <div role="alert" style={{ marginBottom: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
          {posEditError}
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
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "13px 16px",
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
      <div className="idash-scroll-table holdings-table" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "auto", marginBottom: "var(--space-5)" }}>
        <table>
          <colgroup>
            <col style={{ width: 100 }} /><col style={{ width: 104 }} /><col style={{ width: 104 }} /><col style={{ width: 88 }} />
            <col style={{ width: 78 }} /><col style={{ width: 92 }} /><col style={{ width: 58 }} /><col style={{ width: 145 }} />
            <col style={{ width: 181 }} /><col style={{ width: 52 }} /><col style={{ width: 50 }} /><col style={{ width: 50 }} />
            <col style={{ width: 55 }} /><col style={{ width: 66 }} /><col style={{ width: 92 }} />
          </colgroup>
          <thead style={{ background: "var(--panel)" }}>
            <tr>
              <th>נכס</th><th className="num">כמות</th>
              <th className="num" title="מחיר קנייה ממוצע ליחידה - מוזן ידנית דרך העיפרון">מחיר ממוצע</th>
              <th className="num">מחיר</th><th className="num">שווי</th>
              <th className="num" title="תשואה לא ממומשת לפי המחיר הממוצע שהוזן">תשואה</th>
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
                  className={p.symbol !== "CASH" ? "detail-trigger" : undefined}
                  role={p.symbol !== "CASH" ? "button" : undefined}
                  tabIndex={p.symbol !== "CASH" ? 0 : undefined}
                  onKeyDown={p.symbol !== "CASH" ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p.symbol); } } : undefined}
                  style={{ fontWeight: 700, textAlign: "right", cursor: p.symbol !== "CASH" ? "pointer" : "default" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: colorFor(p.symbol, i), display: "inline-block", flexShrink: 0 }} />
                    {tradingViewUrl(p.symbol) ? (
                      <a href={tradingViewUrl(p.symbol) || undefined} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="symbol-link"
                        title={"פתח גרף TradingView עבור " + p.symbol}>
                        {p.symbol}
                      </a>
                    ) : p.symbol}
                  </span>
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }}>
                  {editingPosId === p.id ? (
                    <input type="text" inputMode="decimal" autoFocus value={posEditFields.qty} onChange={(e) => updatePosEditField("qty", e.target.value)}
                      style={{ width: 88 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
                  ) : (
                    p.qty !== null && p.qty !== undefined ? fmtNum(p.qty, p.qty % 1 !== 0 ? 2 : 0) : (p.symbol === "CASH" ? "—" : "-")
                  )}
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }}>
                  {p.symbol === "CASH" ? "—" : editingPosId === p.id ? (
                    <input type="text" inputMode="decimal" value={posEditFields.avgCost} onChange={(e) => updatePosEditField("avgCost", e.target.value)}
                      placeholder="לא הוזן" style={{ width: 80 }} onKeyDown={(e) => { if (e.key === "Enter") savePosQty(p); if (e.key === "Escape") cancelPosEdit(); }} />
                  ) : p.avgCost != null && p.avgCost > 0
                    ? formatMoney(p.avgCost, privacyMode, { digits: 2 })
                    : <span style={{ color: "var(--text-faint)" }} title="הזן מחיר ממוצע (בעיפרון) כדי לראות תשואה">—</span>}
                </td>
                <td className="num" style={{ color: "var(--text-dim)" }}>
                  {p.price !== null && p.price !== undefined
                    ? <span style={extendedPriceStyle(p.symbol)}>{formatMoney(p.price, privacyMode, { digits: 2 })}</span>
                    : p.symbol === "CASH" ? "—" : <span title="לא הצלחנו לעדכן מחיר עבור נכס זה" style={{ color: "var(--text-faint)" }}>לא זמין</span>}
                  {p.symbol !== "CASH" && <PriceStatusMark info={priceInfo[p.symbol]} />}
                </td>
                <td className="num" style={{ fontWeight: p.symbol === "CASH" ? 700 : 600, color: p.symbol === "CASH" ? "var(--text)" : undefined }}>{formatMoney(p.value, privacyMode)}</td>
                <td className="num"><PositionReturnValue position={p} privacyMode={privacyMode} /></td>
                <td className="num">{fmtPct(p.weight)}</td>
                <td className="center"><Badge tone={p.tone} size="md">{p.status}</Badge></td>
                <td className="center">
                  <Badge tone={p.tone} size="md" title={p.action} style={{
                    display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{p.action}</Badge>
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
                        <Button variant="icon" onClick={() => savePosQty(p)} aria-label="שמור" title="שמור"><Check size={13} /></Button>
                        <Button variant="icon" onClick={cancelPosEdit} aria-label="ביטול" title="ביטול"><X size={13} /></Button>
                      </>
                    ) : (
                      <Button variant="icon" onClick={() => startEditPosQty(p)} aria-label="ערוך כמות, מחיר ממוצע ויעדים" title="ערוך כמות, מחיר ממוצע ויעדי הקצאה"><Pencil size={13} /></Button>
                    )}
                    {p.symbol === "CASH" ? (
                      <span style={{ color: "var(--text-faint)", display: "inline-flex", alignItems: "center", padding: "0 4px" }} title="שורת המזומן מסונכרנת עם יומן המסחר ולא ניתנת להסרה"><Lock size={13} /></span>
                    ) : deletePosConfirmId === p.id ? (
                      <>
                        <Button variant="danger" onClick={() => deletePosition(p.id)} style={{ padding: "4px 8px", fontSize: 11.5, gap: "var(--space-1)" }}><Check size={12} /> אישור</Button>
                        <Button variant="icon" onClick={() => setDeletePosConfirmId(null)} aria-label="ביטול" title="ביטול"><X size={13} /></Button>
                      </>
                    ) : (
                      <Button variant="icon" danger onClick={() => setDeletePosConfirmId(p.id)} aria-label="הסר נכס" title="הסר נכס"><Trash2 size={13} /></Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {evaluated.length === 0 && (
              <tr><td colSpan={15} style={{ padding: 0, border: "none" }}>
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
              <td colSpan={4} style={{ fontWeight: 700, fontSize: 16, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 12px" }}>סך הכל התיק</td>
              <td className="num" style={{ fontWeight: 700, fontSize: 17, color: "var(--gain)", borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 12px" }}>{formatMoney(total, privacyMode)}</td>
              <td
                className="num"
                title={totalReturn ? "תשואה מצטברת על " + totalReturn.covered + " מתוך " + totalReturn.eligible + " פוזיציות שהוזן להן מחיר ממוצע (סך רווח/הפסד ÷ סך עלות)" : undefined}
                style={{ borderBottom: "none", borderTop: "1px solid var(--border)", padding: "10px 8px", verticalAlign: "middle" }}
              >
                {totalReturn && (
                  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "inherit", lineHeight: 1.25, color: totalReturn.pct > 0 ? "var(--gain)" : totalReturn.pct < 0 ? "var(--loss)" : "var(--text-faint)" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{totalReturn.pct > 0 ? "+" : ""}{fmtPct(totalReturn.pct)}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
                      {totalReturn.covered < totalReturn.eligible
                        ? totalReturn.covered + "/" + totalReturn.eligible + " פוזיציות"
                        : privacyMode ? PRIVACY_MASK : (totalReturn.pnl > 0 ? "+" : "") + formatMoney(totalReturn.pnl, false)}
                    </span>
                  </span>
                )}
              </td>
              <td className="num" style={{ fontWeight: 700, fontSize: 13.5, borderBottom: "none", borderTop: "1px solid var(--border)", padding: "14px 4px" }}>100.0%</td>
              <td colSpan={8} style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }} />
            </tr>
          </tfoot>
        </table>
      </div>
      </>
      )}

      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: "var(--space-5)" }}>
        לחיצה על העיפרון {isMobile ? "" : "בכל שורה "}מאפשרת לערוך כמות, מחיר ממוצע (לחישוב תשואה) ויעדי הקצאה (מינימום/מקסימום/רף דילול) לכל נכס.
      </div>

      <div style={{ marginBottom: "var(--space-5)" }}>
        {showAddPosition ? (
          <div ref={addPositionRef} style={{ background: "var(--panel)", border: "1px solid var(--accent-subtle-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Plus size={15} color="var(--accent)" /> הוספת נכס חדש לתיק
              </div>
              <Button variant="icon" onClick={() => { setShowAddPosition(false); setPosForm(EMPTY_POSITION_FORM); setPosFormError(""); }}><X size={15} /></Button>
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
              <Field label="מחיר ממוצע $ (אופציונלי)">
                <input type="text" inputMode="decimal" value={posForm.avgCost} onChange={(e) => updatePosForm("avgCost", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder="לדוגמה: 150.25" />
              </Field>
              <Field label="מחיר יעד $ (אופציונלי)">
                <input type="text" inputMode="decimal" value={posForm.priceTarget} onChange={(e) => updatePosForm("priceTarget", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder="לדוגמה: 250" />
              </Field>
              <Field label="יעד מינימום %">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posForm.min} onChange={(e) => updatePosForm("min", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder={fmtNum(suggestedNewPositionRange.min * 100, 1)} />%
                </span>
              </Field>
              <Field label="יעד מקסימום %">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posForm.max} onChange={(e) => updatePosForm("max", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder={fmtNum(suggestedNewPositionRange.max * 100, 1)} />%
                </span>
              </Field>
              <Field label="רף דילול %">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" value={posForm.dilute} onChange={(e) => updatePosForm("dilute", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNewPosition(); }} placeholder={fmtNum(suggestedNewPositionRange.dilute * 100, 1)} />%
                </span>
              </Field>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <Button variant="primary" onClick={submitNewPosition} style={{ width: "100%" }}><Check size={15} /> הוסף לתיק</Button>
              </div>
            </div>
            {posFormError && (
              <div style={{ marginTop: 10, padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 }}>
                {posFormError}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-faint)" }}>
              שווי יחושב אוטומטית (כמות × מחיר) והמשקלים בתיק יתעדכנו בהתאם. שדות יעדי ההקצאה הם אופציונליים - שדה שנשאר ריק יקבל את הערך המוצג כברירת מחדל (מוצע לפי חלוקה שווה בין הפוזיציות הקיימות, ברוחב לפי סגנון ההשקעה שנבחר בהגדרות), שניתן לעדכן בהמשך. מחיר היעד עוזר לך לקבל התראה כשהמניה חוצה מחיר מסוים - לא קשור לאחוזי ההקצאה. מחיר ממוצע (אופציונלי) הוא מחיר הקנייה הממוצע שלך ליחידה - לפיו מחושבת התשואה על הפוזיציה בטבלה.
            </div>
          </div>
        ) : (
          <Button variant="primary" onClick={openAddPositionForm}>
            <Plus size={16} /> הוסף נכס לתיק
          </Button>
        )}
      </div>

      <div className="idash-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: 30, alignItems: "stretch" }}>
        <AllocationCard evaluated={evaluated} privacyMode={privacyMode} openDetail={openDetail} />
        <div className="morning-brief-card">
          <MorningBriefCard result={morningBrief} bigMovers={bigMovers} loading={morningBriefLoading} error={morningBriefError} onOpenDrawer={onOpenMorningBrief} />
        </div>
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
          <div style={{ background: "var(--gain-subtle)", border: "1px solid var(--gain-subtle-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", display: "flex", alignItems: "center", gap: 10, color: "var(--gain)", fontSize: 13.5 }}>
            <ShieldCheck size={18} /> כל הנכסים במשקל היעד – אין פעולות נדרשות כרגע.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
            {needsAction.map((p) => (
              <div key={p.symbol} style={{ background: "var(--panel)", border: "1px solid " + TONE_STYLES[p.tone].border, borderRadius: "var(--radius-lg)", padding: 14 }}>
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
