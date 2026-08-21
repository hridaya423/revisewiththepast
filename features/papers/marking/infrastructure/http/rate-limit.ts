import type { NextRequest } from "next/server";

import { getMarkingRateLimits, reservePaperGeneration } from "@/features/mcp/rate-limit";

export function retryAfterHeaders(error: unknown): Record<string, string> {
  const retryAt = typeof error === "object" && error !== null && "retryAt" in error
    ? (error as { retryAt?: unknown }).retryAt
    : undefined;
  if (typeof retryAt !== "number") return {};
  return { "Retry-After": String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))) };
}

export async function reserveMarkingOperation(request: NextRequest, scope: string) {
  await reservePaperGeneration(request, scope, getMarkingRateLimits());
}
