import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { saveManualScore, scoreRequestSchema } from "@/features/papers/server";
import { normalizeApplicationError } from "@/shared/application/errors";

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

  const parsed = scoreRequestSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid score request.");

  try {
    return Response.json(await saveManualScore(parsed.data));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Scoring update failed.");
    if (normalized.status === 403) return unauthorizedResponse();
    return badRequest(normalized.message, normalized.status);
  }
}
