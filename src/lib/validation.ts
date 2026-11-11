// Central validation for portfolio data (audit finding H7). ONE module used by
// both the browser (forms, import preview, the data-problems banner) and the
// server (savePortfolio), so a rule is written once and the user sees the same
// Hebrew explanation wherever it is enforced. Pure: only type imports, no Node
// APIs, so it is safe in the browser bundle.
//
// Two layers:
//   1. STRUCTURE (isValidPortfolioData): is this payload shaped like a portfolio
//      and within size bounds? A failure means "not a portfolio at all".
//   2. MEANING (validatePortfolio and friends): does the data make sense? Each
//      problem is an issue with a severity:
//        "error"   - invalid (negative quantity, min above max, 31 February,
//                    duplicate id...). New errors are refused on save.
//        "warning" - suspicious but allowed, shown to the user (cash below zero,
//                    a future-dated trade, value that doesn't match qty x price).
//      A MISSING value (no price yet, no quantity on a CASH row) is neither: it
//      is allowed and is reported by the price-status UI, not as an error.
//
// Existing portfolios are never blocked from loading by any of this, and the
// server only refuses errors that are NEW compared with what is already stored
// (see newErrors), so a legacy portfolio that already contains a bad value can
// still be edited and saved.

import type { Ledger, LedgerAnchors, PortfolioData, Position, Trade } from "./portfolioTypes";

// ---- structure ----------------------------------------------------------------------

export const MAX_POSITIONS = 300;
export const MAX_TRADES = 20_000;
export const MAX_LEDGER_ENTRIES = 1_000;
export const MAX_SYMBOL_LEN = 20;
const MAX_SHORT_STRING_LEN = 500;
const MAX_NOTES_LEN = 5_000;
export const VALID_ACTIONS: ReadonlySet<string> = new Set(["קנייה", "מכירה", "הפקדה", "משיכה", "אחר"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isFiniteNumberOrNull(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}
function isNonEmptyShortString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}
function isShortStringOrNull(v: unknown, maxLen: number): v is string | null {
  return v === null || (typeof v === "string" && v.length <= maxLen);
}

function isValidPosition(p: unknown): p is Position {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    isFiniteNumber(o.id) &&
    isNonEmptyShortString(o.symbol, MAX_SYMBOL_LEN) &&
    isFiniteNumberOrNull(o.qty) &&
    isFiniteNumberOrNull(o.price) &&
    isFiniteNumber(o.value) &&
    isFiniteNumber(o.weight) &&
    isFiniteNumber(o.dev) &&
    isFiniteNumber(o.min) &&
    isFiniteNumber(o.max) &&
    isFiniteNumber(o.dilute) &&
    (o.hodl === undefined || typeof o.hodl === "boolean") &&
    (o.priceTarget === undefined || isFiniteNumberOrNull(o.priceTarget)) &&
    (o.avgCost === undefined || isFiniteNumberOrNull(o.avgCost))
  );
}

function isValidTrade(t: unknown): t is Trade {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    isFiniteNumber(o.id) &&
    typeof o.date === "string" && DATE_RE.test(o.date) &&
    isNonEmptyShortString(o.symbol, MAX_SYMBOL_LEN) &&
    typeof o.action === "string" && VALID_ACTIONS.has(o.action) &&
    isFiniteNumber(o.qty) &&
    isFiniteNumber(o.price) &&
    isFiniteNumber(o.value) &&
    isFiniteNumber(o.fee) &&
    isFiniteNumberOrNull(o.pnl) &&
    isFiniteNumberOrNull(o.retPct) &&
    isShortStringOrNull(o.strategy, MAX_SHORT_STRING_LEN) &&
    isShortStringOrNull(o.notes, MAX_NOTES_LEN)
  );
}

function isValidLedger(l: unknown): l is Ledger {
  if (!l || typeof l !== "object" || Array.isArray(l)) return false;
  const entries = Object.entries(l as Record<string, unknown>);
  if (entries.length > MAX_LEDGER_ENTRIES) return false;
  return entries.every(([symbol, entry]) => {
    if (symbol.length === 0 || symbol.length > MAX_SYMBOL_LEN) return false;
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return isFiniteNumber(e.qty) && isFiniteNumber(e.avgCost);
  });
}

function isValidAnchors(a: unknown): a is LedgerAnchors {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const entries = Object.entries(a as Record<string, unknown>);
  if (entries.length > MAX_LEDGER_ENTRIES) return false;
  return entries.every(([symbol, entry]) => {
    if (symbol.length === 0 || symbol.length > MAX_SYMBOL_LEN) return false;
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return isFiniteNumber(e.qty) && isFiniteNumber(e.avgCost) && typeof e.asOf === "string" && DATE_RE.test(e.asOf)
      && (e.lastTradeId === undefined || isFiniteNumber(e.lastTradeId));
  });
}

/** Runtime shape/bounds check for client-submitted portfolio data. TypeScript
 * types alone don't survive the network boundary, so this is the real guard
 * against malformed or oversized payloads reaching disk. */
export function isValidPortfolioData(data: unknown): data is PortfolioData {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (o.ledgerAnchors !== undefined && !isValidAnchors(o.ledgerAnchors)) return false;
  if (!Array.isArray(o.positions) || o.positions.length > MAX_POSITIONS) return false;
  if (!o.positions.every(isValidPosition)) return false;
  if (!Array.isArray(o.trades) || o.trades.length > MAX_TRADES) return false;
  if (!o.trades.every(isValidTrade)) return false;
  if (!isValidLedger(o.ledger)) return false;
  if (!isFiniteNumber(o.nextPositionId) || !isFiniteNumber(o.nextTradeId)) return false;
  return true;
}

// ---- meaning ------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable machine name of the rule, e.g. "min-gt-max". */
  code: string;
  /** Identity of THIS problem on THIS item ("position:12:min-gt-max"). The same
   * problem on the same item keeps the same key across saves, which is how an
   * already-stored problem is told apart from a newly introduced one. */
  key: string;
  /** Hebrew explanation, ready to show the user as is. */
  message: string;
  kind: "position" | "trade" | "portfolio";
  id: number | null;
  symbol: string | null;
}

const pct = (n: number): string => (Math.round(n * 1000) / 10).toString() + "%";
const money = (n: number): string => (Math.round(n * 100) / 100).toString();

/** True for a date that really exists in the calendar ("2026-02-31" is not one). */
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const MAX_DILUTE = 10; // 1000% - generous, only catches typos like 2000 instead of 20

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
}

/** The value a position should have: quantity x price when both are known,
 * otherwise whatever value is stored (CASH, manually valued rows, no price yet).
 * The server uses this - not the browser's own arithmetic - for the portfolio
 * total it records in the equity history. */
export function recomputedValue(p: Pick<Position, "symbol" | "qty" | "price" | "value">): number {
  if (p.symbol !== "CASH" && typeof p.qty === "number" && typeof p.price === "number" && p.price > 0) return p.qty * p.price;
  return p.value;
}

function issue(
  severity: IssueSeverity, code: string, message: string,
  kind: ValidationIssue["kind"], id: number | null, symbol: string | null,
): ValidationIssue {
  // An item without an id (a ledger anchor) is identified by its symbol, so a
  // problem on one symbol is never mistaken for the same problem on another.
  return { severity, code, key: kind + ":" + (id ?? symbol ?? "-") + ":" + code, message, kind, id, symbol };
}

/** Problems with the ledger anchors (see LedgerAnchor): a real asOf date, a
 * non-negative quantity, and a positive average cost whenever a quantity is held. */
function validateAnchors(anchors: LedgerAnchors | undefined): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [symbol, a] of Object.entries(anchors ?? {})) {
    const add = (code: string, msg: string) => out.push(issue("error", code, msg, "portfolio", null, symbol));
    if (!isRealDate(a.asOf)) add("anchor-date-invalid", "בנקודת הפתיחה של " + symbol + ": התאריך \"" + a.asOf + "\" אינו תאריך אמיתי בלוח השנה.");
    if (a.qty < 0) add("anchor-qty-negative", "בנקודת הפתיחה של " + symbol + ": הכמות (" + a.qty + ") שלילית.");
    else if (a.qty > 0 && !(a.avgCost > 0)) add("anchor-avgcost-invalid", "בנקודת הפתיחה של " + symbol + ": כשיש כמות, המחיר הממוצע (" + money(a.avgCost) + ") חייב להיות גדול מ-0.");
    if (a.lastTradeId !== undefined && (!Number.isInteger(a.lastTradeId) || a.lastTradeId < -1)) {
      add("anchor-last-trade-id", "בנקודת הפתיחה של " + symbol + ": מזהה העסקה האחרונה (" + a.lastTradeId + ") אינו תקין.");
    }
  }
  return out;
}

/** Problems with one position, from its own fields. */
export function validatePosition(p: Position): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const sym = p.symbol;
  const add = (sev: IssueSeverity, code: string, msg: string) => out.push(issue(sev, code, msg, "position", p.id, sym));
  const isCash = sym === "CASH";

  if (p.qty !== null && p.qty < 0) add("error", "qty-negative", "ב-" + sym + ": הכמות (" + p.qty + ") שלילית. כמות חייבת להיות 0 או יותר.");
  if (p.price !== null && p.price < 0) add("error", "price-negative", "ב-" + sym + ": המחיר (" + money(p.price) + ") שלילי. מחיר חייב להיות גדול מ-0.");
  if (p.price === 0 && !isCash) add("warning", "price-zero", "ב-" + sym + ": המחיר הוא 0, ולכן הוא נחשב כמחיר חסר.");
  if (p.value < 0) {
    if (isCash) add("warning", "cash-negative", "המזומן שלילי (" + money(p.value) + "). ייתכן שחסרה הפקדה ביומן.");
    else add("error", "value-negative", "ב-" + sym + ": השווי (" + money(p.value) + ") שלילי. שווי חייב להיות 0 או יותר.");
  }
  if (!isCash && p.qty !== null && p.price !== null && p.price > 0 && !nearlyEqual(p.value, p.qty * p.price)) {
    add("warning", "value-mismatch", "ב-" + sym + ": השווי (" + money(p.value) + ") שונה מכמות × מחיר (" + money(p.qty * p.price) + ").");
  }

  // Allocation range: 0 <= min <= max <= dilute. (Case 12 of the audit: min 20%, max 10%.)
  if (p.min < 0 || p.max < 0 || p.min > 1 || p.max > 1) {
    add("error", "range-bounds", "ב-" + sym + ": יעדי המינימום והמקסימום חייבים להיות בין 0% ל-100% (התקבלו " + pct(p.min) + " ו-" + pct(p.max) + ").");
  }
  if (p.min > p.max) {
    add("error", "min-gt-max", "ב-" + sym + ": יעד המינימום (" + pct(p.min) + ") גדול מיעד המקסימום (" + pct(p.max) + "). המינימום חייב להיות קטן או שווה למקסימום.");
  }
  if (p.dilute < 0 || p.dilute > MAX_DILUTE) {
    add("error", "dilute-bounds", "ב-" + sym + ": רף הדילול (" + pct(p.dilute) + ") אינו סביר. הוא חייב להיות בין 0% ל-" + pct(MAX_DILUTE) + ".");
  } else if (p.dilute < p.max) {
    add("error", "max-gt-dilute", "ב-" + sym + ": רף הדילול (" + pct(p.dilute) + ") נמוך מיעד המקסימום (" + pct(p.max) + "). רף הדילול חייב להיות גדול או שווה למקסימום.");
  }

  if (p.priceTarget != null && !(p.priceTarget > 0)) {
    add("error", "price-target-invalid", "ב-" + sym + ": יעד המחיר (" + money(p.priceTarget) + ") חייב להיות גדול מ-0 (או להישאר ריק).");
  }
  if (!/^[A-Za-z0-9:_.-]+$/.test(sym)) {
    add("warning", "symbol-chars", "הסימול \"" + sym + "\" כולל תווים לא רגילים, ולכן אי אפשר לשלוף עבורו מחיר חי.");
  }
  return out;
}

export interface TradeValidationOptions {
  /** Today as YYYY-MM-DD, for the future-date warning. Defaults to the current UTC date. */
  today?: string;
  /** A positive fee is an error instead of a warning - for a trade the user is typing in. */
  feeSignIsError?: boolean;
}

/** Problems with one trade, from its own fields. */
export function validateTrade(t: Trade, opts: TradeValidationOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const label = "בעסקה " + t.symbol + " (" + t.date + ")";
  const add = (sev: IssueSeverity, code: string, msg: string) => out.push(issue(sev, code, msg, "trade", t.id, t.symbol));

  if (!isRealDate(t.date)) {
    add("error", "date-invalid", "בעסקה " + t.symbol + ": התאריך \"" + t.date + "\" אינו תאריך אמיתי בלוח השנה (למשל 31 בפברואר).");
  } else {
    const year = Number(t.date.slice(0, 4));
    if (year < MIN_YEAR || year > MAX_YEAR) {
      add("error", "date-out-of-range", label + ": השנה חייבת להיות בין " + MIN_YEAR + " ל-" + MAX_YEAR + ".");
    } else {
      const today = opts.today ?? new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
      if (t.date > tomorrow) add("warning", "date-future", label + ": העסקה מתוארכת לעתיד.");
    }
  }
  if (!(t.qty > 0)) add("error", "qty-invalid", label + ": הכמות (" + t.qty + ") חייבת להיות גדולה מ-0.");
  if (!(t.price > 0)) add("error", "price-invalid", label + ": המחיר (" + money(t.price) + ") חייב להיות גדול מ-0.");
  if (t.qty > 0 && t.price > 0 && !nearlyEqual(t.value, t.qty * t.price)) {
    add("warning", "value-mismatch", label + ": השווי (" + money(t.value) + ") שונה מכמות × מחיר (" + money(t.qty * t.price) + ").");
  }
  if (t.fee > 0) {
    add(opts.feeSignIsError ? "error" : "warning", "fee-positive",
      label + ": העמלה (" + money(t.fee) + ") חיובית. עמלה נרשמת כמספר שלילי (עלות); עמלה חיובית מגדילה את המזומן במקום להקטין אותו.");
  }
  return out;
}

/** Every problem in a portfolio: each position and trade on its own, plus the
 * problems that only exist across items (duplicates, id counters). */
export function validatePortfolio(data: PortfolioData, opts: TradeValidationOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  const symbolSeen = new Set<string>();
  const positionIds = new Set<number>();
  let maxPositionId = -1;
  for (const p of data.positions) {
    out.push(...validatePosition(p));
    const key = p.symbol.trim().toUpperCase();
    if (symbolSeen.has(key)) out.push(issue("error", "duplicate-symbol", "הסימול " + p.symbol + " מופיע בתיק יותר מפעם אחת.", "position", p.id, p.symbol));
    symbolSeen.add(key);
    if (positionIds.has(p.id)) out.push(issue("error", "duplicate-id", "ב-" + p.symbol + ": מזהה האחזקה (" + p.id + ") משותף ליותר מאחזקה אחת.", "position", p.id, p.symbol));
    positionIds.add(p.id);
    maxPositionId = Math.max(maxPositionId, p.id);
  }
  if (data.nextPositionId <= maxPositionId) {
    out.push(issue("error", "next-position-id", "מונה מזהי האחזקות (" + data.nextPositionId + ") אינו גדול ממזהה קיים (" + maxPositionId + "), ולכן אחזקה חדשה עלולה לקבל מזהה כפול.", "portfolio", null, null));
  }

  const tradeIds = new Set<number>();
  let maxTradeId = -1;
  for (const t of data.trades) {
    out.push(...validateTrade(t, opts));
    if (tradeIds.has(t.id)) out.push(issue("error", "duplicate-id", "בעסקה " + t.symbol + " (" + t.date + "): מזהה העסקה (" + t.id + ") משותף ליותר מעסקה אחת.", "trade", t.id, t.symbol));
    tradeIds.add(t.id);
    maxTradeId = Math.max(maxTradeId, t.id);
  }
  if (data.nextTradeId <= maxTradeId) {
    out.push(issue("error", "next-trade-id", "מונה מזהי העסקאות (" + data.nextTradeId + ") אינו גדול ממזהה קיים (" + maxTradeId + "), ולכן עסקה חדשה עלולה לקבל מזהה כפול.", "portfolio", null, null));
  }
  out.push(...validateAnchors(data.ledgerAnchors));
  return out;
}

export const errorsOf = (issues: ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.severity === "error");

/** Errors present in `next` that were not already in `previous` - the ones a save
 * must refuse. A problem that is already stored (same item, same rule) is not
 * new, so a portfolio that already contains one can still be edited and saved. */
export function newErrors(next: ValidationIssue[], previous: ValidationIssue[]): ValidationIssue[] {
  const known = new Set(previous.filter((i) => i.severity === "error").map((i) => i.key));
  return next.filter((i) => i.severity === "error" && !known.has(i.key));
}

/** One Hebrew sentence for the user: the first few problems and how many more. */
export function formatRejection(issues: ValidationIssue[], max = 3): string {
  const shown = issues.slice(0, max).map((i) => i.message).join(" ");
  const rest = issues.length - max;
  return "השינויים לא נשמרו כי נתוני התיק אינם תקינים. " + shown + (rest > 0 ? " (ועוד " + rest + " בעיות)" : "");
}
