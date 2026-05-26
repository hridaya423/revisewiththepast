import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { setMarkingSubmissionStatusInConvex, upsertMarkingResponseInConvex } from "@/lib/marking/convex";
import { OCR_MODEL, OCR_PROVIDER, runDeepseekOcrOnImage } from "@/lib/marking/replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OcrRequest = {
  submissionId?: string;
  imageUrl?: string;
  questionKey?: string;
  questionNumber?: string;
  questionPartNumber?: string;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message.includes("Unauthorized");
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let body: OcrRequest;
  try {
    body = (await request.json()) as OcrRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const questionKey = typeof body.questionKey === "string" ? body.questionKey.trim() : "";
  const questionNumber = typeof body.questionNumber === "string" ? body.questionNumber.trim() : undefined;
  const questionPartNumber = typeof body.questionPartNumber === "string" ? body.questionPartNumber.trim() : undefined;

  if (!submissionId) return badRequest("submissionId is required.");
  if (!imageUrl) return badRequest("imageUrl is required.");
  if (!questionKey) return badRequest("questionKey is required.");

  try {
    const ocr = await runDeepseekOcrOnImage(imageUrl);
    await upsertMarkingResponseInConvex({
      submissionId,
      questionKey,
      questionNumber,
      questionPartNumber,
      sourceImageUrl: imageUrl,
      ocrText: ocr.text,
      ocrProvider: OCR_PROVIDER,
      ocrModel: OCR_MODEL,
      ocrRawJson: JSON.stringify({ predictionId: ocr.predictionId, output: ocr.output }),
    });
    await setMarkingSubmissionStatusInConvex(submissionId, "ocr_complete");

    return Response.json({
      submissionId,
      questionKey,
      ocrText: ocr.text,
      predictionId: ocr.predictionId,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    return badRequest(
      `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}
