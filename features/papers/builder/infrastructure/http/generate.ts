import { NextRequest } from "next/server";

import {
  buildGenerationHeaders,
  generatePaper,
  parseGeneratePaperRequest,
} from "@/features/papers/server";
import { reservePaperGeneration } from "@/features/mcp/rate-limit";
import { ValidationError } from "@/shared/application/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = parseGeneratePaperRequest(rawBody);
  if (!parsed.success) {
    return badRequest(new ValidationError("Invalid paper generation request.").message);
  }
  const body = parsed.data;

  try {
    const reservation = await reservePaperGeneration(request);
    const result = await generatePaper(body);
    const headers = buildGenerationHeaders(result, body.questionMix);
    headers["X-RateLimit-Remaining"] = String(reservation.remainingForCaller);

    return new Response(Buffer.from(result.pdfBytes), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Paper generation failed", {
      subjectKey: body.subjectKey,
      subjectTier: body.subjectTier,
      targetMode: body.targetMode,
      targetMarks: body.targetMarks,
      requestedTimeMinutes: body.timeMinutes,
      paperCodes: body.paperCodes,
      selectedTopicNodeIdsCount: body.selectedTopicNodeIds.length,
      remainingPaperCount: body.remainingPaperCount,
      priorPaperCount: body.priorPaperCount,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : 500;
    const headers: Record<string, string> = {};
    if (typeof error === "object" && error !== null && "retryAt" in error && typeof error.retryAt === "number") {
      headers["Retry-After"] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
    }
    return new Response(status >= 500 ? `Failed to generate paper: ${message}` : message, { status, headers });
  }
}
