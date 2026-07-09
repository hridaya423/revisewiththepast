import "server-only";

import {
  addMarkingResponsePageInConvex,
  createMarkingSubmissionInConvex,
  setMarkingSubmissionStatusInConvex,
  updateMarkingSubmissionMetadataInConvex,
  upsertMarkingQuestionStatusInConvex,
  upsertMarkingResponseInConvex,
  upsertMarkingScoreInConvex,
} from "@/lib/marking/convex";
import { extractAnswerRegionText, requiresManualReview } from "@/lib/marking/answer-extraction";
import {
  detectPaperIdentityFromPages,
  filterBodyPages,
  type DetectedPaperIdentity,
} from "@/lib/marking/paper-identity";
import {
  getMarkableUnitsForPaperIdentity,
  getMarkableUnitsForSubject,
  sortUnitsInExamOrder,
} from "@/lib/marking/paper-maker";
import { renderPdfToPngBuffers } from "@/lib/marking/pdfjs-server";
import { parseQuestionPathFromPrompt } from "@/lib/marking/question-path";
import {
  HANDWRITTEN_OCR_MODEL,
  HANDWRITTEN_OCR_PROVIDER,
  OCR_MODEL,
  OCR_PROVIDER,
  isHandwrittenOcrConfigured,
  runDeepseekOcrOnImage,
  runHandwrittenOcrOnImage,
} from "@/lib/marking/replicate";
import { autoScoreMathPaper } from "@/lib/marking/scoring";
import type { QuestionUnit } from "@/lib/paper-maker/aqa-geography";
import { fetchAuthMutation } from "@/lib/auth-server";
import { getMarkingSubmissionBundleFromConvex } from "@/lib/marking/convex";
import { api } from "@/convex/_generated/api";

const HACKCLUB_UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";
const IMPORT_MATCH_THRESHOLD = 0.08;
const STRONG_PROMPT_MATCH_THRESHOLD = 0.18;

const QUESTION_PAPER_BOILERPLATE_TOKENS = new Set([
  "answer", "answers", "calculator", "do", "exam", "examination", "foundation", "higher",
  "instructions", "marks", "non", "paper", "questions", "reference", "return", "student", "tier", "turn", "write",
]);

export type ImportFinishedPaperOptions = {
  file: File;
  studentLabel?: string;
  existingSubmissionId?: string;
  existingSavedPaperId?: string;
  skipAutoScore?: boolean;
};

export type ImportFinishedPaperResult = {
  submissionId: string;
  savedPaperId: string;
  detectedPaperIdentity: DetectedPaperIdentity;
  matchedQuestionCount: number;
};

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeSearchText(value: string) {
  return normalizeSearchText(value).split(" ").filter((token) => token.length >= 3);
}

function scorePromptMatch(pageText: string, promptText: string, contextText: string | null) {
  const pageTokens = new Set(tokenizeSearchText(pageText));
  const promptTokens = Array.from(new Set(tokenizeSearchText(`${promptText} ${contextText ?? ""}`))).slice(0, 40);
  if (promptTokens.length === 0) return 0;
  const overlap = promptTokens.filter((token) => pageTokens.has(token)).length;
  return overlap / promptTokens.length;
}

function getUnitQuestionPath(unit: QuestionUnit) {
  const part = unit.parts[0];
  if (!part) return [];
  return parseQuestionPathFromPrompt(part.promptText, unit.questionNumber, part.questionPartNumber);
}

function detectBlankQuestionPaper(params: {
  pages: Array<{ pageNumber: number; text: string }>;
  matchedUnits: QuestionUnit[];
  mergedResponses: Map<string, { text: string }>;
}) {
  const bodyPages = params.pages.slice(1);
  if (bodyPages.length === 0 || params.matchedUnits.length === 0) {
    return { isBlankQuestionPaper: false, reason: null as string | null };
  }

  const responseTokens = tokenizeSearchText(Array.from(params.mergedResponses.values()).map((entry) => entry.text).join(" "));
  const promptTokens = new Set(
    params.matchedUnits.flatMap((unit) => tokenizeSearchText([
      unit.questionNumber,
      ...unit.parts.map((part) => part.promptText),
      ...unit.parts.map((part) => part.contextText ?? ""),
    ].join(" "))),
  );

  const residualTokens = responseTokens.filter((token) => {
    if (promptTokens.has(token)) return false;
    if (QUESTION_PAPER_BOILERPLATE_TOKENS.has(token)) return false;
    if (/^page\d*$/.test(token)) return false;
    if (/^\d+$/.test(token)) return false;
    return true;
  });

  const strongPromptPages = bodyPages.filter((page) => {
    let bestScore = 0;
    for (const unit of params.matchedUnits) {
      const promptText = unit.parts.map((part) => part.promptText).join(" ");
      const contextText = unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join(" ") || null;
      bestScore = Math.max(bestScore, scorePromptMatch(page.text, promptText, contextText));
    }
    return bestScore >= STRONG_PROMPT_MATCH_THRESHOLD;
  }).length;

  const multiQuestionPages = bodyPages.filter((page) => {
    let matchCount = 0;
    for (const unit of params.matchedUnits) {
      const promptText = unit.parts.map((part) => part.promptText).join(" ");
      const contextText = unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join(" ") || null;
      if (scorePromptMatch(page.text, promptText, contextText) >= IMPORT_MATCH_THRESHOLD) matchCount += 1;
    }
    return matchCount >= 2;
  }).length;

  const headerText = normalizeSearchText(params.pages.slice(0, 2).map((page) => page.text).join(" "));
  const hasQuestionPaperPreamble = /(paper reference|answer all questions|higher tier|foundation tier|turn over|do not write)/.test(headerText);
  const residualRatio = responseTokens.length === 0 ? 0 : residualTokens.length / responseTokens.length;

  const looksLikeBlankQuestionPaper = hasQuestionPaperPreamble
    && strongPromptPages >= Math.max(1, Math.ceil(bodyPages.length * 0.6))
    && multiQuestionPages >= Math.max(1, Math.ceil(bodyPages.length * 0.4))
    && residualTokens.length <= Math.max(20, Math.ceil(params.matchedUnits.length * 1.5))
    && residualRatio < 0.12;

  return {
    isBlankQuestionPaper: looksLikeBlankQuestionPaper,
    reason: looksLikeBlankQuestionPaper
      ? "This PDF looks like a blank question paper, not a completed student script."
      : null,
  };
}

async function uploadBufferToCdn(buffer: Buffer, fileName: string, contentType: string) {
  const apiKey = process.env.HACKCLUB_CDN_API_KEY;
  if (!apiKey) throw new Error("Missing HACKCLUB_CDN_API_KEY");

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), fileName);
  const response = await fetch(HACKCLUB_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Hack Club CDN upload failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as { id: string; url: string; size: number; content_type: string };
}

async function uploadPdfToCdn(file: File) {
  const apiKey = process.env.HACKCLUB_CDN_API_KEY;
  if (!apiKey) throw new Error("Missing HACKCLUB_CDN_API_KEY");

  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(HACKCLUB_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Hack Club CDN upload failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as { id: string; url: string; size: number; content_type: string };
}

function normalizePaperIdentityForConvex(identity: DetectedPaperIdentity) {
  return {
    paperCode: identity.paperCode,
    year: identity.year,
    session: identity.session,
    tier: identity.tier,
    sourceRelativePath: identity.sourceRelativePath ?? undefined,
    examReference: identity.examReference ?? undefined,
  };
}

function matchUnitsToPage(pageText: string, units: QuestionUnit[]) {
  return units.filter((unit) => {
    const promptText = unit.parts.map((part) => part.promptText).join(" ");
    const contextText = unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join(" ") || null;
    return scorePromptMatch(pageText, promptText, contextText) >= IMPORT_MATCH_THRESHOLD;
  });
}

type PageImage = { url: string; uploadId: string; size: number; fileName: string };

async function buildHandwrittenOcrText(
  pageNumbers: number[],
  pageImageByNumber: Map<number, PageImage>,
  cache: Map<number, string>,
): Promise<string> {
  if (!isHandwrittenOcrConfigured()) return "";
  const blocks: string[] = [];
  for (const pageNumber of pageNumbers) {
    if (!cache.has(pageNumber)) {
      const image = pageImageByNumber.get(pageNumber);
      let text = "";
      if (image) {
        try {
          const handwritten = await runHandwrittenOcrOnImage(image.url);
          text = handwritten.text.trim();
        } catch (error) {
          console.warn(`Handwritten OCR failed for page ${pageNumber}:`, error);
        }
      }
      cache.set(pageNumber, text);
    }
    const cached = cache.get(pageNumber) ?? "";
    if (cached) blocks.push(`Page ${pageNumber}\n${cached}`.trim());
  }
  return blocks.join("\n\n").trim();
}

async function resolveAnswerOcr(params: {
  merged: { text: string; pages: number[] };
  promptText: string;
  contextText: string | null;
  pageImageByNumber: Map<number, PageImage>;
  handwrittenOcrByNumber: Map<number, string>;
}): Promise<{ ocrText: string; usedHandwritten: boolean; handwrittenText: string; answerExtraction: unknown }> {
  const { merged, promptText, contextText, pageImageByNumber, handwrittenOcrByNumber } = params;
  const extracted = extractAnswerRegionText({ fullOcrText: merged.text, promptText, contextText });

  if (extracted.answerText) {
    return { ocrText: extracted.answerText, usedHandwritten: false, handwrittenText: "", answerExtraction: extracted.rawJson };
  }

  const handwrittenText = await buildHandwrittenOcrText(merged.pages, pageImageByNumber, handwrittenOcrByNumber);
  if (!handwrittenText) {
    return { ocrText: merged.text, usedHandwritten: false, handwrittenText: "", answerExtraction: extracted.rawJson };
  }

  const combined = `${merged.text}\n\n${handwrittenText}`.trim();
  const reExtracted = extractAnswerRegionText({ fullOcrText: combined, promptText, contextText });
  return {
    ocrText: reExtracted.answerText || handwrittenText,
    usedHandwritten: true,
    handwrittenText,
    answerExtraction: reExtracted.rawJson,
  };
}

export async function importFinishedPaper(options: ImportFinishedPaperOptions): Promise<ImportFinishedPaperResult> {
  const { file, studentLabel, skipAutoScore = false, existingSubmissionId } = options;
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  const { pages: renderedPages, textPages } = await renderPdfToPngBuffers(pdfBytes);

  if (existingSubmissionId) {
    return attachScriptToExistingSubmission({
      file,
      submissionId: existingSubmissionId,
      renderedPages,
      textPages,
      skipAutoScore,
    });
  }

  const allUnits = await getMarkableUnitsForSubject("edexcel-mathematics-higher");
  const bodyTextPages = filterBodyPages(textPages);
  const paperIdentity = detectPaperIdentityFromPages(textPages, allUnits);
  if (!paperIdentity) {
    throw new Error("Could not identify the source exam paper from this PDF. Check that the first pages include the exam reference and date.");
  }

  const paperUnits = await getMarkableUnitsForPaperIdentity(paperIdentity);
  if (paperUnits.length === 0) {
    throw new Error(`No question bank entries found for ${paperIdentity.paperCode} ${paperIdentity.session} ${paperIdentity.year}.`);
  }

  const pageOcrByNumber = new Map<number, string>();
  const pageImageByNumber = new Map<number, { url: string; uploadId: string; size: number; fileName: string }>();

  for (const rendered of renderedPages) {
    const fileName = `${file.name.replace(/\.pdf$/i, "")}-page-${String(rendered.pageNumber).padStart(3, "0")}.png`;
    const upload = await uploadBufferToCdn(rendered.png, fileName, "image/png");
    pageImageByNumber.set(rendered.pageNumber, {
      url: upload.url,
      uploadId: upload.id,
      size: upload.size,
      fileName,
    });

    const ocr = await runDeepseekOcrOnImage(upload.url).catch((error) => {
      console.warn(`Printed OCR failed for page ${rendered.pageNumber}:`, error);
      return { text: "", output: null, predictionId: null };
    });
    pageOcrByNumber.set(rendered.pageNumber, ocr.text.trim());
  }

  const matchedUnitKeys = new Set<string>();
  const pageAssignments = new Map<number, QuestionUnit[]>();
  const mergedResponses = new Map<string, { text: string; pages: number[] }>();

  for (const page of bodyTextPages) {
    const ocrText = pageOcrByNumber.get(page.pageNumber) ?? page.text;
    const matchedOnPage = matchUnitsToPage(`${ocrText}\n${page.text}`, paperUnits);
    if (matchedOnPage.length === 0) continue;
    pageAssignments.set(page.pageNumber, matchedOnPage);

    for (const unit of matchedOnPage) {
      matchedUnitKeys.add(unit.unitKey);
      const existing = mergedResponses.get(unit.unitKey);
      const pageBlock = `Page ${page.pageNumber}\n${ocrText}`.trim();
      if (existing) {
        existing.text = `${existing.text}\n\n${pageBlock}`.trim();
        existing.pages.push(page.pageNumber);
      } else {
        mergedResponses.set(unit.unitKey, { text: pageBlock, pages: [page.pageNumber] });
      }
    }
  }

  const matchedUnits = paperUnits.filter((unit) => matchedUnitKeys.has(unit.unitKey));
  if (matchedUnits.length === 0) {
    throw new Error("Could not identify questions from this PDF. Try a clearer scan or upload page by page.");
  }

  const importCheck = detectBlankQuestionPaper({
    pages: textPages,
    matchedUnits,
    mergedResponses: new Map(Array.from(mergedResponses.entries()).map(([key, value]) => [key, { text: value.text }])),
  });
  if (importCheck.isBlankQuestionPaper) {
    throw new Error(importCheck.reason ?? "This PDF cannot be imported for marking.");
  }

  const orderedUnits = sortUnitsInExamOrder(matchedUnits, getUnitQuestionPath);
  const pdfUpload = await uploadPdfToCdn(file);

  const savedPaperId = await fetchAuthMutation(api.savedPapers.createSavedPaper, {
    subjectKey: "edexcel-mathematics-higher",
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    tier: paperIdentity.tier === "none" ? "higher" : paperIdentity.tier,
    title: `${paperIdentity.session} ${paperIdentity.year} ${paperIdentity.paperCode.replace(/-/g, " ")}${studentLabel ? ` · ${studentLabel}` : ""}`,
    targetMarks: orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0),
    totalMarks: orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0),
    timeMinutes: Math.round(orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0) * 1.125),
    pdfFileName: file.name,
    pdfContentType: pdfUpload.content_type,
    pdfFileSize: pdfUpload.size,
    pdfCdnUploadId: pdfUpload.id,
    pdfUrl: pdfUpload.url,
    questions: orderedUnits.map((unit, index) => {
      const questionPath = getUnitQuestionPath(unit);
      const part = unit.parts[0];
      return {
        displayOrder: index + 1,
        unitKey: unit.unitKey,
        sourceQuestionKey: unit.sourceQuestionKey,
        sourceRelativePath: unit.sourceRelativePath,
        paperCode: unit.paperCode,
        year: unit.year ?? undefined,
        session: unit.session ?? undefined,
        questionNumber: unit.questionNumber,
        questionPartNumber: part?.questionPartNumber ?? null,
        questionPath,
        totalMarks: unit.totalMarks,
        promptText: unit.parts.map((p) => p.promptText).join("\n\n"),
        contextText: unit.parts.map((p) => p.contextText ?? "").filter(Boolean).join("\n\n") || null,
        questionType: part?.questionType ?? null,
        isChoiceQuestion: part?.isChoiceQuestion ?? false,
      };
    }),
  });

  const submissionId = await createMarkingSubmissionInConvex({
    savedPaperId,
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    subjectKey: "edexcel-mathematics-higher",
    tier: paperIdentity.tier === "none" ? "higher" : paperIdentity.tier,
    paperCode: paperIdentity.paperCode,
    year: paperIdentity.year,
    session: paperIdentity.session,
    studentLabel: studentLabel || `${file.name.replace(/\.pdf$/i, "")} script`,
    importSource: "imported_pdf",
    detectedPaperIdentity: normalizePaperIdentityForConvex(paperIdentity),
  });

  const uploadedAt = Date.now();
  for (const [pageNumber, unitsOnPage] of pageAssignments.entries()) {
    const image = pageImageByNumber.get(pageNumber);
    if (!image) continue;
    const ocrText = pageOcrByNumber.get(pageNumber) ?? "";

    for (const unit of unitsOnPage) {
      const questionPath = getUnitQuestionPath(unit);
      await addMarkingResponsePageInConvex({
        submissionId,
        questionKey: unit.unitKey,
        questionNumber: unit.questionNumber,
        questionPartNumber: questionPath[questionPath.length - 1] ?? unit.parts[0]?.questionPartNumber ?? undefined,
        pageLabel: `Script page ${pageNumber}`,
        fileName: image.fileName,
        contentType: "image/png",
        fileSize: image.size,
        cdnUploadId: image.uploadId,
        sourceImageUrl: image.url,
        scriptPageNumber: pageNumber,
        ocrText,
        uploadedAt,
      });
    }
  }

  const handwrittenOcrByNumber = new Map<number, string>();
  for (const unit of orderedUnits) {
    const merged = mergedResponses.get(unit.unitKey);
    if (!merged) {
      await upsertMarkingQuestionStatusInConvex({
        submissionId,
        questionKey: unit.unitKey,
        status: "failed",
        failureReason: "No script pages matched this question.",
      });
      continue;
    }

    const promptText = unit.parts.map((part) => part.promptText).join("\n\n");
    const contextText = unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null;
    const resolved = await resolveAnswerOcr({
      merged,
      promptText,
      contextText,
      pageImageByNumber,
      handwrittenOcrByNumber,
    });

    const primaryPage = merged.pages[0];
    const sourceImageUrl = primaryPage ? pageImageByNumber.get(primaryPage)?.url : undefined;
    const manualReview = requiresManualReview(promptText, contextText);

    await upsertMarkingResponseInConvex({
      submissionId,
      questionKey: unit.unitKey,
      questionNumber: unit.questionNumber,
      questionPartNumber: unit.parts[0]?.questionPartNumber ?? undefined,
      sourceImageUrl,
      ocrText: resolved.ocrText,
      ocrProvider: resolved.usedHandwritten ? HANDWRITTEN_OCR_PROVIDER : OCR_PROVIDER,
      ocrModel: resolved.usedHandwritten ? HANDWRITTEN_OCR_MODEL : OCR_MODEL,
      ocrRawJson: JSON.stringify({
        importedFromPdf: true,
        fullPageOcr: merged.text,
        handwrittenOcr: resolved.handwrittenText || undefined,
        usedHandwritten: resolved.usedHandwritten,
        answerExtraction: resolved.answerExtraction,
        scriptPages: merged.pages,
      }),
    });

    await upsertMarkingQuestionStatusInConvex({
      submissionId,
      questionKey: unit.unitKey,
      status: manualReview ? "needs_manual_review" : "ocr_ready",
      failureReason: manualReview ? "This question type needs manual review (graph, construction, or diagram)." : undefined,
    });
  }

  await setMarkingSubmissionStatusInConvex(submissionId, "ocr_complete");

  if (!skipAutoScore) {
    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    if (bundle) {
      const results = await autoScoreMathPaper(bundle as never);
      for (const entry of results) {
        if (entry.result.skipped) {
          await upsertMarkingQuestionStatusInConvex({
            submissionId,
            questionKey: entry.questionKey,
            status: "failed",
            failureReason: entry.reason ?? "Skipped during auto-score",
          });
          continue;
        }

        await upsertMarkingScoreInConvex({
          submissionId,
          questionKey: entry.questionKey,
          awardedMarks: entry.result.awardedMarks,
          maxMarks: entry.result.evidence.sourceUnit.totalMarks,
          confidence: entry.result.confidence,
          needsReview: entry.result.needsReview,
          rationale: entry.result.rationale,
          evidenceJson: JSON.stringify(entry.result.evidence),
          scorerProvider: "openrouter",
          scorerModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite",
          scoreStatus: "ai_suggested",
        });

        await upsertMarkingQuestionStatusInConvex({
          submissionId,
          questionKey: entry.questionKey,
          status: entry.result.needsReview ? "needs_manual_review" : "ai_scored",
        });
      }

      const requiresReview = results.some((entry) => entry.result.needsReview || entry.result.skipped);
      await setMarkingSubmissionStatusInConvex(submissionId, requiresReview ? "review_required" : "scored");
    }
  }

  return {
    submissionId,
    savedPaperId,
    detectedPaperIdentity: paperIdentity,
    matchedQuestionCount: orderedUnits.length,
  };
}

async function attachScriptToExistingSubmission(params: {
  file: File;
  submissionId: string;
  renderedPages: Array<{ pageNumber: number; png: Buffer }>;
  textPages: Array<{ pageNumber: number; text: string }>;
  skipAutoScore: boolean;
}): Promise<ImportFinishedPaperResult> {
  const bundle = await getMarkingSubmissionBundleFromConvex(params.submissionId);
  if (!bundle?.submission.savedPaperId || !bundle.savedPaperQuestions?.length) {
    throw new Error("This submission needs a linked saved paper before a finished PDF can be attached.");
  }

  const unitKeys = bundle.savedPaperQuestions.map((question) => question.unitKey);
  const paperUnits = (await getMarkableUnitsForSubject("edexcel-mathematics-higher"))
    .filter((unit) => unitKeys.includes(unit.unitKey));

  const bodyTextPages = filterBodyPages(params.textPages);
  const pageOcrByNumber = new Map<number, string>();
  const pageImageByNumber = new Map<number, { url: string; uploadId: string; size: number; fileName: string }>();

  for (const rendered of params.renderedPages) {
    const fileName = `${params.file.name.replace(/\.pdf$/i, "")}-page-${String(rendered.pageNumber).padStart(3, "0")}.png`;
    const upload = await uploadBufferToCdn(rendered.png, fileName, "image/png");
    pageImageByNumber.set(rendered.pageNumber, {
      url: upload.url,
      uploadId: upload.id,
      size: upload.size,
      fileName,
    });
    const ocr = await runDeepseekOcrOnImage(upload.url).catch((error) => {
      console.warn(`Printed OCR failed for page ${rendered.pageNumber}:`, error);
      return { text: "", output: null, predictionId: null };
    });
    pageOcrByNumber.set(rendered.pageNumber, ocr.text.trim());
  }

  const mergedResponses = new Map<string, { text: string; pages: number[] }>();
  const pageAssignments = new Map<number, QuestionUnit[]>();

  for (const page of bodyTextPages) {
    const ocrText = pageOcrByNumber.get(page.pageNumber) ?? page.text;
    const matchedOnPage = matchUnitsToPage(`${ocrText}\n${page.text}`, paperUnits);
    if (matchedOnPage.length === 0) continue;
    pageAssignments.set(page.pageNumber, matchedOnPage);
    for (const unit of matchedOnPage) {
      const existing = mergedResponses.get(unit.unitKey);
      const pageBlock = `Page ${page.pageNumber}\n${ocrText}`.trim();
      if (existing) {
        existing.text = `${existing.text}\n\n${pageBlock}`.trim();
        existing.pages.push(page.pageNumber);
      } else {
        mergedResponses.set(unit.unitKey, { text: pageBlock, pages: [page.pageNumber] });
      }
    }
  }

  const uploadedAt = Date.now();
  for (const [pageNumber, unitsOnPage] of pageAssignments.entries()) {
    const image = pageImageByNumber.get(pageNumber);
    if (!image) continue;
    const ocrText = pageOcrByNumber.get(pageNumber) ?? "";
    for (const unit of unitsOnPage) {
      const questionPath = getUnitQuestionPath(unit);
      await addMarkingResponsePageInConvex({
        submissionId: params.submissionId,
        questionKey: unit.unitKey,
        questionNumber: unit.questionNumber,
        questionPartNumber: questionPath[questionPath.length - 1] ?? unit.parts[0]?.questionPartNumber ?? undefined,
        pageLabel: `Script page ${pageNumber}`,
        fileName: image.fileName,
        contentType: "image/png",
        fileSize: image.size,
        cdnUploadId: image.uploadId,
        sourceImageUrl: image.url,
        scriptPageNumber: pageNumber,
        ocrText,
        uploadedAt,
      });
    }
  }

  const handwrittenOcrByNumber = new Map<number, string>();
  for (const savedQuestion of bundle.savedPaperQuestions) {
    const unit = paperUnits.find((entry) => entry.unitKey === savedQuestion.unitKey);
    if (!unit) continue;
    const merged = mergedResponses.get(unit.unitKey);
    if (!merged) {
      await upsertMarkingQuestionStatusInConvex({
        submissionId: params.submissionId,
        questionKey: unit.unitKey,
        status: "failed",
        failureReason: "No script pages matched this question.",
      });
      continue;
    }

    const promptText = unit.parts.map((part) => part.promptText).join("\n\n");
    const contextText = unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null;
    const resolved = await resolveAnswerOcr({
      merged,
      promptText,
      contextText,
      pageImageByNumber,
      handwrittenOcrByNumber,
    });
    const primaryPage = merged.pages[0];
    const sourceImageUrl = primaryPage ? pageImageByNumber.get(primaryPage)?.url : undefined;
    const manualReview = requiresManualReview(promptText, contextText);

    await upsertMarkingResponseInConvex({
      submissionId: params.submissionId,
      questionKey: unit.unitKey,
      questionNumber: unit.questionNumber,
      questionPartNumber: unit.parts[0]?.questionPartNumber ?? undefined,
      sourceImageUrl,
      ocrText: resolved.ocrText,
      ocrProvider: resolved.usedHandwritten ? HANDWRITTEN_OCR_PROVIDER : OCR_PROVIDER,
      ocrModel: resolved.usedHandwritten ? HANDWRITTEN_OCR_MODEL : OCR_MODEL,
      ocrRawJson: JSON.stringify({
        importedFromPdf: true,
        attachedToSubmission: true,
        fullPageOcr: merged.text,
        handwrittenOcr: resolved.handwrittenText || undefined,
        usedHandwritten: resolved.usedHandwritten,
        answerExtraction: resolved.answerExtraction,
        scriptPages: merged.pages,
      }),
    });

    await upsertMarkingQuestionStatusInConvex({
      submissionId: params.submissionId,
      questionKey: unit.unitKey,
      status: manualReview ? "needs_manual_review" : "ocr_ready",
      failureReason: manualReview ? "This question type needs manual review (graph, construction, or diagram)." : undefined,
    });
  }

  await updateMarkingSubmissionMetadataInConvex({
    submissionId: params.submissionId,
    importSource: "imported_pdf",
  });
  await setMarkingSubmissionStatusInConvex(params.submissionId, "ocr_complete");

  if (!params.skipAutoScore) {
    const refreshedBundle = await getMarkingSubmissionBundleFromConvex(params.submissionId);
    if (refreshedBundle) {
      const results = await autoScoreMathPaper(refreshedBundle as never);
      for (const entry of results) {
        if (entry.result.skipped) {
          await upsertMarkingQuestionStatusInConvex({
            submissionId: params.submissionId,
            questionKey: entry.questionKey,
            status: "failed",
            failureReason: entry.reason ?? "Skipped during auto-score",
          });
          continue;
        }
        await upsertMarkingScoreInConvex({
          submissionId: params.submissionId,
          questionKey: entry.questionKey,
          awardedMarks: entry.result.awardedMarks,
          maxMarks: entry.result.evidence.sourceUnit.totalMarks,
          confidence: entry.result.confidence,
          needsReview: entry.result.needsReview,
          rationale: entry.result.rationale,
          evidenceJson: JSON.stringify(entry.result.evidence),
          scorerProvider: "openrouter",
          scorerModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite",
          scoreStatus: "ai_suggested",
        });
        await upsertMarkingQuestionStatusInConvex({
          submissionId: params.submissionId,
          questionKey: entry.questionKey,
          status: entry.result.needsReview ? "needs_manual_review" : "ai_scored",
        });
      }
      const requiresReview = results.some((entry) => entry.result.needsReview || entry.result.skipped);
      await setMarkingSubmissionStatusInConvex(params.submissionId, requiresReview ? "review_required" : "scored");
    }
  }

  return {
    submissionId: params.submissionId,
    savedPaperId: bundle.submission.savedPaperId ?? bundle.savedPaper?._id ?? "",
    detectedPaperIdentity: {
      paperCode: bundle.submission.paperCode ?? bundle.savedPaperQuestions[0]?.paperCode ?? "paper-1",
      year: bundle.submission.year ?? bundle.savedPaperQuestions[0]?.year ?? 0,
      session: bundle.submission.session ?? bundle.savedPaperQuestions[0]?.session ?? "november",
      tier: bundle.submission.tier ?? "higher",
      sourceRelativePath: bundle.savedPaperQuestions[0]?.sourceRelativePath ?? null,
      examReference: null,
    },
    matchedQuestionCount: mergedResponses.size,
  };
}
