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
  if (!request || process.env.VERCEL !== "1") return "unknown";
  const value = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for");
  return value?.split(",")[0]?.trim() || "unknown";
}

export function getCallerKey(request?: Request) {
  const secret = getMcpServiceSecret();
  return createHmac("sha256", secret).update(getClientAddress(request)).digest("hex");
}

export async function reservePaperGeneration(request?: Request) {
  const serviceSecret = getMcpServiceSecret();
  const callerKey = getCallerKey(request);

  let result: Reservation;
  try {
    result = await getMcpConvexClient().mutation(api.mcpRateLimits.reserve, {
      serviceSecret,
      callerKey,
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
