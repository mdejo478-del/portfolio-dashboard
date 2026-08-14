// Parses uploaded trade-journal files (CSV or Excel) into a raw string[][]
// table, then lets the user confirm (or correct) which row is the header
// and what each column means before any row is actually validated. Broker
// export formats vary too much to fully auto-detect reliably (buried
// headers, no explicit buy/sell column, completely different schemas per
// broker) - auto-detection here is only ever a starting suggestion the user
// reviews, never a silent decision.

export interface ParsedTradeRow {
  rowNumber: number; // 1-based file row number, for matching what the user sees in Excel/a text editor
  date: string | null;
  symbol: string | null;
  action: string | null;
  qty: number | null;
  price: number | null;
  fee: number;
  pnlOverride: number | null;
  strategy: string | null;
  notes: string | null;
  error: string | null;
}

export interface RawTable {
  fileError: string | null;
  table: string[][];
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const body = text.replace(/^﻿/, ""); // strip UTF-8 BOM

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\r") {
      // ignore, \n handles the line break
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function parseCsvToTable(text: string): RawTable {
  const table = parseCSV(text);
  if (table.length === 0) return { fileError: "הקובץ ריק או שלא ניתן היה לקרוא אותו.", table: [] };
  return { fileError: null, table };
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // XLSX date cells are parsed (with cellDates:true) as UTC-midnight Date
    // objects with no timezone of their own - read the UTC fields back out.
    const y = v.getUTCFullYear(), m = v.getUTCMonth() + 1, d = v.getUTCDate();
    return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  }
  return String(v);
}

export async function parseWorkbookToTable(buffer: ArrayBuffer): Promise<RawTable> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return { fileError: "שגיאה בטעינת מנוע קריאת קובצי Excel. נסה לרענן את הדף ולנסות שוב.", table: [] };
  }

  let table: string[][];
  try {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { fileError: "קובץ ה-Excel לא מכיל אף גיליון.", table: [] };
    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    table = aoa.map((row) => row.map(cellToString));
  } catch {
    return { fileError: "לא ניתן לקרוא את קובץ ה-Excel. ודא שהקובץ תקין ואינו פגום או מוגן בסיסמה.", table: [] };
  }
  if (table.length === 0) return { fileError: "הקובץ ריק או שלא ניתן היה לקרוא אותו.", table: [] };
  return { fileError: null, table };
}

export type FieldKey = "date" | "symbol" | "action" | "qty" | "price" | "fee" | "value" | "pnl" | "strategy" | "notes";

export const FIELD_DEFS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "date", label: "תאריך", required: true },
  { key: "symbol", label: "סימול / נכס", required: true },
  { key: "action", label: "סוג פעולה (קנייה/מכירה/...)" },
  { key: "qty", label: "כמות" },
  { key: "price", label: "מחיר" },
  { key: "fee", label: "עמלה" },
  { key: "value", label: "שווי / סכום כולל" },
  { key: "pnl", label: "רווח/הפסד" },
  { key: "strategy", label: "אסטרטגיה" },
  { key: "notes", label: "הערות" },
];

const HEADER_KEYWORDS: Record<FieldKey, string[]> = {
  date: ["תאריך", "date"],
  // "asset" alone is deliberately excluded: broker exports commonly have an
  // "Asset Category"/"Asset Class" column (e.g. "Stocks") that isn't the
  // ticker - matching on it would silently misidentify the symbol column.
  symbol: ["סימול", "נכס", "טיקר", "symbol", "ticker"],
  action: ["סוג פעולה", "פעולה", "action", "type", "side"],
  qty: ["כמות", "qty", "quantity", "units", "shares"],
  price: ["מחיר", "price"],
  value: ["שווי", "value", "amount", "סכום"],
  fee: ["עמלה", "fee", "commission"],
  pnl: ["רווח", "הפסד", "pnl", "p&l", "profit"],
  strategy: ["אסטרטגיה", "strategy", "reason"],
  notes: ["הערות", "notes", "comment"],
};

// Order matters: more specific fields are matched before looser ones (e.g. "pnl"
// keywords like "רווח" would otherwise also match a plain "value" column).
const FIELD_MATCH_ORDER: FieldKey[] = ["date", "symbol", "action", "qty", "price", "fee", "pnl", "strategy", "notes", "value"];

/** Best-guess column mapping for a header row - always just a starting
 * suggestion for the user to review/correct, never applied silently. */
export function suggestColumnMapping(header: string[]): Partial<Record<FieldKey, number>> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const map: Partial<Record<FieldKey, number>> = {};
  for (const field of FIELD_MATCH_ORDER) {
    const keywords = HEADER_KEYWORDS[field];
    const idx = normalized.findIndex((h, i) =>
      !Object.values(map).includes(i) && keywords.some((k) => h.includes(k.toLowerCase()))
    );
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

const HEADER_SEARCH_LIMIT = 1000; // bound the scan on a pathologically large/junk file

/** Best-guess header row index, anywhere in the file - not just row 0.
 * Broker "activity statement" exports (Interactive Brokers being the
 * common one) bundle several report sections into one file (account info,
 * NAV, trades, dividends, ...), each with its own header row buried
 * wherever it falls. Falls back to row 0 if nothing scores as a plausible
 * header, so there's always a starting point to show the user. */
export function suggestHeaderRowIndex(table: string[][]): number {
  let best: { index: number; score: number } | null = null;
  const limit = Math.min(table.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < limit; i++) {
    const columns = suggestColumnMapping(table[i]);
    if (columns.date === undefined || columns.symbol === undefined) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best ? best.index : 0;
}

function normalizeAction(raw: string): string | null {
  const ACTION_KEYWORDS: Record<string, string[]> = {
    "קנייה": ["קנייה", "קניה", "buy", "purchase"],
    "מכירה": ["מכירה", "sell", "sale"],
    "הפקדה": ["הפקדה", "deposit"],
    "משיכה": ["משיכה", "withdraw", "withdrawal"],
    "אחר": ["אחר", "other", "misc", "adjustment"],
  };
  const s = raw.trim().toLowerCase();
  for (const [canonical, keywords] of Object.entries(ACTION_KEYWORDS)) {
    if (keywords.some((k) => s === k.toLowerCase() || s.includes(k.toLowerCase()))) return canonical;
  }
  return null;
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.trim();
  if (s === "") return null;
  s = s.replace(/[$\s]/g, "");
  // European-style thousands separator ("1.234.567") - requires at least
  // TWO grouped ".XXX" chunks to trigger. A single chunk (e.g. "85.865") is
  // indistinguishable from an ordinary 3-decimal-place value and must be
  // left alone - misreading it as European once corrupted a real trade
  // price (85.865 -> 85865, a 1000x error) before this got a real file to
  // test against.
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

const MONTH_FIRST_HINT = false; // Hebrew/Israeli files use DD/MM/YYYY, not the US MM/DD/YYYY

export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;

  // ISO: YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoIfValid(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY or DD.MM.YYYY (Israeli convention)
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const day = MONTH_FIRST_HINT ? +b : +a;
    const month = MONTH_FIRST_HINT ? +a : +b;
    return isoIfValid(+y, month, day);
  }

  // Leading ISO date followed by a time/other junk (e.g. Interactive
  // Brokers' Date/Time column, "2026-01-15, 10:30:00") - grab just the date.
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[,T ]/);
  if (m) return isoIfValid(+m[1], +m[2], +m[3]);

  // Excel serial date number (days since 1899-12-30)
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 90000) {
      const ms = (serial - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return isoIfValid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return isoIfValid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

function isoIfValid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

const STRATEGY_DEFAULTS: Record<string, string> = {
  "קנייה": "📈 קנייה DCA",
  "מכירה": "🚨 מכירה דילול",
  "הפקדה": "➕ הפקדה",
  "משיכה": "⚙️ אחר",
};

/** Parses every row after headerRowIndex using an explicit, user-confirmed
 * column mapping - no auto-detection, no guessing at where sections start
 * or end. A row that doesn't fit (wrong section, a subtotal line, garbage)
 * simply comes back with a validation error and is never silently treated
 * as a trade; it's the caller's job to only act on error-free rows the
 * user has also chosen to keep (see TradeImportModal's per-row checkboxes). */
export function parseRowsWithMapping(
  table: string[][],
  headerRowIndex: number,
  columns: Partial<Record<FieldKey, number>>,
  inferActionFromQtySign: boolean,
): ParsedTradeRow[] {
  const rows: ParsedTradeRow[] = [];

  for (let i = headerRowIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (!row.some((cell) => cell.trim() !== "")) continue;

    const get = (field: FieldKey) => (columns[field] !== undefined ? (row[columns[field] as number] || "").trim() : "");

    const dateRaw = get("date");
    const date = dateRaw ? parseFlexibleDate(dateRaw) : null;
    const symbolRaw = get("symbol").toUpperCase();

    let qty = parseNum(get("qty"));
    let price = parseNum(get("price"));
    const value = parseNum(get("value"));
    const fee = parseNum(get("fee")) ?? 0;
    const pnlOverride = parseNum(get("pnl"));

    const actionRaw = get("action");
    let action: string | null;
    if (inferActionFromQtySign) {
      action = qty === null || qty === 0 ? null : qty > 0 ? "קנייה" : "מכירה";
      if (qty !== null) qty = Math.abs(qty);
    } else {
      action = actionRaw ? normalizeAction(actionRaw) : null;
    }
    const isCashMove = action === "הפקדה" || action === "משיכה";
    const symbol = symbolRaw || (isCashMove ? "CASH" : "");

    const strategy = get("strategy") || (action ? STRATEGY_DEFAULTS[action] : null);
    const notes = get("notes") || null;

    const errors: string[] = [];
    if (!dateRaw) errors.push("חסר תאריך");
    else if (!date) errors.push("תאריך לא תקין: '" + dateRaw + "'");
    if (!symbolRaw && !isCashMove) errors.push("חסר סימול/נכס");
    if (inferActionFromQtySign) {
      if (action === null) errors.push("לא ניתן להסיק קנייה/מכירה מכמות ריקה או אפס");
    } else if (!actionRaw) {
      errors.push("חסר סוג פעולה");
    } else if (!action) {
      errors.push("סוג פעולה לא מזוהה: '" + actionRaw + "'");
    }

    if ((qty === null || qty <= 0) || (price === null || price <= 0)) {
      // For cash movements a single "value/amount" column is enough on its own.
      if (isCashMove && value !== null && value > 0) {
        if (qty !== null && qty > 0) price = value / qty;
        else if (price !== null && price > 0) qty = value / price;
        else { qty = value; price = 1; }
      } else {
        if (qty === null || qty <= 0) errors.push("חסרה כמות תקינה");
        if (price === null || price <= 0) errors.push("חסר מחיר תקין");
      }
    }

    rows.push({
      rowNumber: i + 1,
      date, symbol: symbol || null, action, qty, price, fee, pnlOverride, strategy, notes,
      error: errors.length > 0 ? errors.join(" · ") : null,
    });
  }

  return rows;
}

export interface LedgerLike { qty: number; avgCost: number }

export interface OpeningBalanceNeed {
  symbol: string;
  /** How much quantity is missing to explain the sells in this batch without
   * the running position going negative - the minimum opening balance that
   * would make every sale in the batch cover-able. */
  deficitQty: number;
  /** Earliest date this symbol appears in the batch - the opening balance
   * is understood to exist as of just before this date. */
  firstDate: string;
}

/** Replays a chronologically-sorted set of rows against an existing ledger
 * (exactly the same buy/sell bookkeeping confirmImport itself does - this
 * only ever reads that logic's *result*, never changes it) to find any
 * symbol whose sells aren't fully explained by prior buys, whether already
 * on the books or earlier in this same batch. That's expected whenever an
 * import only covers part of a symbol's real history (e.g. a single
 * month's statement for a position opened earlier) - without a starting
 * balance for it, the resulting realized P&L for that symbol is wrong, not
 * just incomplete. */
export function detectOpeningBalanceNeeds(rows: ParsedTradeRow[], existingLedger: Record<string, LedgerLike>): OpeningBalanceNeed[] {
  const bySymbol = new Map<string, { qty: number; minQty: number; firstDate: string }>();

  const chronological = [...rows]
    .filter((r) => !r.error && r.symbol && r.symbol !== "CASH" && r.date)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));

  for (const row of chronological) {
    const symbol = row.symbol as string;
    const entry = bySymbol.get(symbol) ?? {
      qty: existingLedger[symbol]?.qty ?? 0,
      minQty: existingLedger[symbol]?.qty ?? 0,
      firstDate: row.date as string,
    };
    if (row.action === "קנייה") {
      entry.qty += row.qty as number;
    } else if (row.action === "מכירה") {
      entry.qty -= row.qty as number;
    }
    entry.minQty = Math.min(entry.minQty, entry.qty);
    bySymbol.set(symbol, entry);
  }

  const needs: OpeningBalanceNeed[] = [];
  for (const [symbol, entry] of bySymbol) {
    if (entry.minQty < 0) {
      needs.push({ symbol, deficitQty: -entry.minQty, firstDate: entry.firstDate });
    }
  }
  return needs.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Turns a user-entered opening balance into a synthetic "buy" row dated
 * the day before the symbol's earliest trade in the batch, so it's simply
 * the first thing confirmImport's own chronological replay sees for that
 * symbol - no change to that replay logic itself, just an earlier, honest
 * data point feeding into it. Shows up in the trade journal like any other
 * entry (clearly labeled), not hidden. */
export function buildOpeningBalanceRow(rowNumber: number, symbol: string, qty: number, avgCost: number, beforeDate: string): ParsedTradeRow {
  const d = new Date(beforeDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const date = d.toISOString().slice(0, 10);
  return {
    rowNumber,
    date, symbol, action: "קנייה", qty, price: avgCost, fee: 0, pnlOverride: null,
    strategy: "📋 יתרת פתיחה (הוזן ידנית)", notes: "יתרת פתיחה שהוזנה ידנית לפני ייבוא קובץ עסקאות",
    error: null,
  };
}
