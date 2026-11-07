import { createHmac, randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";

import { AuthorizationError } from "@/shared/application/errors";
import { getAuthToken } from "@/shared/infrastructure/auth/tokens";
import { getConvexUrl, getServerEnvironment } from "@/shared/infrastructure/env/server";

export const GENERATION_COOKIE = "revise-generation";

export function assertGenerationOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    throw new AuthorizationError("This request must come from this site.");
  }
}

export async function generationAccess(request: NextRequest, create = false) {
  const secret = getServerEnvironment().MCP_SERVICE_SECRET ?? "";
  const existing = request.cookies.get(GENERATION_COOKIE)?.value;
  const capability = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : create ? randomBytes(32).toString("hex") : "";
  const guestHash = capability ? createHmac("sha256", secret).update(capability).digest("hex") : "";
  const client = new ConvexHttpClient(getConvexUrl());
  if (request.cookies.getAll().some((cookie) => cookie.name.endsWith("session_token"))) {
    const token = await getAuthToken(request.headers);
    if (token) client.setAuth(token);
  }
  return { client, secret, guestHash, capability };
}
