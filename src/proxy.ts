import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, isSessionStillValid } from "@/lib/session";

const PUBLIC_ROUTES = new Set(["/login", "/register", "/verify", "/forgot-password", "/reset-password"]);
// Reset links are a one-time, token-scoped action that should work
// regardless of whether the visiting browser also happens to hold an
// unrelated valid session (e.g. requested from a phone, opened on a
// laptop that's still logged in elsewhere) - unlike /login etc., a
// logged-in visitor should not be bounced away before they can use it.
const SKIP_LOGGED_IN_REDIRECT = new Set(["/reset-password"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);
  const session = decodeSession(request.cookies.get("session")?.value, request.headers.get("user-agent"));

  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && session && !SKIP_LOGGED_IN_REDIRECT.has(pathname)) {
    // decodeSession only checks the signature/expiry/fingerprint - a cookie
    // can pass that and still be stale (password changed or "log out
    // everywhere" clicked on another device, bumping sessionsValidAfter
    // past this token's iat). Without this extra check, a stale-but-
    // signature-valid cookie would bounce the user away from /login here
    // while getSession()'s deeper check bounces them right back from every
    // protected page - an infinite redirect loop with no way out short of
    // clearing cookies, since neither redirect ever lands anywhere that can
    // fix the cookie.
    if (await isSessionStillValid(session)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
