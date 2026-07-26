import { cookies } from "next/headers";
import { encodeToken, decodeToken } from "@/lib/signedToken";

const COOKIE_NAME = "pending_verification";
const PENDING_TTL_MS = 30 * 60 * 1000;

export interface PendingVerificationPayload {
  userId: string;
  email: string;
  exp: number;
}

export async function createPendingVerification(user: { id: string; email: string }): Promise<void> {
  const exp = Date.now() + PENDING_TTL_MS;
  const token = encodeToken<PendingVerificationPayload>({ userId: user.id, email: user.email, exp });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
}

export async function getPendingVerification(): Promise<PendingVerificationPayload | null> {
  const cookieStore = await cookies();
  const payload = decodeToken<PendingVerificationPayload>(cookieStore.get(COOKIE_NAME)?.value);
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

export async function clearPendingVerification(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
