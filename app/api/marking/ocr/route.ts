import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { getMarkingSubmissionBundleFromConvex, setMarkingSubmissionStatusInConvex, upsertMarkingResponseInConvex } from "@/lib/marking/convex";
import { extractAnswerRegionText } from "@/lib/marking/answer-extraction";
import {
  HANDWRITTEN_OCR_MODEL,
  HANDWRITTEN_OCR_PROVIDER,
  OCR_MODEL,
  OCR_PROVIDER,
  isHandwrittenOcrConfigured,
  runDeepseekOcrOnImage,
  runHandwrittenOcrOnImage,
} from "@/lib/marking/replicate";

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
  if (!questionKey) return badRequest("questionKey is required.");

  try {
    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    if (!bundle) return badRequest("Submission not found.", 404);

    const pageUrls = imageUrl
      ? [imageUrl]
      : (bundle.pages ?? [])
        .filter((page) => page.questionKey === questionKey)
        .map((page) => page.sourceImageUrl)
        .filter((url): url is string => Boolean(url));

    if (pageUrls.length === 0) return badRequest("No uploaded page was found for this question.");

    const transcripts: string[] = [];
    const outputs: unknown[] = [];
    const predictionIds: Array<string | null> = [];

    for (const pageUrl of pageUrls) {
      const ocr = await runDeepseekOcrOnImage(pageUrl).catch(() => ({ text: "", output: null, predictionId: null }));
      transcripts.push(ocr.text.trim());
      outputs.push(ocr.output);
      predictionIds.push(ocr.predictionId);
    }

    const printedText = transcripts
      .map((text, index) => (pageUrls.length > 1 ? `Page ${index + 1}\n${text}` : text))
      .join("\n\n");

    const savedPaperQuestion = (bundle.savedPaperQuestions ?? []).find((entry) => entry.unitKey === questionKey);
    const promptText = savedPaperQuestion?.promptText ?? "";
    const contextText = savedPaperQuestion?.contextText ?? null;
    const printedAnswer = extractAnswerRegionText({ fullOcrText: printedText, promptText, contextText });

    let mergedText = printedText;
    let usedHandwritten = false;
    let handwrittenText = "";
    if (!printedAnswer.answerText && isHandwrittenOcrConfigured()) {
      const handwrittenBlocks: string[] = [];
      for (let index = 0; index < pageUrls.length; index += 1) {
        const handwritten = await runHandwrittenOcrOnImage(pageUrls[index]).catch(() => ({ text: "", output: null, predictionId: null }));
        const text = handwritten.text.trim();
        if (text) handwrittenBlocks.push(pageUrls.length > 1 ? `Page ${index + 1}\n${text}` : text);
      }
      handwrittenText = handwrittenBlocks.join("\n\n").trim();
      if (handwrittenText) {
        usedHandwritten = true;
        mergedText = `${printedText}\n\n${handwrittenText}`.trim();
      }
    }

    await upsertMarkingResponseInConvex({
      submissionId,
      questionKey,
      questionNumber,
      questionPartNumber,
      sourceImageUrl: pageUrls[0],
      ocrText: mergedText,
      ocrProvider: usedHandwritten ? HANDWRITTEN_OCR_PROVIDER : OCR_PROVIDER,
      ocrModel: usedHandwritten ? HANDWRITTEN_OCR_MODEL : OCR_MODEL,
      ocrRawJson: JSON.stringify({ predictionIds, pageUrls, outputs, usedHandwritten, handwrittenOcr: handwrittenText || undefined }),
    });
    await setMarkingSubmissionStatusInConvex(submissionId, "ocr_complete");

    return Response.json({
      submissionId,
      questionKey,
      ocrText: mergedText,
      predictionIds,
      usedHandwritten,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    return badRequest(
      `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}
