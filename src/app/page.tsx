import { redirect } from "next/navigation";
import InvestmentDashboard from "@/components/InvestmentDashboard";
import { verifySession } from "@/lib/dal";
import { getPortfolio } from "@/lib/portfolio";

export default async function Home() {
  const session = await verifySession();
  if (!session.disclaimerAccepted) redirect("/disclaimer");

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
    />
  );
}
