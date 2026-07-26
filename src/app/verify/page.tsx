import { redirect } from "next/navigation";
import { getPendingVerification } from "@/lib/pendingVerification";
import { findUserById } from "@/lib/users";
import VerifyForm from "./VerifyForm";

export default async function VerifyPage() {
  const pending = await getPendingVerification();
  if (!pending) redirect("/login");

  const user = await findUserById(pending.userId);
  if (!user || user.verified) redirect("/login");

  return <VerifyForm email={user.email} code={user.verificationCode ?? ""} />;
}
