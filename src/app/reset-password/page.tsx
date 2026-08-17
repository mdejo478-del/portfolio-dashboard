import Link from "next/link";
import { decodePasswordResetToken } from "@/lib/passwordReset";
import { AuthShell } from "@/components/auth/AuthShell";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? decodePasswordResetToken(token) : null;

  if (!payload) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: "var(--space-1)" }}>
          קישור לא תקין
        </h1>
        <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-dim)", margin: 0, marginBottom: "var(--space-6)" }}>
          קישור איפוס הסיסמה אינו תקין או שפג תוקפו (קישורים תקפים ל-30 דקות). אפשר לבקש קישור חדש.
        </p>
        <Link
          href="/forgot-password" className="auth-link"
          style={{
            display: "block", textAlign: "center", borderRadius: "var(--radius-sm)", background: "var(--accent)",
            padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
            color: "var(--accent-on)", textDecoration: "none",
          }}
        >
          בקשת קישור חדש
        </Link>
      </AuthShell>
    );
  }

  return <ResetPasswordForm token={token as string} />;
}
