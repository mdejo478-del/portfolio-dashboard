import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { encodeToken, decodeToken } from "@/lib/signedToken";
import { findUserById } from "@/lib/users";

const COOKIE_NAME = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  disclaimerAccepted: boolean;
  onboardingCompleted: boolean;
  exp: number;
  // When this token was issued. Checked against the user's
  // sessionsValidAfter cutoff in getSession() so "log out everywhere" /
  // a password change can revoke outstanding tokens without a server-side
  // session store - old tokens missing this field just never match a cutoff
  // (undefined < number is always false), so they're unaffected.
  iat: number;
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
  const now = Date.now();
  const h = await headers();
  await setSessionCookie({
    userId: user.id,
    name: user.name,
    email: user.email,
    disclaimerAccepted: false,
    onboardingCompleted: Boolean(user.onboardingCompleted),
    exp: now + SESSION_TTL_MS,
    iat: now,
    fp: fingerprintFor(h.get("user-agent")),
  });
}

// Re-issues the current session with a fresh iat/exp, keeping this device
// logged in even after an action (e.g. changing the password) bumps the
// user's sessionsValidAfter cutoff and would otherwise revoke this token too.
export async function refreshSession(session: SessionPayload): Promise<void> {
  const now = Date.now();
  await setSessionCookie({ ...session, iat: now, exp: now + SESSION_TTL_MS });
}

export async function acceptDisclaimer(session: SessionPayload): Promise<void> {
  await setSessionCookie({ ...session, disclaimerAccepted: true });
}

export async function completeOnboarding(session: SessionPayload): Promise<void> {
  await setSessionCookie({ ...session, onboardingCompleted: true });
}

// Second check beyond the signature: the account must still exist, and this
// token must not predate a "log out everywhere" / password-change
// revocation. Both require a lookup decodeSession alone can't do. Shared
// between getSession() (protected pages/actions) and proxy.ts (which needs
// the same answer for its own, narrower reason - see the comment there).
export async function isSessionStillValid(session: SessionPayload): Promise<boolean> {
  const user = await findUserById(session.userId);
  if (!user) return false;
  if (user.sessionsValidAfter && session.iat < user.sessionsValidAfter) return false;
  return true;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const h = await headers();
  const session = decodeSession(cookieStore.get(COOKIE_NAME)?.value, h.get("user-agent"));
  if (!session) return null;
  if (!(await isSessionStillValid(session))) return null;
  return session;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
