import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const session = await verifySession();
  if (!session.disclaimerAccepted) redirect("/disclaimer");
  if (session.onboardingCompleted) redirect("/");

  return <OnboardingForm />;
}
