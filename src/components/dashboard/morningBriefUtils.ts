import type { EarningsEntry, NewsHeadline } from "@/lib/portfolio";
import type { BigMover } from "@/app/actions/morningBrief";
import { fmtPct } from "@/components/dashboard/format";

const DAY_MS = 86_400_000;

/** Whole days from today to the given YYYY-MM-DD date (local calendar day,
 * matching how EarningsEntry.date and every other daily-boundary check in
 * this app already works) - negative if the date has already passed. */
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

export function daysUntilLabel(dateStr: string): string {
  const d = daysUntil(dateStr);
  if (d < 0) return "עבר";
  if (d === 0) return "היום";
  if (d === 1) return "מחר";
  return "בעוד " + d + " ימים";
}

export function earningsHourLabel(hour: EarningsEntry["hour"]): string | null {
  if (hour === "bmo") return "לפני פתיחת המסחר";
  if (hour === "amc") return "אחרי סגירת המסחר";
  return null;
}

export function moverLabel(m: BigMover): string {
  return m.symbol + " " + (m.changePct >= 0 ? "+" : "") + fmtPct(m.changePct) + " היום";
}

export interface MorningBriefSummary {
  headline: string;
  bullets: string[];
}

const NEAR_EARNINGS_DAYS = 7;

/** The compact card's one-line summary + 2-3 bullets. Priority for the
 * headline: earnings coming up soon > a big mover today > fresh news > "all
 * quiet". Deliberately doesn't pull in weight breaches here - those belong
 * to the full drawer's "watch items" section, not this glance-level summary. */
export function computeMorningBriefSummary(upcomingEarnings: EarningsEntry[], bigMovers: BigMover[], news: NewsHeadline[]): MorningBriefSummary {
  const nearEarnings = upcomingEarnings
    .filter((e) => { const d = daysUntil(e.date); return d >= 0 && d <= NEAR_EARNINGS_DAYS; })
    .sort((a, b) => a.date.localeCompare(b.date));
  const sortedMovers = [...bigMovers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const latestNews = [...news].sort((a, b) => b.datetime.localeCompare(a.datetime))[0];

  let headline: string;
  if (nearEarnings.length > 0) {
    const e = nearEarnings[0];
    headline = e.symbol + " מדווחת " + daysUntilLabel(e.date) + ".";
  } else if (sortedMovers.length > 0) {
    headline = moverLabel(sortedMovers[0]) + ".";
  } else if (latestNews) {
    headline = "כתבה חדשה על " + latestNews.symbol + ": " + latestNews.headline;
  } else {
    headline = "הכל שקט - אין אירועים משמעותיים היום.";
  }

  const bullets: string[] = [];
  for (const m of sortedMovers) {
    if (bullets.length >= 2) break;
    bullets.push(moverLabel(m));
  }
  for (const e of nearEarnings) {
    if (bullets.length >= 3) break;
    bullets.push(e.symbol + " מדווחת " + daysUntilLabel(e.date));
  }

  return { headline, bullets: bullets.slice(0, 3) };
}
