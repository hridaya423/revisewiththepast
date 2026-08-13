import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { ocrRequestSchema, runQuestionOcr } from "@/features/papers/server";
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

  const parsed = ocrRequestSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid OCR request.");

  try {
    return Response.json(await runQuestionOcr(parsed.data));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "OCR failed.");
    if (normalized.status === 403) return unauthorizedResponse();
    return badRequest(normalized.message, normalized.status);
  }
}
