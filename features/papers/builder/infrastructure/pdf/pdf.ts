import { PDFDocument } from "pdf-lib";

import { getPdfDocument, renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import type { QuestionUnit, SourcePageAsset } from "@/shared/domain/paper";
import { drawGeneratedCoverPage, type GeneratedCoverModel } from "./cover";
import { prepareQuestionFragments } from "./question-fragments";
import { paintGeneratedLayout } from "./paint-generated-layout";
import { planGeneratedQuestions } from "../../domain/generated-layout";
import { createSourcePdfCache, fetchPdfBytes, rasterizeSourcePdfPage, type CropBox } from "./source-pdf";import {
  getExtractedPage,
  isAnswerLine,
  isSourceFooterFurnitureLine,
  shouldIgnorePageLine,
  type ExtractedPaperPage,
  type ExtractedTextLine,
} from "./source-text";
import {
  normalizeFigureLabel,
  type RegionFigure,
  type RegionPageLayout,
} from "../../domain/region-render";
import { isValidLocalCropBox } from "../../domain/crop-geometry";

type GeneratePaperPdfInput = {
  title: string;
  selectedUnits: QuestionUnit[];
  allUnits: QuestionUnit[];
  pageAssetsBySource: Map<string, SourcePageAsset[]>;
  prefaceSourcePdfs?: string[];
  figuresBySource?: Map<string, RegionFigure[]>;
  pageLayoutsBySource?: Map<string, RegionPageLayout[]>;
  coverPage: GeneratedCoverModel;
  timings?: PdfAssemblyTimings;
};

export type PdfAssemblyTimings = {
  documentSetupMs: number;
  prefaceImportMs: number;
  sourcePreparationMs: number;
  layoutPlanningMs: number;
  paintingMs: number;
  serializationMs: number;
  sourcePageRenderCount: number;
};

export class SourceUnitRenderError extends Error {
  readonly unitKeys: string[];
  readonly failures: Array<{ unitKey: string; page?: number; reason?: string }>;

  constructor(unitKeys: string[], failures: Array<{ unitKey: string; page?: number; reason?: string }> = []) {
    const uniqueUnitKeys = Array.from(new Set(unitKeys));
    super(`Paper generation could not render ${uniqueUnitKeys.length} selected unit(s): ${uniqueUnitKeys.slice(0, 5).join(", ")}`);
    this.name = "SourceUnitRenderError";
    this.unitKeys = uniqueUnitKeys;
    this.failures = failures;
  }
}

const CROP_PADDING = 12;
const MIN_VISIBLE_CROP_HEIGHT = 36;

export function resolveContentHorizontalBounds(cropBox: CropBox, contentBoxes: Array<{ left: number; right: number }>, padding = CROP_PADDING) {
  if (contentBoxes.length === 0) return cropBox;
  const left = Math.max(cropBox.left, Math.min(...contentBoxes.map((box) => box.left)) - padding);
  const right = Math.min(cropBox.right, Math.max(...contentBoxes.map((box) => box.right)) + padding);
  return right - left >= 80 ? { ...cropBox, left, right } : cropBox;
}

export function trimSourceFooterCropBox(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  if (unit.boardCode === "aqa") return cropBox;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) return cropBox;
  const footerLines = extractedPage.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top
    && line.bbox.y0 >= cropBox.bottom
    && line.bbox.y1 < cropBox.bottom + (cropBox.top - cropBox.bottom) * 0.35
    && isSourceFooterFurnitureLine(line.text)
  ));
  if (footerLines.length === 0) return cropBox;

  const bottom = Math.max(cropBox.bottom, Math.max(...footerLines.map((line) => line.bbox.y1)) + 12);
  return cropBox.top - bottom >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, bottom } : cropBox;
}

function normalizeTextForSearch(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function getPromptSearchTokens(promptText: string) {
  const cleaned = normalizeTextForSearch(
    promptText
      .replace(/^\s*(?:[0-9ivxlcdm]+\s*)+(?:\.\s*[0-9ivxlcdm]+)?\s*/i, "")
      .replace(/^\s*\([a-zivxlcdm0-9]+\)\s*/i, "")
      .replace(/\[[^\]]*\]/g, " "),
  );

  return cleaned
    .split(" ")
    .filter((token) => token.length >= 3)
    .slice(0, 10);
}

function findPromptLine(page: ExtractedPaperPage, promptText: string) {
  const tokens = getPromptSearchTokens(promptText);
  if (tokens.length === 0) return null;

  let bestLine: ExtractedTextLine | null = null;
  let bestScore = 0;

  for (const line of page.text_lines) {
    const searchable = normalizeTextForSearch(line.text);
    if (!searchable) continue;

    let score = 0;
    for (const token of tokens) {
      if (searchable.includes(token)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= Math.min(3, Math.max(1, Math.ceil(tokens.length / 3))) ? bestLine : null;
}

export function findMathUnitStartLine(page: ExtractedPaperPage, unit: QuestionUnit) {
  const part = unit.parts.find((entry) => entry.pageNumbers.includes(page.page_number)) ?? unit.parts[0];
  if (!part) return null;

  const relevantLines = page.text_lines.filter((line) => !shouldIgnorePageLine(line.text));
  const escapedQuestion = part.questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directQuestionLine = relevantLines.find((line) => {
    const trimmed = line.text.trim();
    if (!new RegExp(`^(?:0\\s*)?${escapedQuestion}\\b`, "i").test(trimmed)) return false;
    const remainder = trimmed.replace(new RegExp(`^(?:0\\s*)?${escapedQuestion}\\b`, "i"), "").trim();
    return /[A-Za-z(]/.test(remainder);
  });

  if (directQuestionLine) return directQuestionLine;

  if (part.questionPartNumber) {
    const escaped = part.questionPartNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directPartLine = relevantLines.find((line) => new RegExp(`^\\(\\s*${escaped}\\s*\\)`, "i").test(line.text.trim()));
    if (directPartLine) return directPartLine;
  }

  const standaloneQuestionLine = relevantLines.find((line) => new RegExp(`^(?:0\\s*)?${escapedQuestion}\\s*\\.?$`, "i").test(line.text.trim()));
  if (standaloneQuestionLine) return standaloneQuestionLine;

  return findPromptLine(page, part.promptText);
}

export function resolveMathHorizontalCropBounds(
  contentLines: Array<{ bbox: { x0: number; x1: number } }>,
  pageWidth: number,
  additionalBoxes: Array<{ left: number; right: number }> = [],
  padding = 16,
) {
  const xValues = [
    ...contentLines.flatMap((line) => [line.bbox.x0, line.bbox.x1]),
    ...additionalBoxes.flatMap((box) => [box.left, box.right]),
  ];
  const left = Math.max(0, Math.min(...xValues) - padding);
  const right = Math.min(pageWidth, Math.max(...xValues) + padding);
  const minimumWidth = Math.min(pageWidth, 280);
  const cropWidth = right - left;
  const horizontalExpansion = cropWidth >= minimumWidth ? 0 : (minimumWidth - cropWidth) / 2;
  return {
    left: Math.max(0, left - horizontalExpansion),
    right: Math.min(pageWidth, right + horizontalExpansion),
  };
}

function getNearestSiblingAbove(selectedBox: CropBox, siblingBoxes: CropBox[]) {
  return siblingBoxes
    .filter((sibling) => sibling.bottom >= selectedBox.top - 8)
    .sort((a, b) => a.bottom - b.bottom)[0] ?? null;
}

function getNearestSiblingBelow(selectedBox: CropBox, siblingBoxes: CropBox[]) {
  return siblingBoxes
    .filter((sibling) => sibling.top < selectedBox.bottom)
    .sort((a, b) => b.top - a.top)[0] ?? null;
}

function isScienceUnit(unit: Pick<QuestionUnit, "subjectSlug">) {
  return ["combined-science", "biology", "chemistry", "physics"].includes(unit.subjectSlug);
}

export function trimScienceRegionCropBox(unit: QuestionUnit, crop: { pageNumber: number; cropBox: CropBox; kind: string }) {
  if (!isScienceUnit(unit) || (crop.kind !== "stem" && crop.kind !== "figure" && crop.kind !== "question")) return crop.cropBox;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  if (!extractedPage) return crop.cropBox;
  let cropBox = crop.cropBox;

  const footerLines = extractedPage.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom
    && (isSourceFooterFurnitureLine(line.text) || /\bturn over\b|\bp\s*\d\s*\d\s*\d\s*\d\b/i.test(line.text))
  ));
  if (footerLines.length > 0) {
    const footerTop = Math.max(...footerLines.map((line) => line.bbox.y1)) + 10;
    if (footerTop < cropBox.top - MIN_VISIBLE_CROP_HEIGHT) cropBox = { ...cropBox, bottom: Math.max(cropBox.bottom, footerTop) };
  }

  if (crop.kind === "question") {
    return cropBox;
  }

  const questionNumberPattern = new RegExp(`^\\s*${unit.questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const questionStartLine = extractedPage.text_lines
    .filter((line) => line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom && questionNumberPattern.test(line.text.trim()))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;
  if (!questionStartLine) return cropBox;
  if (cropBox.top - questionStartLine.bbox.y1 < 80) return cropBox;

  return {
    ...cropBox,
    top: Math.min(cropBox.top, questionStartLine.bbox.y1 + 24),
  };
}

function isAnswerContinuationOnlyLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (/^[.\s_\-]+(?:\[?\d+\]?|\(?\d+\)?)?$/.test(normalized)) return true;
  if (/^\[?\d+\]?\s*$/.test(normalized)) return true;
  if (/^total for question\b/.test(normalized)) return true;
  if (/^question \d+ continues/.test(normalized)) return true;
  if (/^additional (?:answer )?space/.test(normalized)) return true;
  if (/^extra space for question\b/.test(normalized)) return true;
  if (/^extra space$/.test(normalized)) return true;
  if (/^end of section\b/.test(normalized)) return true;
  return false;
}

export function isOcrAdditionalAnswerPage(lines: string[]) {
  const copyrightStart = lines.findIndex((line) => /^(?:copyright information|ocr is committed\b)/i.test(line.trim()));
  const contentLines = copyrightStart >= 0
    ? lines.slice(0, copyrightStart)
    : lines;
  return contentLines.every((line) => {
    const text = line.trim();
    return !text
      || /^\(?\d+\)?$/.test(text)
      || /^\[\d+\]$/.test(text)
      || /^©\s*ocr/i.test(text)
      || /^oxford cambridge and rsa$/i.test(text)
      || /^[._\-\s]+$/.test(text)
      || isAnswerContinuationOnlyLine(text);
  });
}

export function shouldSanitizeSourcePageForGeneratedIdentity(unit: Pick<QuestionUnit, "boardCode" | "subjectSlug">) {
  return unit.subjectSlug === "mathematics"
    || unit.subjectSlug.startsWith("mathematics-")
    || ["combined-science", "biology", "chemistry", "physics"].includes(unit.subjectSlug)
    || (unit.boardCode === "aqa" && ["english-language", "english-literature"].includes(unit.subjectSlug))
    || (unit.boardCode === "edexcel" && unit.subjectSlug === "french")
    || unit.subjectSlug === "business";
}

export const BOXED_MARKER_SUBJECTS = new Set(["business", "geography", "english-literature", "english-language"]);

export function formatGeneratedAqaMarker(unit: Pick<QuestionUnit, "subjectSlug">, questionNumber: number, sourcePartNumber: string) {
  if (unit.subjectSlug === "english-literature" || unit.subjectSlug === "english-language") {
    return String(questionNumber).padStart(2, "0");
  }
  const subPart = sourcePartNumber.includes(".") ? sourcePartNumber.split(".").pop() : sourcePartNumber;
  return subPart ? `${String(questionNumber).padStart(2, "0")}.${subPart}` : String(questionNumber).padStart(2, "0");
}

function usesBoxedMarkers(unit: QuestionUnit) {
  return unit.boardCode === "aqa" && BOXED_MARKER_SUBJECTS.has(unit.subjectSlug);
}

export function subjectUsesBoxedMarkers(subjectKey: string) {
  const [board, ...rest] = subjectKey.split("-");
  return board === "aqa" && BOXED_MARKER_SUBJECTS.has(rest.join("-"));
}

function markerTextForPart(unit: QuestionUnit, questionNumber: number, partNumber: string | null) {
  if (!usesBoxedMarkers(unit)) return undefined;
  return formatGeneratedAqaMarker(unit, questionNumber, partNumber ?? "");
}

export function expandScienceCropToReferencedFigures(
  crop: CropBox,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  referencedFigureLabels: string[],
  figures: RegionFigure[],
  siblingBoxes: CropBox[],
) {
  const referenced = new Set(referencedFigureLabels.map(normalizeFigureLabel));
  const matchingFigures = figures.filter((figure) => {
    if (figure.pageNumber !== pageNumber || figure.yTop <= figure.yBottom) return false;
    return referenced.has(normalizeFigureLabel(figure.label));
  });
  if (matchingFigures.length === 0) return crop;

  const overlappingSiblings = siblingBoxes.filter((sibling) => sibling.left < crop.right && sibling.right > crop.left);
  const nearestAbove = getNearestSiblingAbove(crop, overlappingSiblings);
  const nearestBelow = getNearestSiblingBelow(crop, overlappingSiblings);
  const safeMargin = 8;
  const top = Math.min(
    pageHeight,
    nearestAbove ? nearestAbove.bottom - 10 : pageHeight,
    Math.max(crop.top, ...matchingFigures.map((figure) => figure.yTop + safeMargin)),
  );
  const bottom = Math.max(
    0,
    nearestBelow ? nearestBelow.top + 10 : 0,
    Math.min(crop.bottom, ...matchingFigures.map((figure) => figure.yBottom - safeMargin)),
  );

  const expanded = {
    left: Math.max(0, crop.left),
    right: Math.min(pageWidth, crop.right),
    bottom,
    top,
  } satisfies CropBox;

  return isValidCropBox(expanded, pageWidth, pageHeight) ? expanded : crop;
}

export function padScienceCropBox(crop: CropBox, pageWidth: number) {
  return {
    ...crop,
    left: Math.max(0, crop.left - 8),
    right: Math.min(pageWidth, crop.right + 8),
  };
}

export function getFooterFloor(page: ExtractedPaperPage, pageHeight: number, ceilingY?: number) {
  const footerRegionMaxY = Math.max(140, pageHeight * 0.28);
  const footerLines = page.text_lines.filter((line) => (
    !isAnswerLine(line.text)
    && isSourceFooterFurnitureLine(line.text)
    && line.bbox.y1 <= footerRegionMaxY
    && (ceilingY === undefined || line.bbox.y1 < ceilingY)
  ));

  return footerLines.length > 0
    ? Math.min(pageHeight - MIN_VISIBLE_CROP_HEIGHT, Math.max(...footerLines.map((line) => line.bbox.y1)) + 8)
    : 0;
}

function isValidCropBox(cropBox: CropBox, pageWidth: number, pageHeight: number) {
  return isValidLocalCropBox(cropBox, pageWidth, pageHeight, MIN_VISIBLE_CROP_HEIGHT);
}

function isSkippableInsertFillerPage(text: string) {
  return /\bthere is no source material printed on this page\b/i.test(text.replace(/\s+/g, " "));
}

async function getSkippableInsertPageIndexes(pdfBytes: Uint8Array) {
  try {
    const rendered = await renderPdfToPngBuffers(new Uint8Array(pdfBytes), 0.25);
    const skippablePageIndexes = new Set<number>();
    for (const page of rendered.textPages) {
      if (isSkippableInsertFillerPage(page.text)) skippablePageIndexes.add(page.pageNumber - 1);
    }
    if (skippablePageIndexes.size >= rendered.textPages.length) return new Set<number>();
    return skippablePageIndexes;
  } catch {
    return new Set<number>();
  }
}

async function addPdfPagesWithRasterFallback(
  outputDoc: PDFDocument,
  pdfPathOrUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
) {
  const bytes = await fetchPdfBytes(pdfPathOrUrl, sourcePdfCache);
  const [skippablePageIndexes, sourcePdf] = await Promise.all([
    getSkippableInsertPageIndexes(bytes),
    getPdfDocument(bytes.slice()),
  ]);
  const pageIndexes = Array.from({ length: sourcePdf.numPages }, (_, index) => index)
    .filter((index) => !skippablePageIndexes.has(index));
  for (const pageIndex of pageIndexes) {
    const raster = await rasterizeSourcePdfPage(pdfPathOrUrl, pageIndex, sourcePdfCache, sourceDocCache, {
      sanitizeFurniture: true,
    });
    const sourcePage = raster.sourcePdfPage;
    const { width, height } = sourcePage.getCropBox();
    const embeddedPage = await outputDoc.embedPage(sourcePage);
    const outputPage = outputDoc.addPage([width, height]);
    outputPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });
  }
  return pageIndexes.length > 0;
}

export function extendComputerScienceAnswerGeometryCropBox(
  cropBox: CropBox,
  ownedBottom: number,
  pageMarks: number,
  requiresAnswerGeometry: boolean,
  lines: ExtractedTextLine[],
) {
  if (!requiresAnswerGeometry || pageMarks < 4 || ownedBottom >= cropBox.bottom) return cropBox;
  const bottom = Math.max(0, ownedBottom);
  const hasFollowingContent = lines.some((line) => (
    line.bbox.y1 < cropBox.bottom - 4
    && line.bbox.y0 > bottom + 24
    && !shouldIgnorePageLine(line.text)
    && !isSourceFooterFurnitureLine(line.text)
    && !/^(?:pmt|©?\s*ocr\b)/i.test(line.text.trim())
  ));
  return hasFollowingContent ? cropBox : { ...cropBox, bottom };
}

export async function generateStrictSourcePaperPdf({ title, selectedUnits, allUnits, pageAssetsBySource, prefaceSourcePdfs = [], coverPage, figuresBySource, pageLayoutsBySource, timings }: GeneratePaperPdfInput) {
  let stageStartedAt = performance.now();
  const outputDoc = await PDFDocument.create({ updateMetadata: false });
  outputDoc.setTitle(title);
  await drawGeneratedCoverPage(outputDoc, coverPage);
  if (timings) timings.documentSetupMs += performance.now() - stageStartedAt;

  const orderedUnits = Array.from(new Map(selectedUnits.map((unit) => [unit.unitKey, unit])).values());
  if (orderedUnits.length !== selectedUnits.length) throw new Error("Paper generation received duplicate selected units.");

  const sourcePdfCache = new Map<string, Uint8Array>();
  const sourceDocCache = new Map<string, PDFDocument>();
  const sourceCache = createSourcePdfCache();
  stageStartedAt = performance.now();
  for (const prefacePdfPath of Array.from(new Set(prefaceSourcePdfs))) {
    try {
      await addPdfPagesWithRasterFallback(outputDoc, prefacePdfPath, sourcePdfCache, sourceDocCache);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load preface source PDF "${prefacePdfPath}": ${reason}`, { cause: error });
    }
  }
  if (timings) timings.prefaceImportMs += performance.now() - stageStartedAt;

  const generatedNumberBySource = new Map(
    orderedUnits.map((unit, index) => [`${unit.sourceRelativePath}#${Number(unit.questionNumber)}`, index + 1] as const),
  );
  const prepared = [] as Array<{
    unit: QuestionUnit;
    fragments: Awaited<ReturnType<typeof prepareQuestionFragments>> & { kind: "success" };
  }>;
  const failures: Array<{ unitKey: string; page?: number; reason?: string }> = [];
  stageStartedAt = performance.now();
  for (const unit of orderedUnits) {
    const result = await prepareQuestionFragments({
      unit,
      allUnits,
      pageAssetsBySource,
      figures: figuresBySource?.get(unit.sourceRelativePath) ?? [],
      pageLayouts: pageLayoutsBySource?.get(unit.sourceRelativePath) ?? [],
      sourceCache,
      maskPartMarkers: usesBoxedMarkers(unit),
    });
    if (result.kind === "unrenderable") {
      failures.push({ unitKey: result.unitKey, page: result.page, reason: result.reason });
    } else {
      prepared.push({ unit, fragments: result });
    }
  }
  if (timings) {
    timings.sourcePreparationMs += performance.now() - stageStartedAt;
    timings.sourcePageRenderCount += sourceCache.sourcePages.size;
  }
  if (failures.length > 0) {
    throw new SourceUnitRenderError(failures.map((failure) => failure.unitKey), failures);
  }

  stageStartedAt = performance.now();
  const questions = prepared.map(({ unit, fragments }, index) => {
    const questionNumber = index + 1;
    for (const fragment of fragments.fragments) {
      for (const marker of fragment.markers ?? []) {
        marker.text = markerTextForPart(unit, questionNumber, marker.partNumber);
      }
      for (const ref of fragment.crossRefs ?? []) {
        ref.generatedNumber = generatedNumberBySource.get(`${unit.sourceRelativePath}#${Number(ref.sourceNumber)}`);
      }
    }
    return {
      unitKey: unit.unitKey,
      number: questionNumber,
      fragments: fragments.fragments,
      afterPage: unit.subjectSlug === "english-literature" ? { kind: "answer-space" as const, marks: unit.totalMarks } : undefined,
      footer: unit.subjectSlug === "mathematics" ? {
        text: `(Total for Question ${questionNumber} is ${unit.totalMarks} ${unit.totalMarks === 1 ? "mark" : "marks"})`,
      } : undefined,
    };
  });
  const plan = planGeneratedQuestions({ questions });
  if (plan.kind === "unrenderable") {
    throw new SourceUnitRenderError([plan.unitKey], [{ unitKey: plan.unitKey, reason: plan.reason }]);
  }
  if (timings) timings.layoutPlanningMs += performance.now() - stageStartedAt;

  const sources = new Map<string, import("./question-fragments").PreparedFragmentSource>();
  for (const entry of prepared) {
    for (const [fragmentId, source] of entry.fragments.sources) sources.set(fragmentId, source);
  }
  stageStartedAt = performance.now();
  await paintGeneratedLayout(outputDoc, plan.blocks, sources, {
    totalMarks: orderedUnits.reduce((total, unit) => total + unit.totalMarks, 0),
    endLabel: orderedUnits[0]?.boardCode === "aqa" ? "END OF QUESTIONS" : "END",
    showPaperTotal: orderedUnits[0]?.boardCode === "edexcel",
  });
  if (timings) timings.paintingMs += performance.now() - stageStartedAt;
  stageStartedAt = performance.now();
  const bytes = await outputDoc.save();
  if (timings) timings.serializationMs += performance.now() - stageStartedAt;
  return bytes;
}
