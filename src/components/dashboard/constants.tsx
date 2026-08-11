import type { ReactNode } from "react";
import { ArrowUpCircle, ArrowDownCircle, PiggyBank, MoreHorizontal } from "lucide-react";
import type { Tone, TradeFormState, PositionFormState } from "./types";

// Real brand colors where the company actually has a signature one. Palantir,
// Rocket Lab and Apple all brand themselves in plain black/white with no
// accent color - true black would vanish on this dark background, so those
// get a distinct shade of gray instead, chosen so they don't collide with
// each other. IBIT uses Bitcoin's orange (what it tracks) instead of its
// issuer BlackRock's own black/white branding, since that's what's actually
// recognizable at a glance.
export const SYMBOL_COLORS: Record<string, string> = {
  NVDA: "#76B900",  // NVIDIA green
  TSLA: "#E82127",  // Tesla red
  GOOG: "#4285F4",  // Google blue
  ETH: "#627EEA",   // Ethereum purple
  SOFI: "#00A6D6",  // SoFi cyan
  PLTR: "#F4F4F5",  // Palantir - monochrome brand, lightest gray
  RKLB: "#A1A1AA",  // Rocket Lab - monochrome brand
  AAPL: "#71717A",  // Apple - monochrome brand
  IBIT: "#F7931A",  // Bitcoin orange - IBIT tracks BTC, more recognizable than BlackRock's black/white
  CASH: "#94A3B8",
};
export const FALLBACK_COLORS = ["#22D3A8", "#4FA3F7", "#A78BFA", "#FF5A5F", "#F2A93B", "#34D399", "#8B93FF", "#F472B6", "#60A5FA", "#FBBF24"];

export const TRADINGVIEW_SYMBOL_MAP: Record<string, string | null> = { ETH: "ETHUSD", CASH: null };

export const TONE_STYLES: Record<Tone, { bg: string; border: string; text: string }> = {
  green: { bg: "var(--gain-subtle)", border: "var(--gain-subtle-border)", text: "var(--gain)" },
  amber: { bg: "var(--warning-subtle)", border: "var(--warning-subtle-border)", text: "var(--warning)" },
  red: { bg: "var(--loss-subtle)", border: "var(--loss-subtle-border)", text: "var(--loss)" },
  blue: { bg: "var(--info-subtle)", border: "var(--info-subtle-border)", text: "var(--info)" },
};

export const ACTION_LABELS: Record<string, { label: string; tone: Tone; icon: ReactNode }> = {
  "קנייה": { label: "קנייה", tone: "green", icon: <ArrowUpCircle size={14} /> },
  "מכירה": { label: "מכירה", tone: "red", icon: <ArrowDownCircle size={14} /> },
  "הפקדה": { label: "הפקדה", tone: "blue", icon: <PiggyBank size={14} /> },
  "משיכה": { label: "משיכה", tone: "amber", icon: <ArrowDownCircle size={14} /> },
  "אחר": { label: "אחר", tone: "blue", icon: <MoreHorizontal size={14} /> },
};

export const SYMOPTS = ["NVDA", "IBIT", "PLTR", "TSLA", "GOOG", "SOFI", "RKLB", "ETH", "CASH", "AMAT", "HOOD", "DUOL", "MSTR", "AMZN", "CIBR", "META", "PANW", "OKLO", "CRWD", "IREN", "NFLX"];
export const STRATEGY_OPTS = [
  "📈 קנייה DCA",
  "🚨 מכירה דילול",
  "➕ הפקדה",
  "⚙️ אחר",
];
export const ACTION_OPTS = ["קנייה", "מכירה", "הפקדה", "משיכה", "אחר"];

export const EMPTY_FORM: TradeFormState = {
  date: new Date().toISOString().slice(0, 10),
  symbol: "NVDA", action: "קנייה",
  qty: "", price: "", fee: "-2.5", strategy: "📈 קנייה DCA", notes: "", pnlManual: "",
};

export const EMPTY_POSITION_FORM: PositionFormState = { symbol: "", qty: "", price: "", min: "", max: "", dilute: "", priceTarget: "" };

export const PRICE_REFRESH_INTERVAL_MS = 75_000;
