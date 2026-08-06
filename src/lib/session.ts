import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { encodeToken, decodeToken } from "@/lib/signedToken";

const COOKIE_NAME = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  disclaimerAccepted: boolean;
  onboardingCompleted: boolean;
  exp: number;
  // Hash of the User-Agent that created this session. Bound in on every
  // request so a copied/stolen cookie used from a different client is
  // rejected. This is a basic tripwire, not device fingerprinting - it
  // doesn't stop an attacker who also spoofs the same User-Agent string.
  fp: string;
}

export function fingerprintFor(userAgent: string | null | undefined): string {
  return createHash("sha256").update(userAgent || "unknown").digest("hex").slice(0, 32);
}

export function decodeSession(token: string | undefined | null, userAgent?: string | null): SessionPayload | null {
  const payload = decodeToken<SessionPayload>(token);
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (userAgent !== undefined && payload.fp && payload.fp !== fingerprintFor(userAgent)) return null;
  return payload;
}

async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = encodeToken<SessionPayload>(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(payload.exp),
  });
}

export async function createSession(user: { id: string; name: string; email: string; onboardingCompleted?: boolean }): Promise<void> {
  const exp = Date.now() + SESSION_TTL_MS;
  const h = await headers();
  await setSessionCookie({
    userId: user.id,
    name: user.name,
    email: user.email,
    disclaimerAccepted: false,
    onboardingCompleted: Boolean(user.onboardingCompleted),
    exp,
    fp: fingerprintFor(h.get("user-agent")),
  });
}

export async function acceptDisclaimer(session: SessionPayload): Promise<void> {
  await setSessionCookie({ ...session, disclaimerAccepted: true });
}

export async function completeOnboarding(session: SessionPayload): Promise<void> {
  await setSessionCookie({ ...session, onboardingCompleted: true });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const h = await headers();
  return decodeSession(cookieStore.get(COOKIE_NAME)?.value, h.get("user-agent"));
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
