import { cookies } from "next/headers";
import { encodeToken, decodeToken } from "@/lib/signedToken";

const COOKIE_NAME = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  disclaimerAccepted: boolean;
  exp: number;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  const payload = decodeToken<SessionPayload>(token);
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
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

export async function createSession(user: { id: string; name: string; email: string }): Promise<void> {
  const exp = Date.now() + SESSION_TTL_MS;
  await setSessionCookie({
    userId: user.id,
    name: user.name,
    email: user.email,
    disclaimerAccepted: false,
    exp,
  });
}

export async function acceptDisclaimer(session: SessionPayload): Promise<void> {
  await setSessionCookie({ ...session, disclaimerAccepted: true });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(COOKIE_NAME)?.value);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
