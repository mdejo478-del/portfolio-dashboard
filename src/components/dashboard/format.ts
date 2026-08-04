import { SYMBOL_COLORS, FALLBACK_COLORS, TRADINGVIEW_SYMBOL_MAP } from "./constants";

export function colorFor(symbol: string, idx: number): string {
  return SYMBOL_COLORS[symbol] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

export function tradingViewUrl(symbol: string): string | null {
  if (TRADINGVIEW_SYMBOL_MAP[symbol] === null) return null;
  const tvSymbol = TRADINGVIEW_SYMBOL_MAP[symbol] || symbol;
  return "https://www.tradingview.com/symbols/" + tvSymbol + "/";
}

export function fmtUSD(n: number | null | undefined, opts: { digits?: number } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  const digits = opts.digits !== undefined ? opts.digits : (abs < 1000 ? 2 : 0);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (n < 0 ? "-$" : "$") + s;
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return (n * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
}
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function parseNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (s === "") return NaN;
  s = s.replace(/\s/g, "");
  // Handle period used as a thousands separator (e.g. "10.000" meaning ten thousand,
  // common in Hebrew/European number formatting) - only when the whole string is
  // digit groups of exactly 3 separated by periods, so a real decimal like "150.5"
  // or "12.75" is never misinterpreted.
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  // Strip comma thousands separators (e.g. "10,000" -> "10000")
  s = s.replace(/,/g, "");
  return parseFloat(s);
}

export const PRIVACY_MASK = "•••••";
export function formatMoney(n: number | null | undefined, masked: boolean, opts: { digits?: number } = {}): string {
  return masked ? PRIVACY_MASK : fmtUSD(n, opts);
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function mapStrategyToOption(s: string | null | undefined): string {
  const str = String(s || "");
  if (str.includes("הפקדה")) return "➕ הפקדה";
  if (str.includes("דילול") || str.includes("מכירה")) return "🚨 מכירה דילול";
  if (str.includes("DCA") || str.includes("קנייה")) return "📈 קנייה DCA";
  return "⚙️ אחר";
}
