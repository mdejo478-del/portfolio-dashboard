"use server";

import { verifySession } from "@/lib/dal";
import { savePortfolio, isValidPortfolioData } from "@/lib/portfolio";

export async function savePortfolioAction(data: unknown): Promise<void> {
  const session = await verifySession();
  if (!isValidPortfolioData(data)) {
    throw new Error("נתוני התיק שהתקבלו אינם תקינים.");
  }
  await savePortfolio(session.userId, data);
}
