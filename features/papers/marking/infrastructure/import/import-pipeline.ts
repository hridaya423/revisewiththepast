import "server-only";

import { createHash } from "node:crypto";

import {
  addMarkingResponsePageInConvex,
  createMarkingSubmissionInConvex,
  updateMarkingSubmissionMetadataInConvex,
  upsertMarkingQuestionStatusInConvex,
  upsertMarkingResponseInConvex,
  upsertMarkingScoreInConvex,
} from "../convex/commands";
import { requiresManualReview } from "../../domain/answer-extraction";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import { uploadToHackClubCdn } from "@/shared/infrastructure/cdn/hackclub";
import {
  detectPaperIdentityFromPages,
  filterBodyPages,
  type DetectedPaperIdentity,
} from "../../domain/paper-identity";
import {
  getMarkableUnitsForFinishedPaper,
  getMarkableUnitsForPaperIdentity,
  sortUnitsInExamOrder,
} from "../paper-library";
import { getMarkableUnitsForSubject } from "@/features/papers/infrastructure/paper-maker";
import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import {
  HANDWRITTEN_OCR_MODEL,
  HANDWRITTEN_OCR_PROVIDER,
  OCR_MODEL,
  OCR_PROVIDER,
  runDeepseekOcrOnImage,
} from "../ocr/replicate";
import { autoScoreMathPaper } from "../scoring/scoring";
import type { QuestionUnit } from "@/shared/domain/paper";
import { fetchAuthMutation } from "@/shared/infrastructure/auth/convex";
import { getMarkingSubmissionBundleFromConvex } from "../convex/commands";
import { getImportAsset, saveImportAsset } from "../convex/import-assets";
import { getSavedPaperByImportKey } from "../convex/queries";
import { api } from "@/convex/_generated/api";
import { DomainError } from "@/shared/application/errors";
import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import {
  detectBlankQuestionPaper,
  getUnitQuestionPath,
  matchUnitsToPage,
} from "./page-matching";
import { resolveAnswerOcr, type PageImage } from "./answer-ocr";

export type ImportFinishedPaperOptions = {
  file: File;
  studentLabel?: string;
  existingSubmissionId?: string;
  skipAutoScore?: boolean;
};

export type ImportFinishedPaperResult = {
  submissionId: string;
  savedPaperId: string;
  detectedPaperIdentity: DetectedPaperIdentity;
  matchedQuestionCount: number;
};

async function uploadBufferToCdn(buffer: Buffer, fileName: string, contentType: string) {
  return await uploadToHackClubCdn(new File([new Uint8Array(buffer)], fileName, { type: contentType }));
}

async function prepareImportedPages(
  importKey: string,
  sourceFileName: string,
  renderedPages: Array<{ pageNumber: number; png: Buffer }>,
) {
  const pageOcrByNumber = new Map<number, string>();
  const pageImageByNumber = new Map<number, PageImage>();

  for (const rendered of renderedPages) {
    const fileName = `${sourceFileName.replace(/\.pdf$/i, "")}-page-${String(rendered.pageNumber).padStart(3, "0")}.png`;
    let asset = await getImportAsset(importKey, rendered.pageNumber);
    if (!asset) {
      const upload = await uploadBufferToCdn(rendered.png, fileName, "image/png");
      await saveImportAsset({
        importKey,
        pageNumber: rendered.pageNumber,
        fileName,
        fileSize: upload.size,
        cdnUploadId: upload.id,
        sourceImageUrl: upload.url,
      });
      asset = await getImportAsset(importKey, rendered.pageNumber);
    }
    if (!asset) throw new Error(`Could not persist imported page ${rendered.pageNumber}.`);

    let ocrText = asset.ocrText;
    if (!ocrText) {
      try {
        ocrText = (await runDeepseekOcrOnImage(asset.sourceImageUrl)).text.trim();
        if (ocrText) {
          await saveImportAsset({
            importKey,
            pageNumber: rendered.pageNumber,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            cdnUploadId: asset.cdnUploadId,
            sourceImageUrl: asset.sourceImageUrl,
            ocrText,
          });
        }
      } catch (error) {
        console.warn(`Printed OCR failed for page ${rendered.pageNumber}:`, error);
        ocrText = "";
      }
    }

    pageImageByNumber.set(rendered.pageNumber, {
      url: asset.sourceImageUrl,
      uploadId: asset.cdnUploadId,
      size: asset.fileSize,
      fileName: asset.fileName,
    });
    pageOcrByNumber.set(rendered.pageNumber, ocrText);
  }

  return { pageOcrByNumber, pageImageByNumber };
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

export async function importFinishedPaper(options: ImportFinishedPaperOptions): Promise<ImportFinishedPaperResult> {
  const { file, studentLabel, skipAutoScore = false, existingSubmissionId } = options;
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  const assetKey = createHash("sha256")
    .update(pdfBytes)
    .update(`\0${studentLabel ?? ""}\0${existingSubmissionId ?? ""}`)
    .digest("hex");
  const { pages: renderedPages, textPages } = await renderPdfToPngBuffers(pdfBytes);

  if (existingSubmissionId) {
    return attachScriptToExistingSubmission({
      file,
      importKey: assetKey,
      submissionId: existingSubmissionId,
      renderedPages,
      textPages,
      skipAutoScore,
    });
  }

  const allUnits = await getMarkableUnitsForFinishedPaper();
  const bodyTextPages = filterBodyPages(textPages);
  const paperIdentity = detectPaperIdentityFromPages(textPages, allUnits);
  if (!paperIdentity) {
    throw new DomainError("Could not identify the source exam paper from this PDF. Check that the first pages include the exam reference and date.");
  }

  const paperUnits = await getMarkableUnitsForPaperIdentity(paperIdentity);
  if (paperUnits.length === 0) {
    throw new DomainError(`No question bank entries found for ${paperIdentity.paperCode} ${paperIdentity.session} ${paperIdentity.year}.`);
  }

  const { pageOcrByNumber, pageImageByNumber } = await prepareImportedPages(assetKey, file.name, renderedPages);

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
    throw new DomainError("Could not identify questions from this PDF. Try a clearer scan or upload page by page.");
  }

  const importCheck = detectBlankQuestionPaper({
    pages: textPages,
    matchedUnits,
    mergedResponses: new Map(Array.from(mergedResponses.entries()).map(([key, value]) => [key, { text: value.text }])),
  });
  if (importCheck.isBlankQuestionPaper) {
    throw new DomainError(importCheck.reason ?? "This PDF cannot be imported for marking.");
  }

  const orderedUnits = sortUnitsInExamOrder(matchedUnits, getUnitQuestionPath);
  const subject = getPaperMakerSubject(paperIdentity.subjectKey);
  if (!subject) throw new DomainError("Could not resolve the detected paper subject.");
  const importKey = createHash("sha256")
    .update(pdfBytes)
    .update(`\0${subject.key}\0${studentLabel ?? ""}`)
    .digest("hex");
  const existingSavedPaper = await getSavedPaperByImportKey(importKey);
  const pdfUpload = existingSavedPaper
    ? {
      id: existingSavedPaper.pdfCdnUploadId,
      url: existingSavedPaper.pdfUrl,
      size: existingSavedPaper.pdfFileSize,
      contentType: existingSavedPaper.pdfContentType,
    }
    : await uploadToHackClubCdn(file);

  const savedPaperId = await fetchAuthMutation(api.savedPapers.createSavedPaper, {
    importKey,
    subjectKey: subject.key,
    boardCode: subject.boardCode,
    subjectSlug: subject.subjectSlug,
    tier: paperIdentity.tier,
    title: `${paperIdentity.session} ${paperIdentity.year} ${paperIdentity.paperCode.replace(/-/g, " ")}${studentLabel ? ` · ${studentLabel}` : ""}`,
    targetMarks: orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0),
    totalMarks: orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0),
    timeMinutes: Math.round(orderedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0) * subject.recommendedMinutesPerMark),
    pdfFileName: file.name,
    pdfContentType: pdfUpload.contentType,
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
        contextText: unit.parts.flatMap((p) => p.contextText ? [p.contextText] : []).join("\n\n") || null,
        questionType: part?.questionType ?? null,
        isChoiceQuestion: part?.isChoiceQuestion ?? false,
      };
    }),
  });

  const submissionId = await createMarkingSubmissionInConvex({
    idempotencyKey: importKey,
    savedPaperId,
    boardCode: subject.boardCode,
    subjectSlug: subject.subjectSlug,
    subjectKey: subject.key,
    tier: paperIdentity.tier,
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
    const contextText = unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null;
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

  if (!skipAutoScore) {
    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    if (bundle) {
      const results = await autoScoreMathPaper(bundle);
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
          scorerModel: getServerEnvironment().OPENROUTER_MODEL,
          scoreStatus: "ai_suggested",
        });

        await upsertMarkingQuestionStatusInConvex({
          submissionId,
          questionKey: entry.questionKey,
          status: entry.result.needsReview ? "needs_manual_review" : "ai_scored",
        });
      }

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
  importKey: string;
  submissionId: string;
  renderedPages: Array<{ pageNumber: number; png: Buffer }>;
  textPages: Array<{ pageNumber: number; text: string }>;
  skipAutoScore: boolean;
}): Promise<ImportFinishedPaperResult> {
  const bundle = await getMarkingSubmissionBundleFromConvex(params.submissionId);
  if (!bundle?.submission.savedPaperId || !bundle.savedPaperQuestions?.length) {
    throw new DomainError("This submission needs a linked saved paper before a finished PDF can be attached.");
  }

  const unitKeys = bundle.savedPaperQuestions.map((question) => question.unitKey);
  const unitKeySet = new Set(unitKeys);
  const subject = getPaperMakerSubject(bundle.submission.subjectKey);
  if (!subject) throw new DomainError("This submission uses an unsupported subject.");
  const paperUnits = (await getMarkableUnitsForSubject(subject.key))
    .filter((unit) => unitKeySet.has(unit.unitKey));

  const bodyTextPages = filterBodyPages(params.textPages);
  const { pageOcrByNumber, pageImageByNumber } = await prepareImportedPages(
    params.importKey,
    params.file.name,
    params.renderedPages,
  );

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
  const unitByKey = new Map(paperUnits.map((entry) => [entry.unitKey, entry]));
  for (const savedQuestion of bundle.savedPaperQuestions) {
    const unit = unitByKey.get(savedQuestion.unitKey);
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
    const contextText = unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null;
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
  if (!params.skipAutoScore) {
    const refreshedBundle = await getMarkingSubmissionBundleFromConvex(params.submissionId);
    if (refreshedBundle) {
      const results = await autoScoreMathPaper(refreshedBundle);
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
          scorerModel: getServerEnvironment().OPENROUTER_MODEL,
          scoreStatus: "ai_suggested",
        });
        await upsertMarkingQuestionStatusInConvex({
          submissionId: params.submissionId,
          questionKey: entry.questionKey,
          status: entry.result.needsReview ? "needs_manual_review" : "ai_scored",
        });
      }
    }
  }

  return {
    submissionId: params.submissionId,
    savedPaperId: bundle.submission.savedPaperId ?? bundle.savedPaper?._id ?? "",
    detectedPaperIdentity: {
      subjectKey: subject.key,
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
