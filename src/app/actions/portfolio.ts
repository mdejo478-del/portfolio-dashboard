"use server";

import { verifySession } from "@/lib/dal";
import { savePortfolio, type PortfolioData } from "@/lib/portfolio";

export async function savePortfolioAction(data: PortfolioData): Promise<void> {
  const session = await verifySession();
  await savePortfolio(session.userId, data);
}
