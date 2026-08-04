import "server-only";

import { getToken as getConvexToken } from "@convex-dev/better-auth/utils";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

function getConvexSiteUrl() {
  const convexSiteUrl = getServerEnvironment().NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexSiteUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL");
  }
  return convexSiteUrl;
}

function getAuthBasePath() {
  return getServerEnvironment().BETTER_AUTH_BASE_PATH;
}

async function buildHeaders(sourceHeaders?: Headers) {
  if (sourceHeaders) return new Headers(sourceHeaders);
  const { headers } = await import("next/headers");
  return new Headers(await headers());
}

export async function getAuthToken(sourceHeaders?: Headers) {
  const headers = await buildHeaders(sourceHeaders);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const token = await getConvexToken(getConvexSiteUrl(), headers, {
    basePath: getAuthBasePath(),
  });
  return token.token;
}

export async function requireAuthToken(sourceHeaders?: Headers) {
  const token = await getAuthToken(sourceHeaders);
  if (!token) {
    throw new Error("Unauthorized");
  }
  return token;
}

export async function isAuthenticatedRequest(sourceHeaders: Headers) {
  return Boolean(await getAuthToken(sourceHeaders));
}

export function unauthorizedResponse(message = "Unauthorized") {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
