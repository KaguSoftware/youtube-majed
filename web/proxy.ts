import { NextResponse, type NextRequest } from "next/server";

import { readSession, SESSION_COOKIE } from "@/lib/session";

// A cheap first gate: no valid signature, no page. It needs no database, so an
// anonymous request never wakes Neon. It is not the authority: every page,
// route and action still calls requireUser(), which checks the user and the
// session epoch against the database.
export function proxy(request: NextRequest) {
  if (readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  const path = request.nextUrl.pathname + request.nextUrl.search;
  if (path !== "/") url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the worker's own routes (bearer-token auth),
  // the Python pipeline function (its own key), and static assets.
  matcher: ["/((?!login|api/worker|api/pipeline|_next/static|_next/image|favicon.ico|icon).*)"],
};
