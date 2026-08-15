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

// The fields a user can manually assign a column to when auto-detection
// isn't confident enough to proceed on its own. Deliberately narrower than
// the full HEADER_KEYWORDS field set (which also covers optional columns
// like fee/pnl/strategy/notes) - those stay auto-detect-only or blank.
export type RequiredMappingField = "date" | "symbol" | "qty" | "price" | "action";

export interface ManualMappingRequest {
  table: string[][]; // the full parsed table, so a chosen mapping can be re-run without re-reading the file
  headerRowIndex: number; // best-guess row to treat as "the header" for labeling/sample purposes
  suggested: Partial<Record<RequiredMappingField, number>>; // auto-detected columns, to pre-fill the picker
}

export interface ParseResult {
  fileError: string | null;
  rows: ParsedTradeRow[];
  // Present when auto-detection couldn't confidently resolve all of
  // date/symbol/qty/action on its own - the caller should show a manual
  // column-mapping UI instead of just displaying fileError. fileError is
  // null whenever this is set.
  needsMapping?: ManualMappingRequest;
}

// Some regional Excel installations (Hebrew/Israeli locales, where a comma
// is the decimal separator) export CSV with ";" as the field delimiter
// instead of ",". Sniffed from the first non-blank line, outside quotes -
// whichever delimiter appears more often wins; ties (and files with neither)
// default to comma.
function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  let commas = 0, semicolons = 0, inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") commas++;
    else if (!inQuotes && ch === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const body = text.replace(/^﻿/, ""); // strip UTF-8 BOM
  const delimiter = detectDelimiter(body);

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
    } else if (ch === delimiter) {
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
  // "סוג" alone is broad (could collide with an unrelated "סוג נכס"/asset-type
  // column on some exotic file), but is common enough as a lone action-column
  // header on its own that it's worth the small risk - "date"/"symbol" are
  // matched first, above, so they never lose out to it.
  action: ["סוג פעולה", "פעולה", "action", "type", "side", "סוג"],
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
  "קנייה": ["קנייה", "קניה", "קניית", "buy", "purchase"],
  "מכירה": ["מכירה", "מכירת", "sell", "sale"],
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

/** Last-resort action detection: scans a whole data row's text (every cell,
 * not just a dedicated action column) for an unambiguous buy/sell/deposit/
 * withdraw word - covers formats that encode direction in a free-text
 * description cell instead of a structured column. Deliberately excludes
 * the "אחר" (other) bucket: its keywords ("אחר"/"other"/"misc") are common
 * enough words that blind-matching them across an entire row risks false
 * positives no single-column check would have. */
function scanRowForActionKeyword(row: string[]): string | null {
  const rowText = row.join(" ").toLowerCase();
  for (const [canonical, keywords] of Object.entries(ACTION_KEYWORDS)) {
    if (canonical === "אחר") continue;
    if (keywords.some((k) => rowText.includes(k.toLowerCase()))) return canonical;
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

// Reads a CSV file's raw bytes as text, correcting for encoding rather than
// assuming UTF-8. Excel installations on Hebrew/Israeli Windows locales
// commonly export CSV as Windows-1255 (a single-byte Hebrew encoding), not
// UTF-8 - decoding one as the other doesn't fail loudly, it silently turns
// every Hebrew header into mojibake that then matches no known keyword.
// `fatal: true` makes TextDecoder throw on any byte sequence invalid for
// UTF-8; real Windows-1255 Hebrew text almost never happens to also be
// valid UTF-8, so a thrown error is a reliable "this isn't UTF-8" signal.
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1255").decode(buffer);
  }
}

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
 * file - not just row 0. Multi-section broker "activity statement" exports
 * (Interactive Brokers is one example, not a dependency - this only relies
 * on the generic HEADER_KEYWORDS match, never IBKR-specific column names)
 * bundle several report sections into one file (account info, NAV, trades,
 * dividends, ...), each with its own header row buried wherever it falls,
 * not at the top of the file. Requires at least date+symbol to count as a
 * candidate; the row with the most recognized columns wins. */
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

/** The row (within the search limit) whose own text matches the most
 * recognized field keywords, even if it falls short of findHeaderRow's
 * stricter date+symbol requirement. Used only to build a helpful error
 * message - "here's what we actually saw" beats "not found" when the user
 * has to go fix the file. */
function bestGuessHeaderRow(table: string[][]): number {
  let bestIdx = 0, bestScore = -1;
  const limit = Math.min(table.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < limit; i++) {
    const score = Object.keys(detectColumns(table[i])).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function isUnresolvedHeaderCandidate(row: string[], columns: Record<string, number>): boolean {
  if (columns.date === undefined || columns.symbol === undefined) return false;
  // A real data row's date cell holds an actual date value; a repeated
  // header row's cell holds the literal column label (e.g. "Date/Time"),
  // which never parses as a date. This is what tells the two apart.
  const dateCell = (row[columns.date] || "").trim();
  return dateCell === "" || parseFlexibleDate(dateCell) === null;
}

/** Turns one raw row + a column mapping into a validated trade row. Shared
 * by the auto-detect path and the manual-mapping path (parseWithManualMapping)
 * so the actual field-extraction/validation logic - date parsing, the
 * action-detection cascade, cash-move value fallback, error messages - only
 * exists once regardless of how the column mapping was decided. */
function buildTradeRow(row: string[], columns: Record<string, number>, rowNumber: number): ParsedTradeRow {
  const get = (field: string) => (columns[field] !== undefined ? (row[columns[field]] || "").trim() : "");

  const dateRaw = get("date");
  const date = dateRaw ? parseFlexibleDate(dateRaw) : null;
  const symbolRaw = get("symbol").toUpperCase();

  let qty = parseNum(get("qty"));
  let price = parseNum(get("price"));
  const value = parseNum(get("value"));
  const fee = parseNum(get("fee")) ?? 0;
  const pnlOverride = parseNum(get("pnl"));

  // Three-tier cascade for buy/sell direction, in order of confidence:
  // (1) an explicit action-column value that resolves via normalizeAction;
  // (2) no explicit column, or its value didn't resolve - fall back to the
  //     sign of the quantity (a common broker-export convention); (3) still
  //     nothing - scan the row's own text as a last resort. Each tier only
  //     runs if the previous one came up empty, regardless of *why* (missing
  //     column vs. present-but-unrecognized value are treated the same).
  const actionRaw = get("action");
  const fromColumn = actionRaw ? normalizeAction(actionRaw) : null;
  let action: string | null;
  if (fromColumn) {
    action = fromColumn;
  } else if (qty !== null && qty !== 0) {
    action = qty > 0 ? "קנייה" : "מכירה";
    qty = Math.abs(qty);
  } else {
    action = scanRowForActionKeyword(row);
  }

  const isCashMove = action === "הפקדה" || action === "משיכה";
  const symbol = symbolRaw || (isCashMove ? "CASH" : "");

  const strategy = get("strategy") || (action ? STRATEGY_DEFAULTS[action] : null);
  const notes = get("notes") || null;

  const errors: string[] = [];
  if (!dateRaw) errors.push("חסר תאריך");
  else if (!date) errors.push("תאריך לא תקין: '" + dateRaw + "'");
  if (!symbolRaw && !isCashMove) errors.push("חסר סימול/נכס");
  if (!action) errors.push("לא ניתן לזהות סוג פעולה (קנייה/מכירה) בשורה זו");

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

  return {
    rowNumber,
    date, symbol: symbol || null, action, qty, price, fee, pnlOverride, strategy, notes,
    error: errors.length > 0 ? errors.join(" · ") : null,
  };
}

/** A row with no valid date, no valid price, and no resolvable buy/sell
 * direction essentially never corresponds to a real individual trade -
 * structure-agnostically, it's far more likely a computed summary line, a
 * blank/filler row, or stray text that ended up inside the data range.
 * Used to silently drop such rows instead of showing them as a "missing
 * data" error, which would misrepresent a non-trade row as broken data. */
function looksLikeNonTradeRow(trade: ParsedTradeRow): boolean {
  return !trade.date && trade.price === null && !trade.action;
}

function buildParseResult(table: string[][]): ParseResult {
  if (table.length === 0) {
    return { fileError: "הקובץ ריק או שלא ניתן היה לקרוא אותו.", rows: [] };
  }

  const found = findHeaderRow(table);
  if (!found) {
    const guessIdx = bestGuessHeaderRow(table);
    return {
      fileError: null,
      rows: [],
      needsMapping: { table, headerRowIndex: guessIdx, suggested: detectColumns(table[guessIdx]) },
    };
  }
  const { index: firstHeaderIndex, columns: firstColumns } = found;

  if (firstColumns.action === undefined && firstColumns.qty === undefined) {
    return {
      fileError: null,
      rows: [],
      needsMapping: { table, headerRowIndex: firstHeaderIndex, suggested: firstColumns },
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

  // Statement exports that use the section-name-prefix convention often also
  // mark each row's own kind in the very next column (a "Header"/"Data"/
  // "SubTotal"/"Total" style vocabulary - Interactive Brokers is the common
  // example, but this is a general statement-generator pattern, not IBKR-
  // specific). Skip anything that isn't plainly a data row or a header row
  // by that column's own word, whatever the exact label a given broker uses
  // for its computed aggregates - those rows never carry a date or price
  // because they're not individual trades, not because anything is missing.
  const rowTypeCol = sectionCol !== null ? sectionCol + 1 : null;

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

    if (rowTypeCol !== null) {
      const rowType = (row[rowTypeCol] || "").trim().toLowerCase();
      if (rowType !== "" && rowType !== "data" && rowType !== "header") continue;
    }

    const candidateColumns = detectColumns(row);
    if (isUnresolvedHeaderCandidate(row, candidateColumns)) {
      activeColumns = candidateColumns;
      continue;
    }

    const trade = buildTradeRow(row, activeColumns, i + 1);
    if (looksLikeNonTradeRow(trade)) continue;
    rows.push(trade);
  }

  if (rows.length === 0) {
    return { fileError: "לא נמצאו שורות עסקאות בקובץ (רק כותרת).", rows: [] };
  }

  return { fileError: null, rows };
}

/** Finalizes a parse once the user has manually assigned columns to fields
 * (the ManualMappingRequest fallback path). Applies the same per-row
 * extraction/validation as the auto-detect path (via buildTradeRow) and the
 * same non-trade-row filter, but without the auto-detect-only structural
 * machinery (section scoping, repeated-header re-detection, row-type
 * filtering) - those exist to recover a layout automatically, which is
 * moot once the user has told us the layout directly. */
export function parseWithManualMapping(
  table: string[][],
  headerRowIndex: number,
  mapping: Partial<Record<RequiredMappingField, number>>
): ParseResult {
  const columns: Record<string, number> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    if (typeof idx === "number" && idx >= 0) columns[field] = idx;
  }

  const rows: ParsedTradeRow[] = [];
  for (let i = headerRowIndex + 1; i < table.length; i++) {
    const row = table[i];
    if (!row.some((cell) => cell.trim() !== "")) continue;
    const trade = buildTradeRow(row, columns, i + 1);
    if (looksLikeNonTradeRow(trade)) continue;
    rows.push(trade);
  }

  if (rows.length === 0) {
    return { fileError: "לא נמצאו שורות עסקאות בקובץ (רק כותרת).", rows: [] };
  }

  return { fileError: null, rows };
}
