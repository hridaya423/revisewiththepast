import "server-only";

import { createHmac } from "node:crypto";

import { api } from "@/convex/_generated/api";
import { DependencyUnavailableError, RateLimitError } from "@/shared/application/errors";

import { getMcpConvexClient, getMcpServiceSecret } from "./infrastructure/convex-client";

type Reservation = {
  allowed: boolean;
  retryAt: number;
  remainingForCaller: number;
  remainingGlobal: number;
};

function getClientAddress(request?: Request) {
  if (request && process.env.VERCEL === "1") {
    return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || null;
  }
  return process.env.NODE_ENV === "production" ? null : "unknown";
}

export function getCallerKey(request?: Request) {
  const address = getClientAddress(request);
  if (!address) throw new DependencyUnavailableError("Generation safeguards are unavailable.");
  const secret = getMcpServiceSecret();
  return createHmac("sha256", secret).update(address).digest("hex");
}

export async function reservePaperGeneration(request?: Request, scope = "paper") {
  const serviceSecret = getMcpServiceSecret();
  const callerKey = getCallerKey(request);

  let result: Reservation;
  try {
    result = await getMcpConvexClient().mutation(api.mcpRateLimits.reserve, {
      serviceSecret,
      callerKey,
      scope,
    });
  } catch (error) {
    console.error("MCP rate-limit reservation failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new DependencyUnavailableError("Generation safeguards are unavailable.");
  }

  if (!result.allowed) {
    throw new RateLimitError(
      "Paper generation is temporarily rate limited. Try again after the current hourly window resets.",
      result.retryAt,
    );
  }
  return result;
}
