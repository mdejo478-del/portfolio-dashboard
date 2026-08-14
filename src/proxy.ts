import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, isSessionStillValid } from "@/lib/session";

const PUBLIC_ROUTES = new Set(["/login", "/register", "/verify"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);
  const session = decodeSession(request.cookies.get("session")?.value, request.headers.get("user-agent"));

  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && session) {
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
