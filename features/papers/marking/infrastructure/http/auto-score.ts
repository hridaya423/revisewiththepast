import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { autoScoreRequestSchema, autoScoreSubmission } from "@/features/papers/server";
import { normalizeApplicationError } from "@/shared/application/errors";
import { reserveMarkingOperation, retryAfterHeaders } from "./rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });  
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = autoScoreRequestSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid scoring request.");

  try {
    await reserveMarkingOperation(request, "marking-auto-score");
    return Response.json(await autoScoreSubmission(parsed.data));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Auto-scoring failed.");
    if (normalized.status === 403) return unauthorizedResponse();
    return new Response(normalized.message, { status: normalized.status, headers: retryAfterHeaders(error) });
  }
}
