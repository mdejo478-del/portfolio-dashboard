// Parses uploaded trade-journal files (CSV or Excel): splits rows, fuzzy-matches
// Hebrew/English column headers, and validates each row into a ParsedTradeRow (with
// a per-row error message when something can't be reconciled) ready for a
// confirmation preview. CSV and XLSX both funnel into the same string[][] table
// shape so the header-detection/row-validation logic only needs to exist once.

export interface ParsedTradeRow {
  rowNumber: number; // 1-based, counting the header as row 1 (matches what a user sees in Excel/a text editor)
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

export interface ParseResult {
  fileError: string | null;
  rows: ParsedTradeRow[];
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

const HEADER_KEYWORDS: Record<string, string[]> = {
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
const FIELD_MATCH_ORDER = ["date", "symbol", "action", "qty", "price", "fee", "pnl", "strategy", "notes", "value"];

function detectColumns(header: string[]): Record<string, number> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const map: Record<string, number> = {};
  for (const field of FIELD_MATCH_ORDER) {
    const keywords = HEADER_KEYWORDS[field];
    const idx = normalized.findIndex((h, i) =>
      !Object.values(map).includes(i) && keywords.some((k) => h.includes(k.toLowerCase()))
    );
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

const ACTION_KEYWORDS: Record<string, string[]> = {
  "קנייה": ["קנייה", "קניה", "buy", "purchase"],
  "מכירה": ["מכירה", "sell", "sale"],
  "הפקדה": ["הפקדה", "deposit"],
  "משיכה": ["משיכה", "withdraw", "withdrawal"],
  "אחר": ["אחר", "other", "misc", "adjustment"],
};

function normalizeAction(raw: string): string | null {
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
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

const MONTH_FIRST_HINT = false; // Hebrew/Israeli files use DD/MM/YYYY, not the US MM/DD/YYYY

function parseFlexibleDate(raw: string): string | null {
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

export function parseTradeFile(text: string): ParseResult {
  return buildParseResult(parseCSV(text));
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

export async function parseTradeWorkbook(buffer: ArrayBuffer): Promise<ParseResult> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    return { fileError: "שגיאה בטעינת מנוע קריאת קובצי Excel. נסה לרענן את הדף ולנסות שוב.", rows: [] };
  }

  let table: string[][];
  try {
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { fileError: "קובץ ה-Excel לא מכיל אף גיליון.", rows: [] };
    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    table = aoa.map((row) => row.map(cellToString));
  } catch {
    return { fileError: "לא ניתן לקרוא את קובץ ה-Excel. ודא שהקובץ תקין ואינו פגום או מוגן בסיסמה.", rows: [] };
  }

  return buildParseResult(table);
}

const HEADER_SEARCH_LIMIT = 1000; // bound the scan on a pathologically large/junk file

/** Finds the row that best looks like a trade-table header, anywhere in the
 * file - not just row 0. Broker "activity statement" exports (Interactive
 * Brokers being the common one) bundle several report sections into one
 * CSV (account info, NAV, trades, dividends, ...), each with its own header
 * row buried wherever it falls, not at the top of the file. Requires at
 * least date+symbol to count as a candidate; the row with the most
 * recognized columns wins. */
function findHeaderRow(table: string[][]): { index: number; columns: Record<string, number> } | null {
  let best: { index: number; columns: Record<string, number>; score: number } | null = null;
  const limit = Math.min(table.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < limit; i++) {
    const columns = detectColumns(table[i]);
    if (columns.date === undefined || columns.symbol === undefined) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { index: i, columns, score };
  }
  return best ? { index: best.index, columns: best.columns } : null;
}

function isUnresolvedHeaderCandidate(row: string[], columns: Record<string, number>): boolean {
  if (columns.date === undefined || columns.symbol === undefined) return false;
  // A real data row's date cell holds an actual date value; a repeated
  // header row's cell holds the literal column label (e.g. "Date/Time"),
  // which never parses as a date. This is what tells the two apart.
  const dateCell = (row[columns.date] || "").trim();
  return dateCell === "" || parseFlexibleDate(dateCell) === null;
}

function buildParseResult(table: string[][]): ParseResult {
  if (table.length === 0) {
    return { fileError: "הקובץ ריק או שלא ניתן היה לקרוא אותו.", rows: [] };
  }

  const found = findHeaderRow(table);
  if (!found) {
    return {
      fileError: "לא ניתן לזהות בקובץ עמודות תאריך וסימול/נכס. ודא שיש כותרות עמודה ברורות (למשל: תאריך, סימול, סוג פעולה, כמות, מחיר).",
      rows: [],
    };
  }
  const { index: firstHeaderIndex, columns: firstColumns } = found;

  if (firstColumns.action === undefined && firstColumns.qty === undefined) {
    return {
      fileError: "לא ניתן לזהות בקובץ עמודת סוג פעולה, וגם אין עמודת כמות שממנה ניתן להסיק קנייה/מכירה. ודא שיש כותרות עמודה ברורות (למשל: תאריך, סימול, סוג פעולה, כמות, מחיר).",
      rows: [],
    };
  }

  // If the header's own first column wasn't claimed by any recognized
  // field, it's likely a section-name prefix (Interactive Brokers repeats
  // "Trades" in column 0 for every row of that section) rather than actual
  // trade data - scope the scan to just this section, stopping the moment
  // that value changes, so later sections (Dividends, Interest, ...) can't
  // get misread as trades through the same column positions. A plain
  // single-table file has its first field claimed by a real column (date
  // is very often column 0), so this never applies there.
  const sectionCol = !Object.values(firstColumns).includes(0) && table[firstHeaderIndex][0] ? 0 : null;
  const sectionName = sectionCol !== null ? table[firstHeaderIndex][sectionCol] : null;

  // Some broker statements (again, Interactive Brokers) repeat the header
  // mid-section with a different column layout when the sub-category
  // changes (stocks vs. forex, say) - re-detecting columns whenever a row
  // looks like a fresh header, instead of assuming one fixed layout for the
  // whole section, keeps those rows from being parsed against the wrong
  // column positions.
  let activeColumns = firstColumns;
  const rows: ParsedTradeRow[] = [];

  for (let i = firstHeaderIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (sectionCol !== null && (row[sectionCol] || "") !== sectionName) break;
    if (!row.some((cell) => cell.trim() !== "")) continue;

    const candidateColumns = detectColumns(row);
    if (isUnresolvedHeaderCandidate(row, candidateColumns)) {
      activeColumns = candidateColumns;
      continue;
    }

    const columns = activeColumns;
    const get = (field: string) => (columns[field] !== undefined ? (row[columns[field]] || "").trim() : "");
    // Some broker exports (again, Interactive Brokers) have no explicit
    // buy/sell column at all - direction is encoded as the sign of the
    // quantity instead. Only fall back to that when there's truly no
    // action column to read from; a section that has one is never
    // second-guessed.
    const inferActionFromQtySign = columns.action === undefined && columns.qty !== undefined;

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
    if (columns.action === undefined && columns.qty === undefined) {
      errors.push("חסר סוג פעולה");
    } else if (inferActionFromQtySign) {
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

  if (rows.length === 0) {
    return { fileError: "לא נמצאו שורות עסקאות בקובץ (רק כותרת).", rows: [] };
  }

  return { fileError: null, rows };
}
