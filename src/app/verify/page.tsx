import { redirect } from "next/navigation";
import { getPendingVerification } from "@/lib/pendingVerification";
import { findUserById } from "@/lib/users";
import VerifyForm from "./VerifyForm";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const pending = await getPendingVerification();
  if (!pending) redirect("/login");

  const user = await findUserById(pending.userId);
  if (!user || user.verified) redirect("/login");

  const { reason } = await searchParams;

  return <VerifyForm email={user.email} code={user.verificationCode ?? ""} fromLogin={reason === "login"} />;
}
