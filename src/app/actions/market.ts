"use server";

import { requireSession, verifySession } from "@/lib/dal";
import { getMarketSnapshot } from "@/lib/marketData";
import { saveMarketSettings } from "@/lib/portfolio";
import { missingReading, validateMarketSettings, type MarketSettings, type MarketSnapshot } from "@/lib/marketStatus";

/** Both indicators for the market-status card, from the cache shared by all users. Never throws:
 * whatever goes wrong, the card gets "missing" readings and shows "לא זמין". */
export async function getMarketStatusAction(): Promise<MarketSnapshot> {
  await verifySession();
  try {
    return await getMarketSnapshot();
  } catch (err) {
    console.error("[market] snapshot failed:", err);
    return { vix: missingReading("Yahoo Finance", false), fearGreed: missingReading("CNN", true) };
  }
}

export type SaveMarketSettingsResult = { ok: true; settings: MarketSettings } | { ok: false; message: string };

/** Saves the user's own thresholds. Returns the Hebrew reason instead of throwing, so it reliably
 * reaches the form. */
export async function saveMarketSettingsAction(input: unknown): Promise<SaveMarketSettingsResult> {
  const session = await requireSession();
  const check = validateMarketSettings(input);
  if (!check.ok) return { ok: false, message: check.message };
  await saveMarketSettings(session.userId, check.settings);
  return { ok: true, settings: check.settings };
}
