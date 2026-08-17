import { encodeToken, decodeToken } from "@/lib/signedToken";

const RESET_TTL_MS = 30 * 60 * 1000; // same window as pendingVerification's code
const PURPOSE = "password-reset";

export interface PasswordResetPayload {
  // Distinguishes this from every other signed token shape this app issues
  // (session, pending-verification) - encodeToken/decodeToken are generic,
  // so without an explicit tag here, a leaked token of a different kind
  // that happens to carry a userId/email/exp could otherwise be replayed
  // against this endpoint and accepted as a valid reset token.
  purpose: typeof PURPOSE;
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export function createPasswordResetToken(user: { id: string; email: string }): string {
  const now = Date.now();
  return encodeToken<PasswordResetPayload>({
    purpose: PURPOSE, userId: user.id, email: user.email, iat: now, exp: now + RESET_TTL_MS,
  });
}

export function decodePasswordResetToken(token: string | undefined | null): PasswordResetPayload | null {
  const payload = decodeToken<PasswordResetPayload>(token);
  if (!payload || payload.purpose !== PURPOSE) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}
