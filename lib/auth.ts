import "server-only";

import { getToken as getConvexToken } from "@convex-dev/better-auth/utils";

function getConvexSiteUrl() {
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexSiteUrl) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL");
  }
  return convexSiteUrl;
}

function getAuthBasePath() {
  return process.env.BETTER_AUTH_BASE_PATH ?? "/api/auth";
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
