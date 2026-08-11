import { redirect } from "next/navigation";
import InvestmentDashboard from "@/components/InvestmentDashboard";
import { verifySession } from "@/lib/dal";
import { getPortfolio } from "@/lib/portfolio";

export default async function Home() {
  const session = await verifySession();
  if (!session.disclaimerAccepted) redirect("/disclaimer");
  if (!session.onboardingCompleted) redirect("/onboarding");

  const portfolio = await getPortfolio(session.userId);

  return (
    <InvestmentDashboard
      userName={session.name}
      initialPositions={portfolio.positions}
      initialTrades={portfolio.trades}
      initialLedger={portfolio.ledger}
      initialNextPositionId={portfolio.nextPositionId}
      initialNextTradeId={portfolio.nextTradeId}
      initialEquityHistory={portfolio.equityHistory}
      initialAlertAcks={portfolio.alertAcks}
      initialHealthScoreAck={portfolio.healthScoreAck}
      initialCashIdleSince={portfolio.cashIdleSince ?? null}
    />
  );
}
