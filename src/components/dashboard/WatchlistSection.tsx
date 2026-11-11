import { useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Eye, Plus, Check, X, Pencil, Trash2, Inbox } from "lucide-react";
import type { WatchlistAssetType, WatchlistItem } from "@/lib/portfolioTypes";
import {
  MAX_INTEREST, MIN_INTEREST, WATCHLIST_ASSET_LABEL, WATCHLIST_SORT_LABEL,
  makeWatchlistItem, sortWatchlist, watchlistMetrics, type WatchlistMetrics, type WatchlistSort,
} from "@/lib/watchlist";
import type { HighReading } from "@/lib/watchlistData";
import type { PriceInfo } from "@/lib/priceStatus";
import { MAX_NOTES_LEN, MAX_WATCHLIST_ITEMS, newErrors, validateWatchlistItem } from "@/lib/validation";
import { fmtPct, fmtUSD, parseNum, tradingViewUrl } from "@/components/dashboard/format";
import { Badge } from "@/components/dashboard/ui/Badge";
import { Button } from "@/components/dashboard/ui/Button";
import { PageBanner, Field } from "@/components/dashboard/ui/Layout";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";
import { PriceStatusMark } from "@/components/dashboard/PriceStatusMark";
import { useIsMobile } from "@/components/dashboard/useIsMobile";

// The watchlist (task 10.3): symbols the owner is watching but does not hold. Entirely apart from the
// holdings - nothing here feeds the portfolio's value, weights, cash or health score, and it says so.

interface WatchlistSectionProps {
  watchlist: WatchlistItem[];
  setWatchlist: Dispatch<SetStateAction<WatchlistItem[]>>;
  /** Symbols held in the portfolio, to mark a watched symbol that is also owned. */
  heldSymbols: string[];
  /** Last known live price per symbol (never replaced by "nothing" when a refresh fails). */
  prices: Record<string, number>;
  priceInfo: Record<string, PriceInfo>;
  highs: Record<string, HighReading>;
  pushUndoSnapshot: (label: string) => void;
  pricesConfigured: boolean | null;
}

interface WatchForm {
  symbol: string;
  name: string;
  assetType: WatchlistAssetType;
  entryPrice: string;
  targetWeight: string;
  interest: string;
  thesis: string;
  notes: string;
}

const EMPTY_FORM: WatchForm = { symbol: "", name: "", assetType: "STOCK", entryPrice: "", targetWeight: "", interest: "3", thesis: "", notes: "" };
const SYMBOL_RE = /^[A-Za-z0-9:_.-]{1,20}$/;
const INTEREST_LABEL: Record<number, string> = { 1: "1 - נמוך", 2: "2 - בינוני-נמוך", 3: "3 - בינוני", 4: "4 - גבוה", 5: "5 - גבוה מאוד" };
const INTEREST_VALUES = [1, 2, 3, 4, 5].filter((n) => n >= MIN_INTEREST && n <= MAX_INTEREST);

const ERROR_BOX = { marginTop: 10, padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5 } as const;

function CardStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>{children}</span>
    </div>
  );
}

function interestDots(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return "●".repeat(k) + "○".repeat(5 - k);
}

export function WatchlistSection({ watchlist, setWatchlist, heldSymbols, prices, priceInfo, highs, pushUndoSnapshot, pricesConfigured }: WatchlistSectionProps) {
  const isMobile = useIsMobile();
  const [sort, setSort] = useState<WatchlistSort>("added");
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WatchForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string>("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const held = useMemo(() => new Set(heldSymbols.map((s) => s.toUpperCase())), [heldSymbols]);

  const rows = useMemo(() => {
    const metrics: Record<string, WatchlistMetrics> = {};
    for (const w of watchlist) metrics[w.symbol] = watchlistMetrics(w, prices[w.symbol] ?? null, highs[w.symbol]?.high52 ?? null);
    return sortWatchlist(watchlist, metrics, sort).map((item) => ({ item, m: metrics[item.symbol] }));
  }, [watchlist, prices, highs, sort]);

  function scrollToForm() {
    requestAnimationFrame(() => formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  }
  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
    scrollToForm();
  }
  function openEdit(w: WatchlistItem) {
    setEditingId(w.id);
    setForm({
      symbol: w.symbol, name: w.name, assetType: w.assetType,
      entryPrice: w.entryPrice !== null ? String(w.entryPrice) : "",
      targetWeight: w.targetWeight !== null ? String(Math.round(w.targetWeight * 1000) / 10) : "",
      interest: String(w.interest), thesis: w.thesis, notes: w.notes,
    });
    setFormError("");
    setDeleteConfirmId(null);
    setShowForm(true);
    scrollToForm();
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }
  function update<K extends keyof WatchForm>(field: K, value: WatchForm[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setFormError("");
  }

  function submit() {
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) { setFormError("נא להזין סימול."); return; }
    if (!SYMBOL_RE.test(symbol)) { setFormError("הסימול יכול להכיל רק אותיות לטיניות, ספרות והתווים . - _ : (עד 20 תווים)."); return; }
    const existing = editingId ? watchlist.find((w) => w.id === editingId) : undefined;
    if (editingId && !existing) { closeForm(); return; }
    if (!existing && watchlist.length >= MAX_WATCHLIST_ITEMS) { setFormError("הגעת למספר המקסימלי של פריטים ברשימת המעקב (" + MAX_WATCHLIST_ITEMS + ")."); return; }
    if (watchlist.some((w) => w.symbol === symbol && w.id !== editingId)) { setFormError("הסימול " + symbol + " כבר נמצא ברשימת המעקב."); return; }

    // Blank = not set; anything typed must be a real number - a bad value is an error, never silently dropped.
    let entryPrice: number | null = null;
    if (form.entryPrice.trim() !== "") {
      entryPrice = parseNum(form.entryPrice);
      if (Number.isNaN(entryPrice) || entryPrice <= 0) { setFormError("מחיר כניסה רצוי חייב להיות מספר גדול מ-0 (או להישאר ריק)."); return; }
    }
    let targetWeight: number | null = null;
    if (form.targetWeight.trim() !== "") {
      const pct = parseNum(form.targetWeight);
      if (Number.isNaN(pct) || pct <= 0 || pct > 100) { setFormError("משקל יעד חייב להיות בין 0% ל-100% (או להישאר ריק)."); return; }
      targetWeight = pct / 100;
    }
    const interest = Number(form.interest);
    if (!Number.isInteger(interest) || interest < MIN_INTEREST || interest > MAX_INTEREST) { setFormError("רמת העניין חייבת להיות מספר שלם מ-" + MIN_INTEREST + " עד " + MAX_INTEREST + "."); return; }

    const candidate = makeWatchlistItem({
      symbol, name: form.name, assetType: form.assetType, entryPrice, targetWeight, interest, thesis: form.thesis, notes: form.notes,
    }, new Date().toISOString(), existing);
    // Only problems this edit would ADD count - an item that already had one stays editable.
    const introduced = newErrors(validateWatchlistItem(candidate), existing ? validateWatchlistItem(existing) : []);
    if (introduced.length > 0) { setFormError(introduced[0].message); return; }

    pushUndoSnapshot(existing ? "עריכת פריט ברשימת המעקב" : "הוספת פריט לרשימת המעקב");
    setWatchlist((ws) => (existing ? ws.map((w) => (w.id === existing.id ? candidate : w)) : [...ws, candidate]));
    closeForm();
  }

  function remove(id: string) {
    pushUndoSnapshot("הסרת פריט מרשימת המעקב");
    setWatchlist((ws) => ws.filter((w) => w.id !== id));
    setDeleteConfirmId(null);
    if (editingId === id) closeForm();
  }

  // ---- cells (shared by the table and the mobile cards) ------------------------------------------------

  function priceCell(symbol: string) {
    const info = priceInfo[symbol];
    const price = prices[symbol];
    return (
      <>
        {typeof price === "number" && price > 0
          ? <span data-watch-price={symbol}>{fmtUSD(price, { digits: 2 })}</span>
          : info?.status === "pending"
            ? <span style={{ color: "var(--text-faint)" }}>טוען…</span>
            : <span data-watch-price={symbol} title="לא התקבל מחיר לסימול זה" style={{ color: "var(--text-faint)" }}>לא זמין</span>}
        <PriceStatusMark info={info} />
      </>
    );
  }

  function highCell(symbol: string, m: WatchlistMetrics) {
    const h = highs[symbol];
    if (!h) return <span title="טוען שיא ל-52 שבועות" style={{ color: "var(--text-faint)" }}>…</span>;
    if (h.high52 === null || m.high === null) return <span data-watch-high={symbol} title="לא התקבל שיא ל-52 שבועות לסימול זה" style={{ color: "var(--text-faint)" }}>—</span>;
    const title = "הסגירה היומית הגבוהה ביותר ב-365 הימים האחרונים" + (h.asOf ? " · נכון ל-" + h.asOf : "");
    return (
      <span data-watch-high={symbol} title={title}>
        {fmtUSD(m.high, { digits: 2 })}
        {h.status === "stale" && <span style={{ color: "var(--warning)", fontWeight: 700, fontSize: 10.5, marginInlineStart: 5 }}>ישן</span>}
      </span>
    );
  }

  function dropCell(symbol: string, m: WatchlistMetrics) {
    if (m.dropFromHigh === null) return <span data-watch-drop={symbol} style={{ color: "var(--text-faint)" }}>—</span>;
    return <span data-watch-drop={symbol}>{m.dropFromHigh === 0 ? "0.0%" : "-" + fmtPct(m.dropFromHigh)}</span>;
  }

  function distanceCell(symbol: string, m: WatchlistMetrics) {
    const d = m.distanceToEntry;
    if (d === null) return <span data-watch-distance={symbol} style={{ color: "var(--text-faint)" }}>—</span>;
    const caption = d < 0 ? "מתחת למחיר הכניסה" : d > 0 ? "מעל מחיר הכניסה" : "במחיר הכניסה";
    return (
      <span data-watch-distance={symbol}>
        <span style={{ color: d <= 0 ? "var(--gain)" : "var(--text-dim)" }}>{(d > 0 ? "+" : "") + fmtPct(d)}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--sans)" }}>{caption}</span>
      </span>
    );
  }

  function symbolLabel(w: WatchlistItem) {
    const url = tradingViewUrl(w.symbol);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontWeight: 700 }}>
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer" className="symbol-link">{w.symbol}</a>
          : w.symbol}
        <Badge tone="blue">{WATCHLIST_ASSET_LABEL[w.assetType]}</Badge>
        {held.has(w.symbol) && <Badge tone="green" title="הסימול הזה גם מוחזק בתיק - הרשימה עצמה לא משפיעה על ההחזקות">בתיק</Badge>}
      </span>
    );
  }

  function actions(w: WatchlistItem) {
    return deleteConfirmId === w.id ? (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <Button variant="danger" onClick={() => remove(w.id)} aria-label={"אשר הסרת " + w.symbol} style={{ padding: "6px 10px", fontSize: 12.5, gap: "var(--space-1)" }}><Check size={13} /> אישור</Button>
        <Button variant="icon" onClick={() => setDeleteConfirmId(null)} aria-label="ביטול" title="ביטול"><X size={15} /></Button>
      </span>
    ) : (
      <span style={{ display: "inline-flex", gap: 6 }}>
        <Button variant="icon" onClick={() => openEdit(w)} aria-label={"ערוך " + w.symbol} title="ערוך"><Pencil size={15} /></Button>
        <Button variant="icon" danger onClick={() => setDeleteConfirmId(w.id)} aria-label={"הסר " + w.symbol + " מהרשימה"} title="הסר מהרשימה"><Trash2 size={15} /></Button>
      </span>
    );
  }

  function renderCard(w: WatchlistItem, m: WatchlistMetrics) {
    return (
      <div key={w.id} data-watch-row={w.symbol} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-2)", marginBottom: 6 }}>
          <div style={{ fontSize: 16.5 }}>{symbolLabel(w)}</div>
          <span aria-label={"עניין " + w.interest + " מתוך 5"} title={"רמת עניין: " + INTEREST_LABEL[w.interest]} style={{ color: "var(--accent)", letterSpacing: 1 }}>{interestDots(w.interest)}</span>
        </div>
        {w.name && <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 8 }}>{w.name}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontSize: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <CardStat label="מחיר">{priceCell(w.symbol)}</CardStat>
          <CardStat label="שיא 52 שבועות">{highCell(w.symbol, m)}</CardStat>
          <CardStat label="ירידה מהשיא">{dropCell(w.symbol, m)}</CardStat>
          <CardStat label="מחיר כניסה רצוי">{w.entryPrice !== null ? fmtUSD(w.entryPrice, { digits: 2 }) : "—"}</CardStat>
          <CardStat label="מרחק ממחיר הכניסה">{distanceCell(w.symbol, m)}</CardStat>
          <CardStat label="משקל יעד">{w.targetWeight !== null ? fmtPct(w.targetWeight) : "—"}</CardStat>
        </div>
        {w.thesis && <div style={{ marginTop: 10, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap" }}><span style={{ color: "var(--text-faint)" }}>תזה: </span>{w.thesis}</div>}
        {w.notes && <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-dim)", whiteSpace: "pre-wrap" }}><span style={{ color: "var(--text-faint)" }}>הערות: </span>{w.notes}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>{actions(w)}</div>
      </div>
    );
  }

  return (
    <div data-section="watchlist" style={{ marginBottom: 34 }}>
      <PageBanner icon={<Eye size={20} />} title="רשימת מעקב" subtitle="מניות ו-ETF שאתה עוקב אחריהם - לא חלק מהתיק, מהמשקלים או מציון הבריאות" />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: "var(--space-3)" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          {pricesConfigured === false ? "עדכון מחירים חי אינו מוגדר במערכת זו - לא יוצגו מחירים לרשימה" : "המחירים מתעדכנים יחד עם מחירי התיק"}
        </div>
        {watchlist.length > 1 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-dim)" }}>
            מיון:
            <select aria-label="מיון רשימת המעקב" value={sort} onChange={(e) => setSort(e.target.value as WatchlistSort)} style={{ width: "auto", minWidth: 190 }}>
              {(Object.keys(WATCHLIST_SORT_LABEL) as WatchlistSort[]).map((k) => <option key={k} value={k}>{WATCHLIST_SORT_LABEL[k]}</option>)}
            </select>
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <EmptyState
            compact
            icon={<Inbox size={18} />}
            title="רשימת המעקב ריקה"
            subtitle="הוסף מניה או ETF שמעניינים אותך, עם מחיר כניסה רצוי, כדי לראות כמה היא רחוקה ממנו ומהשיא שלה"
            actionLabel={showForm ? undefined : "+ הוסף נכס למעקב"}
            onAction={openAdd}
          />
        </div>
      ) : isMobile ? (
        <div style={{ marginBottom: "var(--space-4)" }}>{rows.map(({ item, m }) => renderCard(item, m))}</div>
      ) : (
        <div className="idash-scroll-table" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "auto", marginBottom: "var(--space-4)" }}>
          <table>
            <thead style={{ background: "var(--panel)" }}>
              <tr>
                <th>נכס</th><th className="num">מחיר</th>
                <th className="num" title="הסגירה היומית הגבוהה ביותר ב-365 הימים האחרונים">שיא 52 שבועות</th>
                <th className="num" title="כמה המחיר נמוך משיא 52 השבועות">ירידה מהשיא</th>
                <th className="num">מחיר כניסה רצוי</th>
                <th className="num" title="(מחיר נוכחי - מחיר כניסה רצוי) / מחיר כניסה רצוי. שלילי = המחיר כבר מתחת למחיר הכניסה">מרחק מהכניסה</th>
                <th className="num">משקל יעד</th><th className="center">עניין</th><th className="center">ניהול</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item: w, m }) => (
                <tr key={w.id} data-watch-row={w.symbol}>
                  <td style={{ whiteSpace: "normal", minWidth: 170 }}>
                    <div style={{ fontSize: 14.5 }}>{symbolLabel(w)}</div>
                    {w.name && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{w.name}</div>}
                    {(w.thesis || w.notes) && (
                      <div title={[w.thesis && "תזה: " + w.thesis, w.notes && "הערות: " + w.notes].filter(Boolean).join("\n")}
                        style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {w.thesis || w.notes}
                      </div>
                    )}
                  </td>
                  <td className="num">{priceCell(w.symbol)}</td>
                  <td className="num">{highCell(w.symbol, m)}</td>
                  <td className="num">{dropCell(w.symbol, m)}</td>
                  <td className="num">{w.entryPrice !== null ? fmtUSD(w.entryPrice, { digits: 2 }) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                  <td className="num">{distanceCell(w.symbol, m)}</td>
                  <td className="num">{w.targetWeight !== null ? fmtPct(w.targetWeight) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                  <td className="center"><span aria-label={"עניין " + w.interest + " מתוך 5"} title={"רמת עניין: " + INTEREST_LABEL[w.interest]} style={{ color: "var(--accent)", letterSpacing: 1 }}>{interestDots(w.interest)}</span></td>
                  <td className="center">{actions(w)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: "var(--space-4)" }}>
        {showForm ? (
          <div ref={formRef} data-watch-form style={{ background: "var(--panel)", border: "1px solid var(--accent-subtle-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Plus size={15} color="var(--accent)" /> {editingId ? "עריכת פריט ברשימת המעקב" : "הוספת נכס לרשימת המעקב"}
              </div>
              <Button variant="icon" onClick={closeForm} aria-label="סגור" title="סגור"><X size={15} /></Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: "var(--space-3)" }}>
              <Field label="סימול">
                <input type="text" aria-label="סימול" value={form.symbol} onChange={(e) => update("symbol", e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="לדוגמה: AMD" maxLength={20} />
              </Field>
              <Field label="שם (אופציונלי)">
                <input type="text" aria-label="שם" value={form.name} onChange={(e) => update("name", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="לדוגמה: Advanced Micro Devices" maxLength={200} />
              </Field>
              <Field label="סוג">
                <select aria-label="סוג" value={form.assetType} onChange={(e) => update("assetType", e.target.value as WatchlistAssetType)}>
                  {(Object.keys(WATCHLIST_ASSET_LABEL) as WatchlistAssetType[]).map((k) => <option key={k} value={k}>{WATCHLIST_ASSET_LABEL[k]}</option>)}
                </select>
              </Field>
              <Field label="רמת עניין">
                <select aria-label="רמת עניין" value={form.interest} onChange={(e) => update("interest", e.target.value)}>
                  {INTEREST_VALUES.map((n) => <option key={n} value={String(n)}>{INTEREST_LABEL[n]}</option>)}
                </select>
              </Field>
              <Field label="מחיר כניסה רצוי $ (אופציונלי)">
                <input type="text" inputMode="decimal" aria-label="מחיר כניסה רצוי" value={form.entryPrice} onChange={(e) => update("entryPrice", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="לדוגמה: 120" />
              </Field>
              <Field label="משקל יעד בתיק % (אופציונלי)">
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="text" inputMode="decimal" aria-label="משקל יעד" value={form.targetWeight} onChange={(e) => update("targetWeight", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="לדוגמה: 5" />%
                </span>
              </Field>
              <div style={{ gridColumn: isMobile ? undefined : "span 2" }}>
                <Field label="תזה - למה אני עוקב אחריה (אופציונלי)">
                  <textarea aria-label="תזה" value={form.thesis} onChange={(e) => update("thesis", e.target.value)} maxLength={MAX_NOTES_LEN} />
                </Field>
              </div>
              <div style={{ gridColumn: isMobile ? undefined : "span 2" }}>
                <Field label="הערות (אופציונלי)">
                  <textarea aria-label="הערות" value={form.notes} onChange={(e) => update("notes", e.target.value)} maxLength={MAX_NOTES_LEN} />
                </Field>
              </div>
            </div>
            {formError && <div role="alert" data-watch-error style={ERROR_BOX}>{formError}</div>}
            <div className="idash-form-actions" style={{ display: "flex", gap: "var(--space-2)", marginTop: 12 }}>
              <Button variant="primary" onClick={submit}><Check size={15} /> {editingId ? "שמור שינויים" : "הוסף לרשימה"}</Button>
              <Button variant="ghost" onClick={closeForm}>ביטול</Button>
            </div>
          </div>
        ) : (
          rows.length > 0 && <Button variant="primary" onClick={openAdd}><Plus size={16} /> הוסף נכס למעקב</Button>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.7 }}>
        שיא 52 שבועות = הסגירה היומית הגבוהה ביותר ב-365 הימים האחרונים (מתעדכן כל כמה שעות). מרחק מהכניסה = (מחיר נוכחי − מחיר כניסה רצוי) ÷ מחיר כניסה רצוי; מספר שלילי אומר שהמחיר כבר מתחת למחיר שרצית להיכנס בו. רשימת המעקב אינה משפיעה על שווי התיק, המשקלים, המזומן, ההתראות או ציון הבריאות.
      </div>
    </div>
  );
}
