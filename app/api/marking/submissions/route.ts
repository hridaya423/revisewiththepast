import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { createSubmission, createSubmissionRequestSchema } from "@/features/papers/server";
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

  const parsed = createSubmissionRequestSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid submission request.");

  try {
    return Response.json(await createSubmission(parsed.data));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Failed to create marking submission.");
    if (normalized.status === 403) return unauthorizedResponse();
    return badRequest(normalized.message, normalized.status);
  }
}
