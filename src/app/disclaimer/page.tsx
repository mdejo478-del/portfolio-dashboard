import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import DisclaimerForm from "./DisclaimerForm";

export default async function DisclaimerPage() {
  const session = await verifySession();
  if (session.disclaimerAccepted) redirect("/");

  return <DisclaimerForm />;
}
