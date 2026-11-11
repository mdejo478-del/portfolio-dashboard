import { useEffect, useMemo, useState } from "react";
import { getWatchlistHighsAction } from "@/app/actions/watchlist";
import type { HighReading } from "@/lib/watchlistData";

/** A 52-week high moves slowly (and the server caches it for hours), so asking every half hour is plenty. */
export const HIGHS_REFRESH_INTERVAL_MS = 30 * 60_000;

/** The 52-week high of each watched symbol (upper-cased keys). A symbol not in the result has not been
 * answered yet; one that came back with `status: "missing"` has no data. When a refresh fails outright,
 * what was known stays - nothing is blanked. Asks again when the SET of symbols changes, not on every
 * edit of an item. */
export function useWatchlistHighs(symbols: string[]): Record<string, HighReading> {
  const key = useMemo(() => Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()))).sort().join(","), [symbols]);
  const [highs, setHighs] = useState<Record<string, HighReading>>({});

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    const list = key.split(",");
    const load = async () => {
      try {
        const res = await getWatchlistHighsAction(list);
        if (!cancelled) setHighs((prev) => ({ ...prev, ...res }));
      } catch {
        // Keep what is already known; the table shows "—" for what never arrived.
      }
    };
    load();
    const interval = setInterval(load, HIGHS_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [key]);

  return highs;
}
