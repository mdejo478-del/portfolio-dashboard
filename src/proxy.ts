import { NextResponse, type NextRequest } from "next/server";
import { decodeSession } from "@/lib/session";

const PUBLIC_ROUTES = new Set(["/login", "/register", "/verify"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);
  const session = decodeSession(request.cookies.get("session")?.value);

  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
