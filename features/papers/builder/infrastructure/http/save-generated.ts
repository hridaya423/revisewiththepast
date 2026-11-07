import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { saveGeneratedPaper } from "@/features/papers/server";
import { reservePaperGeneration } from "@/features/mcp/rate-limit";
import { normalizeApplicationError, RateLimitError } from "@/shared/application/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GENERATED_PDF_BYTES = 40 * 1024 * 1024;

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Invalid multipart form data.");
  }

  const generationReceiptId = typeof formData.get("generationReceiptId") === "string"
    ? String(formData.get("generationReceiptId")).trim()
    : "";
  const file = formData.get("file");

  if (!generationReceiptId) return badRequest("generationReceiptId is required.");
  if (!(file instanceof File)) return badRequest("file is required.");
  if (file.size === 0) return badRequest("The generated paper is empty.");
  if (file.size > MAX_GENERATED_PDF_BYTES) return badRequest("Generated papers are limited to 40 MB.");

  try {
    const reservation = await reservePaperGeneration(request, "save-generated");
    const result = await saveGeneratedPaper({ generationReceiptId, file });
    return Response.json(result, { headers: { "X-RateLimit-Remaining": String(reservation.remainingForCaller) } });
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Could not save generated paper.");
    if (normalized.status === 403) return unauthorizedResponse();
    if (normalized instanceof RateLimitError) {
      return new Response(normalized.message, {
        status: normalized.status,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((normalized.retryAt - Date.now()) / 1000))) },
      });
    }
    return badRequest(normalized.message, normalized.status);
  }
}
