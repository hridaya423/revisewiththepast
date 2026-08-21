import { getMarkingSubmissionBundleFromConvex, upsertMarkingQuestionStatusInConvex, upsertMarkingResponseInConvex } from "../infrastructure/convex/commands";
import { extractAnswerRegionText } from "../domain/answer-extraction";
import {
  HANDWRITTEN_OCR_MODEL,
  HANDWRITTEN_OCR_PROVIDER,
  OCR_MODEL,
  OCR_PROVIDER,
  isHandwrittenOcrConfigured,
  runDeepseekOcrOnImage,
  runHandwrittenOcrOnImage,
} from "../infrastructure/ocr/replicate";
import type { OcrRequest } from "../contracts/http";
import { NotFoundError, ValidationError } from "@/shared/application/errors";

export async function runQuestionOcr(input: OcrRequest) {
  const bundle = await getMarkingSubmissionBundleFromConvex(input.submissionId);
  if (!bundle) throw new NotFoundError("Submission not found.");

  const storedPageUrls = new Set(
    (bundle.pages ?? []).flatMap((page) => (page.sourceImageUrl ? [page.sourceImageUrl] : [])),
  );
  let pageUrls: string[];
  if (input.imageUrl) {
    if (!storedPageUrls.has(input.imageUrl)) {
      throw new ValidationError("imageUrl does not match any page uploaded to this submission.");
    }
    pageUrls = [input.imageUrl];
  } else {
    pageUrls = (bundle.pages ?? []).flatMap((page) => (
      page.questionKey === input.questionKey && page.sourceImageUrl
        ? [page.sourceImageUrl]
        : []
    ));
  }
  if (pageUrls.length === 0) throw new ValidationError("No uploaded page was found for this question.");

  await upsertMarkingQuestionStatusInConvex({ submissionId: input.submissionId, questionKey: input.questionKey, status: "ocr_pending" });

  const transcripts: string[] = [];
  const outputs: unknown[] = [];
  const predictionIds: Array<string | null> = [];
  for (const pageUrl of pageUrls) {
    const ocr = await runDeepseekOcrOnImage(pageUrl).catch(() => ({ text: "", output: null, predictionId: null }));
    transcripts.push(ocr.text.trim());
    outputs.push(ocr.output);
    predictionIds.push(ocr.predictionId);
  }

  const printedText = transcripts.map((text, index) => pageUrls.length > 1 ? `Page ${index + 1}\n${text}` : text).join("\n\n");
  const savedQuestion = (bundle.savedPaperQuestions ?? []).find((entry) => entry.unitKey === input.questionKey);
  const printedAnswer = extractAnswerRegionText({
    fullOcrText: printedText,
    promptText: savedQuestion?.promptText ?? "",
    contextText: savedQuestion?.contextText ?? null,
  });

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
    submissionId: input.submissionId,
    questionKey: input.questionKey,
    questionNumber: input.questionNumber,
    questionPartNumber: input.questionPartNumber,
    sourceImageUrl: pageUrls[0],
    ocrText: mergedText,
    ocrProvider: usedHandwritten ? HANDWRITTEN_OCR_PROVIDER : OCR_PROVIDER,
    ocrModel: usedHandwritten ? HANDWRITTEN_OCR_MODEL : OCR_MODEL,
    ocrRawJson: JSON.stringify({ predictionIds, pageUrls, outputs, usedHandwritten, handwrittenOcr: handwrittenText || undefined }),
  });
  await upsertMarkingQuestionStatusInConvex({
    submissionId: input.submissionId,
    questionKey: input.questionKey,
    status: printedText.trim() || handwrittenText.trim() ? "ocr_ready" : "failed",
    failureReason: printedText.trim() || handwrittenText.trim() ? undefined : "OCR returned no text for the uploaded page.",
  });
  return { submissionId: input.submissionId, questionKey: input.questionKey, ocrText: mergedText, predictionIds, usedHandwritten };
}
