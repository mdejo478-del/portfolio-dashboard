import { redirect } from "next/navigation";
import InvestmentDashboard from "@/components/InvestmentDashboard";
import { verifySession } from "@/lib/dal";
import { loadPortfolio, currentRevision } from "@/lib/portfolio";
import { PortfolioSchemaError } from "@/lib/schema";
import { normalizeMarketSettings } from "@/lib/marketStatus";

export default async function Home() {
  const session = await verifySession();
  if (!session.disclaimerAccepted) redirect("/disclaimer");
  if (!session.onboardingCompleted) redirect("/onboarding");

  // loadPortfolio upgrades an old file first (with a backup). A file from a NEWER version
  // of the system, or with an invalid version, is not opened or changed - say so clearly
  // instead of an unexplained server error.
  let portfolio;
  try {
    portfolio = await loadPortfolio(session.userId);
  } catch (err) {
    if (err instanceof PortfolioSchemaError) {
      return (
        <main dir="rtl" style={{ maxWidth: 560, margin: "15vh auto", padding: "0 24px", fontFamily: "var(--sans)", color: "var(--text)", lineHeight: 1.7 }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>לא ניתן לפתוח את התיק</h1>
          <p>{err.message}</p>
          <p style={{ color: "var(--text-dim)", fontSize: 14 }}>הנתונים לא נמחקו ולא שונו.</p>
        </main>
      );
    }
    throw err;
  }

  return (
    <InvestmentDashboard
      userName={session.name}
      initialPositions={portfolio.positions}
      initialTrades={portfolio.trades}
      initialLedger={portfolio.ledger}
      initialLedgerAnchors={portfolio.ledgerAnchors ?? {}}
      initialMarketSettings={normalizeMarketSettings(portfolio.marketSettings)}
      initialNextPositionId={portfolio.nextPositionId}
      initialNextTradeId={portfolio.nextTradeId}
      initialEquityHistory={portfolio.equityHistory}
      initialAlertAcks={portfolio.alertAcks}
      initialHealthScoreAck={portfolio.healthScoreAck}
      initialCashIdleSince={portfolio.cashIdleSince ?? null}
      initialRangeWidthPreference={portfolio.rangeWidthPreference ?? "medium"}
      initialRevision={currentRevision(portfolio)}
    />
  );
}
