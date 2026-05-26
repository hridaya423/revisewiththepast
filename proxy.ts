import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isAuthenticatedRequest } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAuthenticated = await isAuthenticatedRequest(request.headers).catch(() => false);

  if (pathname === "/auth" && isAuthenticated) {
    return NextResponse.redirect(new URL("/paper-maker", request.url));
  }

  if (pathname.startsWith("/marking") && !isAuthenticated) {
    const redirectUrl = new URL("/auth", request.url);
    redirectUrl.searchParams.set("redirect", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/auth", "/marking/:path*"],
};
