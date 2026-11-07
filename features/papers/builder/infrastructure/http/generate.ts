import { createHash } from "node:crypto";

import { NextRequest } from "next/server";

import {
  buildGenerationHeaders,
  generatePaper,
  parseGeneratePaperRequest,
} from "@/features/papers/server";
import { recordGenerationReceipt } from "@/features/papers/builder/infrastructure/convex/generation-receipts";
import { reservePaperGeneration } from "@/features/mcp/rate-limit";
import { ApplicationError, RateLimitError, ValidationError } from "@/shared/application/errors";

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

    const pdfSha256 = createHash("sha256").update(result.pdfBytes).digest("hex");
    try {
      const receiptId = await recordGenerationReceipt({
        pdfSha256,
        subjectKey: result.subject.key,
        subjectTier: body.subjectTier,
        selectedUnitKeys: result.selection.selectedUnits.map((unit) => unit.unitKey),
        targetMarks: result.resolvedTargetMarks,
        totalMarks: result.selection.totalMarks,
        timeMinutes: result.timeMinutes,
        questionCount: result.selection.selectedUnits.length,
      });
      headers["X-Generation-Receipt"] = String(receiptId);
    } catch (receiptError) {
      console.error("Could not record generation receipt; saving this paper will be unavailable.", {
        message: receiptError instanceof Error ? receiptError.message : String(receiptError),
      });
    }

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
    const status = error instanceof ApplicationError ? error.status : 500;
    const headers: Record<string, string> = {};
    if (error instanceof RateLimitError) {
      headers["Retry-After"] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
    }
    const clientMessage = error instanceof ApplicationError ? error.message : "Failed to generate paper. Try again.";
    return new Response(clientMessage, { status, headers });
  }
}
