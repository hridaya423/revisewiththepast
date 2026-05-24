import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { PDFDocument, rgb } from "pdf-lib";

import type { BoundingBox, QuestionUnit, SourcePageAsset } from "@/lib/paper-maker/aqa-geography";

type GeneratePaperPdfInput = {
  title: string;
  selectedUnits: QuestionUnit[];
  allUnits: QuestionUnit[];
  pageAssetsBySource: Map<string, SourcePageAsset[]>;
  prefaceSourcePdfs?: string[];
  coverPage: {
    boardLabel: string;
    subjectLabel: string;
    codeLabel: string;
    totalMarks: number;
    timeMinutes: number;
    paperLabels: string[];
    tierLabel?: string | null;
  };
};

type CropBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

type ExtractedTextLine = {
  text: string;
  y: number;
  bbox: BoundingBox;
};

type ExtractedPaperPage = {
  page_number: number;
  page_text: string;
  text_lines: ExtractedTextLine[];
};

type ExtractedPaper = {
  source_file: string;
  pages: ExtractedPaperPage[];
};

type PreparedSnippet = Awaited<ReturnType<typeof prepareSnippet>>;

type ShortPageItem = {
  pageWidth: number;
  pageHeight: number;
  snippets: PreparedSnippet[];
  scale: number;
  scaledHeight: number;
};

type VisiblePageGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SourcePdfCandidate = {
  pdfUrl: string;
  sourcePageIndex: number;
};

const CROP_PADDING = 12;
const ANSWER_LAYOUT_TOP_PADDING = 60;
const SHORT_PAGE_TOP_MARGIN = 48;
const SHORT_PAGE_SIDE_MARGIN = 40;
const SHORT_PAGE_GAP = 18;
const MAX_SHORT_SNIPPET_PAGE_RATIO = 0.52;
const MAX_SHORT_SNIPPET_WITH_FIGURE_PAGE_RATIO = 0.78;
const MAX_SHORT_SNIPPET_PAGE_RATIO_SCIENCE = 0.68;
const MAX_SHORT_SNIPPET_WITH_FIGURE_PAGE_RATIO_SCIENCE = 0.88;
const MIN_COMPOSED_SNIPPET_SCALE = 0.72;
const MIN_VISIBLE_CROP_HEIGHT = 36;
const LARGE_CROP_PAGE_RATIO = 0.9;
const STANDARD_PAGE_TOP_MARGIN = 24;
const SHORT_PAGE_BOTTOM_MARGIN = 48;
const MATH_OUTPUT_PAGE_WIDTH = 595.28;
const MATH_OUTPUT_PAGE_HEIGHT = 841.89;

const SUPPORT_CONTEXT_PATTERN = /\bfigure\b|\bstudy\b|\bmap\b|\bdiagram\b|\bgraph\b|\bphoto\b|\bresource\b|\bapparatus\b|\btable\b|\bchart\b|\bmodel\b|\bspectrum\b|\bresults\b/i;

const PAGE_SKIP_PATTERNS = [
  /there are no questions printed on this page/i,
  /additional page, if required/i,
];

const LINE_IGNORE_PATTERNS = [
  /^\d+$/,
  /^\(\d+\)$/,
  /^\*\d+\*$/,
  /^g\/[a-z]{3}\d+/i,
  /^ib\/g\/[a-z]{3}\d+/i,
  /^question \d+ continues on the next page/i,
  /^turn over(?: for the next question)?$/i,
  /^end of questions$/i,
  /^there are no questions printed on this page$/i,
  /^do not write on this page$/i,
  /^answer in the spaces provided$/i,
  /^additional page, if required\.?$/i,
  /^write the question numbers in the left-hand margin\.?$/i,
  /^copyright information$/i,
  /^do not write in this area$/i,
  /^shaded area$/i,
  /^do not write outside the box$/i,
  /^total for question/i,
  /^total for paper/i,
  /^pmt$/i,
];

const FULL_PAGE_ANSWER_EXTENSION_BY_MARKS = [
  { maxMarks: 1, padding: 70 },
  { maxMarks: 2, padding: 105 },
  { maxMarks: 3, padding: 140 },
  { maxMarks: 6, padding: 210 },
  { maxMarks: 9, padding: 280 },
];

const extractedPaperCache = new Map<string, ExtractedPaper | null>();
const TEMP_PDF_SPLIT_DIR = "/var/folders/w9/p_fpb3_x05n45_bt9_3wp5hw0000gn/T/opencode/pdf-split";
const TEMP_PDF_NORMALIZE_DIR = "/var/folders/w9/p_fpb3_x05n45_bt9_3wp5hw0000gn/T/opencode/pdf-normalized";

function formatExamTime(timeMinutes: number) {
  const hours = Math.floor(timeMinutes / 60);
  const minutes = timeMinutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minutes`;
}

function drawExamCoverPage(
  outputDoc: PDFDocument,
  coverPage: GeneratePaperPdfInput["coverPage"],
) {
  const page = outputDoc.addPage([595, 842]);
  const black = rgb(0.1, 0.1, 0.1);
  const midGrey = rgb(0.42, 0.42, 0.42);
  const lightGrey = rgb(0.82, 0.82, 0.82);
  const panelGrey = rgb(0.96, 0.96, 0.96);

  page.drawRectangle({ x: 34, y: 34, width: 527, height: 774, borderWidth: 1.2, borderColor: black });
  page.drawRectangle({ x: 34, y: 734, width: 527, height: 74, color: panelGrey, borderWidth: 1.2, borderColor: black });

  page.drawText("GCSE", { x: 50, y: 775, size: 22, color: black });
  page.drawText("Revise with the Past", { x: 430, y: 775, size: 10.5, color: midGrey });
  page.drawText(coverPage.boardLabel.toUpperCase(), { x: 50, y: 748, size: 12, color: black });
  page.drawText(coverPage.subjectLabel.toUpperCase(), { x: 50, y: 694, size: 26, color: black });
  page.drawText("Custom examination paper assembled from real past-paper pages", { x: 50, y: 668, size: 11, color: midGrey });
  page.drawText(`Paper reference: ${coverPage.codeLabel}`, { x: 50, y: 632, size: 11, color: black });
  if (coverPage.tierLabel) {
    page.drawText(`Tier: ${coverPage.tierLabel}`, { x: 220, y: 632, size: 11, color: black });
  }

  page.drawRectangle({ x: 50, y: 564, width: 495, height: 56, borderWidth: 1, borderColor: lightGrey });
  page.drawLine({ start: { x: 220, y: 564 }, end: { x: 220, y: 620 }, thickness: 1, color: lightGrey });
  page.drawLine({ start: { x: 370, y: 564 }, end: { x: 370, y: 620 }, thickness: 1, color: lightGrey });
  page.drawText("Time allowed", { x: 62, y: 592, size: 9, color: midGrey });
  page.drawText("Total marks", { x: 232, y: 592, size: 9, color: midGrey });
  page.drawText("Built with Revise with the Past", { x: 382, y: 592, size: 9, color: midGrey });
  page.drawText(formatExamTime(coverPage.timeMinutes), { x: 62, y: 574, size: 13, color: black });
  page.drawText(String(coverPage.totalMarks), { x: 232, y: 574, size: 13, color: black });
  page.drawText("Real source pages only", { x: 382, y: 574, size: 11, color: black });

  page.drawRectangle({ x: 50, y: 478, width: 495, height: 54, borderWidth: 1, borderColor: lightGrey });
  page.drawText("Student name", { x: 62, y: 510, size: 10, color: midGrey });
  page.drawLine({ start: { x: 62, y: 496 }, end: { x: 533, y: 496 }, thickness: 0.9, color: lightGrey });

  page.drawText("Materials", { x: 50, y: 446, size: 13, color: black });
  page.drawRectangle({ x: 50, y: 362, width: 495, height: 68, borderWidth: 1, borderColor: lightGrey });
  page.drawText("• Source pages are included inside this paper.", { x: 62, y: 404, size: 10.5, color: black });
  page.drawText("• You may need a calculator or ruler depending on the questions selected.", { x: 62, y: 386, size: 10.5, color: black });
  page.drawText("• Use black ink or black ball-point pen.", { x: 62, y: 368, size: 10.5, color: black });

  page.drawText("Instructions", { x: 50, y: 332, size: 13, color: black });
  page.drawRectangle({ x: 50, y: 222, width: 495, height: 92, borderWidth: 1, borderColor: lightGrey });
  const instructions = [
    "Answer all questions in the spaces provided.",
    "This paper has been assembled from real source pages.",
    "If you need extra space, continue your answer clearly and label it.",
    "Check the marks for each question before you begin.",
  ];
  let instructionY = 290;
  for (const line of instructions) {
    page.drawText(`• ${line}`, { x: 62, y: instructionY, size: 10.5, color: black });
    instructionY -= 18;
  }

  page.drawText("Source papers used", { x: 50, y: 194, size: 13, color: black });
  let listY = 168;
  for (const label of coverPage.paperLabels) {
    page.drawText(`• ${label}`, { x: 62, y: listY, size: 10.5, color: black });
    listY -= 18;
  }
}

function toCropBox(bbox: BoundingBox): CropBox {
  return {
    left: bbox.x0,
    right: bbox.x1,
    bottom: bbox.y0,
    top: bbox.y1,
  };
}

function expandCropBox(cropBox: CropBox, width: number, height: number, padding = CROP_PADDING): CropBox {
  return {
    left: Math.max(0, cropBox.left - padding),
    right: Math.min(width, cropBox.right + padding),
    bottom: Math.max(0, cropBox.bottom - padding),
    top: Math.min(height, cropBox.top + padding),
  };
}

function deriveExtractedPaperJsonPath(sourceRelativePath: string) {
  const normalizedPath = sourceRelativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const boardCode = segments[0] ?? "";
  const subjectSlug = segments[1] ?? "";
  const extraDirs = segments.slice(2, -1).filter((segment) => segment !== "none");
  const fileName = segments.at(-1) ?? normalizedPath;
  const paperDirName = fileName.replace(/\.pdf$/i, "");
  return resolve(process.cwd(), "data/extracted", boardCode, subjectSlug, ...extraDirs, paperDirName, "paper.json");
}

function loadExtractedPaper(sourceRelativePath: string) {
  if (extractedPaperCache.has(sourceRelativePath)) {
    return extractedPaperCache.get(sourceRelativePath) ?? null;
  }

  const filePath = deriveExtractedPaperJsonPath(sourceRelativePath);
  if (!existsSync(filePath)) {
    extractedPaperCache.set(sourceRelativePath, null);
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ExtractedPaper;
    extractedPaperCache.set(sourceRelativePath, parsed);
    return parsed;
  } catch {
    extractedPaperCache.set(sourceRelativePath, null);
    return null;
  }
}

function getExtractedPage(sourceRelativePath: string, pageNumber: number) {
  const paper = loadExtractedPaper(sourceRelativePath);
  return paper?.pages.find((page) => page.page_number === pageNumber) ?? null;
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

function shouldIgnorePageLine(text: string) {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^[_\s]+$/.test(normalized)) return true;
  if (/^[.\s]+$/.test(normalized)) return true;
  return LINE_IGNORE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBoilerplateOnlyPage(page: ExtractedPaperPage) {
  const normalized = normalizeTextForSearch(page.page_text);
  return PAGE_SKIP_PATTERNS.some((pattern) => pattern.test(normalized));
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

function findMathUnitStartLine(page: ExtractedPaperPage, unit: QuestionUnit) {
  const part = unit.parts[0];
  if (!part) return null;

  const relevantLines = page.text_lines.filter((line) => !shouldIgnorePageLine(line.text));
  if (part.questionPartNumber) {
    const escaped = part.questionPartNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directPartLine = relevantLines.find((line) => new RegExp(`^\(\s*${escaped}\s*\)`, "i").test(line.text.trim()));
    if (directPartLine) return directPartLine;
  }

  const escapedQuestion = part.questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directQuestionLine = relevantLines.find((line) => {
    const trimmed = line.text.trim();
    if (!new RegExp(`^(?:0\s*)?${escapedQuestion}\b`, "i").test(trimmed)) return false;
    const remainder = trimmed.replace(new RegExp(`^(?:0\s*)?${escapedQuestion}\b`, "i"), "").trim();
    return /[A-Za-z(]/.test(remainder);
  });
  if (directQuestionLine) return directQuestionLine;

  return findPromptLine(page, part.promptText);
}

function isMathContextBoundaryLine(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^\([a-z]\)/i.test(trimmed)) return true;
  if (/^\(\d+\)$/.test(trimmed)) return true;
  if (/^(?:0\s*)?\d+\b/.test(trimmed)) return true;
  if (/\.{5,}/.test(trimmed)) return true;
  if (/=\s*\.{5,}/.test(trimmed)) return true;
  return false;
}

function getImmediateMathContextLinesAbove(page: ExtractedPaperPage, startLine: ExtractedTextLine) {
  const aboveLines = page.text_lines
    .filter((line) => line.bbox.y0 >= startLine.bbox.y1 - 4)
    .filter((line) => line.bbox.y1 <= startLine.bbox.y1 + 180)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0);

  const selected: ExtractedTextLine[] = [];
  for (const line of aboveLines) {
    if (shouldIgnorePageLine(line.text)) continue;
    if (isMathContextBoundaryLine(line.text)) break;
    selected.push(line);
  }

  return selected;
}

function getMathAnswerPadding(totalMarks: number) {
  if (totalMarks <= 1) return 24;
  if (totalMarks === 2) return 32;
  if (totalMarks === 3) return 42;
  if (totalMarks === 4) return 54;
  if (totalMarks === 5) return 68;
  return 90;
}

function getMathSupportUnit(targetUnit: QuestionUnit, allUnits: QuestionUnit[]) {
  const currentPart = targetUnit.parts[0];
  if (!isMathematicsUnit(targetUnit) || !currentPart?.questionPartNumber) return null;
  if (!/part\s*\([a-z]\)|your answer to part|this graph|this equation|this table|this shape|the graph|the equation/i.test(currentPart.promptText)) {
    return null;
  }

  const relatedUnits = allUnits
    .filter((unit) => unit.sourceQuestionKey === targetUnit.sourceQuestionKey)
    .sort((left, right) => {
      const leftPage = left.pages[0]?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      const rightPage = right.pages[0]?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftPage !== rightPage) return leftPage - rightPage;
      const leftPart = left.parts[0]?.questionPartNumber ?? "";
      const rightPart = right.parts[0]?.questionPartNumber ?? "";
      return leftPart.localeCompare(rightPart, undefined, { numeric: true });
    });
  const currentIndex = relatedUnits.findIndex((unit) => unit.unitKey === targetUnit.unitKey);
  return currentIndex > 0 ? relatedUnits[currentIndex - 1] : null;
}

function resolveMathQuestionCropBox(
  unit: QuestionUnit,
  allUnits: QuestionUnit[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  unitStartPages: Map<string, QuestionUnit[]>,
) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  const matchingUnitPage = unit.pages.find((entry) => entry.pageNumber === pageNumber);
  if (!extractedPage || !matchingUnitPage) {
    return null;
  }

  const supportUnit = getMathSupportUnit(unit, allUnits);
  const supportPage = supportUnit?.pages.find((entry) => entry.pageNumber === pageNumber) ?? null;
  const supportBox = supportPage?.bboxUnion ? toCropBox(supportPage.bboxUnion) : null;

  const relevantLines = extractedPage.text_lines
    .filter((line) => !shouldIgnorePageLine(line.text))
    .filter((line) => !/^\(total for question/i.test(line.text.trim()))
    .filter((line) => !/^total for paper/i.test(line.text.trim()));
  if (relevantLines.length === 0) {
    return null;
  }

  const startLine = findMathUnitStartLine(extractedPage, unit);
  if (!startLine) {
    return null;
  }

  const immediateContextLines = supportBox ? [] : getImmediateMathContextLinesAbove(extractedPage, startLine);
  const immediateContextTop = immediateContextLines.length > 0
    ? Math.max(...immediateContextLines.map((line) => line.bbox.y1))
    : null;

  const excludedUnitKeys = new Set([unit.unitKey, ...matchingUnitPage.parts.map((part) => part.partKey)]);
  const siblingStartLines = (unitStartPages.get(`${unit.sourceRelativePath}::${pageNumber}`) ?? [])
    .filter((entry) => !excludedUnitKeys.has(entry.unitKey))
    .map((entry) => findMathUnitStartLine(extractedPage, entry))
    .filter((line): line is ExtractedTextLine => line !== null)
    .sort((a, b) => b.bbox.y1 - a.bbox.y1);
  const nextSiblingLine = siblingStartLines.find((line) => line.bbox.y1 < startLine.bbox.y0 - 4) ?? null;

  const topCeiling = Math.min(
    pageHeight,
    supportBox
      ? Math.max(startLine.bbox.y1 + 72, supportBox.top)
      : (immediateContextTop ? immediateContextTop + 18 : startLine.bbox.y1 + 56),
  );
  const bottomFloor = nextSiblingLine ? nextSiblingLine.bbox.y1 : 0;
  const regionLines = relevantLines.filter((line) => line.bbox.y0 < topCeiling && line.bbox.y1 > bottomFloor);
  if (regionLines.length === 0) {
    return null;
  }

  const highestTextY = Math.max(...regionLines.map((line) => line.bbox.y1));
  const lowestTextY = Math.min(...regionLines.map((line) => line.bbox.y0));
  const footerFloor = getFooterFloor(extractedPage, pageHeight, lowestTextY);
  const bottom = nextSiblingLine
    ? Math.max(footerFloor, nextSiblingLine.bbox.y1 + 24, lowestTextY - getMathAnswerPadding(unit.totalMarks))
    : Math.max(footerFloor, lowestTextY - getMathAnswerPadding(unit.totalMarks));

  const cropTop = supportBox?.top
    ? supportBox.top + 18
    : immediateContextTop
      ? immediateContextTop + 18
      : Math.max(startLine.bbox.y1 + 24, highestTextY + 12);

  const cropBox = {
    left: 0,
    right: pageWidth,
    bottom,
    top: Math.min(pageHeight, cropTop),
  } satisfies CropBox;

  return isValidCropBox(cropBox, pageWidth, pageHeight) ? cropBox : null;
}

function getFullPageAnswerExtension(totalMarks: number) {
  for (const entry of FULL_PAGE_ANSWER_EXTENSION_BY_MARKS) {
    if (totalMarks <= entry.maxMarks) return entry.padding;
  }
  return 340;
}

function buildUnitStartPageMap(units: QuestionUnit[]) {
  const map = new Map<string, QuestionUnit[]>();
  for (const unit of units) {
    const startPageNumber = unit.pages[0]?.pageNumber;
    if (!startPageNumber) continue;
    const key = `${unit.sourceRelativePath}::${startPageNumber}`;
    const entries = map.get(key) ?? [];
    entries.push(unit);
    map.set(key, entries);
  }
  return map;
}

function getSiblingBoxesForPage(targetUnit: QuestionUnit, allUnits: QuestionUnit[], pageNumber: number): CropBox[] {
  const siblings: CropBox[] = [];
  for (const unit of allUnits) {
    if (unit.unitKey === targetUnit.unitKey || unit.sourceRelativePath !== targetUnit.sourceRelativePath) continue;
    const page = unit.pages.find((entry) => entry.pageNumber === pageNumber);
    if (!page?.bboxUnion) continue;
    siblings.push(toCropBox(page.bboxUnion));
  }
  return siblings;
}

function getPageAssetUrlForPage(unit: QuestionUnit, pageNumber: number) {
  for (const part of unit.parts) {
    const pageAsset = part.pageAssetCdnUrls.find((entry) => entry.pageNumber === pageNumber && entry.cdnUrl);
    if (pageAsset?.cdnUrl) return pageAsset.cdnUrl;
  }
  return null;
}

function deriveDownloadedSourcePdfPath(sourceRelativePath: string) {
  const normalizedPath = sourceRelativePath.replaceAll("\\", "/");
  return resolve(process.cwd(), "data/downloads", normalizedPath);
}

function deriveDownloadedInsertPdfPaths(unit: QuestionUnit) {
  if (!isEnglishLanguageUnit(unit)) return [];

  const downloadsDir = resolve(process.cwd(), "data/downloads", unit.boardCode, unit.subjectSlug, "none");
  if (!existsSync(downloadsDir)) return [];

  const sessionNeedle = (unit.session ?? "").toLowerCase();
  const paperNeedle = unit.paperCode.toLowerCase();
  const yearNeedle = unit.year ? String(unit.year) : "";

  return readdirSync(downloadsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .filter((fileName) => fileName.toLowerCase().includes("insert"))
    .filter((fileName) => (yearNeedle ? fileName.includes(yearNeedle) : true))
    .filter((fileName) => fileName.toLowerCase().includes(paperNeedle))
    .filter((fileName) => (sessionNeedle ? fileName.toLowerCase().includes(sessionNeedle) : true))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => resolve(downloadsDir, fileName));
}

function deriveDownloadedPageAssetPath(relativePath: string) {
  const normalizedPath = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  return resolve(process.cwd(), "data/downloads", normalizedPath);
}

function deriveExtractedPageAssetPdfPath(sourceRelativePath: string, pageNumber: number) {
  const normalizedPath = sourceRelativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const boardCode = segments[0] ?? "";
  const subjectSlug = segments[1] ?? "";
  const extraDirs = segments.slice(2, -1).filter((segment) => segment !== "none");
  const fileName = segments.at(-1) ?? normalizedPath;
  const paperDirName = fileName.replace(/\.pdf$/i, "");
  const pageFileName = `page-${String(pageNumber).padStart(3, "0")}.pdf`;
  return resolve(process.cwd(), "data/extracted", boardCode, subjectSlug, ...extraDirs, paperDirName, "assets", pageFileName);
}

function resolveSourcePdfForPage(
  unit: QuestionUnit,
  pageNumber: number,
  pageAssetsBySource: Map<string, SourcePageAsset[]>,
) {
  const pageAsset = (pageAssetsBySource.get(unit.sourceRelativePath) ?? []).find((asset) => asset.pageNumber === pageNumber);
  if (pageAsset?.cdnUrl) {
    return {
      pdfUrl: pageAsset.cdnUrl,
      sourcePageIndex: 0,
    };
  }

  const embeddedPageAssetUrl = getPageAssetUrlForPage(unit, pageNumber);
  if (embeddedPageAssetUrl) {
    return {
      pdfUrl: embeddedPageAssetUrl,
      sourcePageIndex: 0,
    };
  }

  if (unit.questionPaperCdnUrl) {
    return {
      pdfUrl: unit.questionPaperCdnUrl,
      sourcePageIndex: Math.max(0, pageNumber - 1),
    };
  }

  return null;
}

function getSourcePdfCandidatesForPage(
  unit: QuestionUnit,
  pageNumber: number,
  pageAssetsBySource: Map<string, SourcePageAsset[]>,
) {
  const originalCandidates: SourcePdfCandidate[] = [];
  const extractedCandidates: SourcePdfCandidate[] = [];

  const extractedPageAssetPdfPath = deriveExtractedPageAssetPdfPath(unit.sourceRelativePath, pageNumber);
  if (existsSync(extractedPageAssetPdfPath)) {
    extractedCandidates.push({
      pdfUrl: extractedPageAssetPdfPath,
      sourcePageIndex: 0,
    });
  }

  const pageAsset = (pageAssetsBySource.get(unit.sourceRelativePath) ?? []).find((asset) => asset.pageNumber === pageNumber);
  if (pageAsset?.relativePath) {
    const localPageAssetPath = deriveDownloadedPageAssetPath(pageAsset.relativePath);
    if (existsSync(localPageAssetPath)) {
      extractedCandidates.push({
        pdfUrl: localPageAssetPath,
        sourcePageIndex: 0,
      });
    }
  }

  const localSourcePdfPath = deriveDownloadedSourcePdfPath(unit.sourceRelativePath);
  if (existsSync(localSourcePdfPath)) {
    originalCandidates.push({
      pdfUrl: localSourcePdfPath,
      sourcePageIndex: Math.max(0, pageNumber - 1),
    });
  }

  const primary = resolveSourcePdfForPage(unit, pageNumber, pageAssetsBySource);
  if (primary) {
    if (primary.sourcePageIndex === 0 && primary.pdfUrl !== unit.questionPaperCdnUrl) {
      extractedCandidates.push(primary);
    } else {
      originalCandidates.push(primary);
    }
  }

  if (unit.questionPaperCdnUrl) {
    originalCandidates.push({
      pdfUrl: unit.questionPaperCdnUrl,
      sourcePageIndex: Math.max(0, pageNumber - 1),
    });
  }

  const candidates = isMathematicsUnit(unit)
    ? [...originalCandidates, ...extractedCandidates]
    : [...extractedCandidates, ...originalCandidates];

  return Array.from(
    new Map(candidates.map((candidate) => [`${candidate.pdfUrl}::${candidate.sourcePageIndex}`, candidate])).values(),
  );
}

function getVisiblePageGeometry(sourcePdfPage: import("pdf-lib").PDFPage): VisiblePageGeometry {
  const cropBox = sourcePdfPage.getCropBox();
  return {
    x: cropBox.x,
    y: cropBox.y,
    width: cropBox.width,
    height: cropBox.height,
  };
}

function toPdfCropBox(cropBox: CropBox, geometry: VisiblePageGeometry): CropBox {
  return {
    left: geometry.x + cropBox.left,
    right: geometry.x + cropBox.right,
    bottom: geometry.y + cropBox.bottom,
    top: geometry.y + cropBox.top,
  } satisfies CropBox;
}

function clearSourcePdfCandidateCaches(
  candidate: SourcePdfCandidate,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
) {
  sourceDocCache.delete(candidate.pdfUrl);
  sourcePdfCache.delete(candidate.pdfUrl);
}

function hasSiblingBelow(selectedBox: CropBox, siblingBoxes: CropBox[]) {
  return siblingBoxes.some((sibling) => sibling.top <= selectedBox.bottom + 8);
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

function hasFigureContext(unit: QuestionUnit) {
  const searchable = `${unit.parts.map((part) => part.promptText).join(" ")} ${unit.parts.map((part) => part.contextText ?? "").join(" ")}`.toLowerCase();
  return SUPPORT_CONTEXT_PATTERN.test(searchable);
}

function hasSupportDependency(unit: QuestionUnit) {
  const searchable = `${unit.parts.map((part) => part.promptText).join(" ")} ${unit.parts.map((part) => part.contextText ?? "").join(" ")}`.toLowerCase();
  return SUPPORT_CONTEXT_PATTERN.test(searchable)
    || /\bthis\s+(?:investigation|method|results|data|graph|table|diagram|figure)\b/.test(searchable)
    || /\bthese\s+(?:results|data)\b/.test(searchable)
    || /\busing evidence from\b/.test(searchable)
    || /\buse information from\b/.test(searchable);
}

function isCombinedScienceUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "combined-science";
}

function isBusinessUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "business";
}

function isMathematicsUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "mathematics";
}

function isEnglishLanguageUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "english-language";
}

function getReferencedFigureNumbers(unit: QuestionUnit) {
  const searchable = `${unit.parts.map((part) => part.promptText).join(" ")} ${unit.parts.map((part) => part.contextText ?? "").join(" ")}`;
  const matches = Array.from(searchable.matchAll(/\bfigure\s+(\d+)\b/gi));
  return Array.from(new Set(matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value))));
}

function isLikelyQuestionInstructionLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (/^(?:0\s*)?\d+\s*\.\s*\d+/.test(normalized)) return true;
  if (/\[\+?\s*\d+\s*(?:spag\s*)?marks?\]/i.test(text)) return true;
  return /\b(using|use|state|describe|explain|suggest|give|calculate|which|what|name|compare|complete|outline|discuss|assess|evaluate|write|tick|shade)\b/.test(normalized);
}

function isReferencedFigureLabelLine(text: string, figureNumber: number) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (isLikelyQuestionInstructionLine(normalized)) return false;

  const figurePattern = new RegExp(`^figure\\s+${figureNumber}(?:\\b|[.:\u2013\u2014-])`, "i");
  const studyFigurePattern = new RegExp(`^study\\s+figure\\s+${figureNumber}(?:\\b|[.:\u2013\u2014-])`, "i");
  return figurePattern.test(normalized) || studyFigurePattern.test(normalized);
}

function pageContainsReferencedFigure(page: ExtractedPaperPage | null, figureNumbers: number[]) {
  if (!page || figureNumbers.length === 0) return false;
  return page.text_lines.some((line) => {
    return figureNumbers.some((figureNumber) => isReferencedFigureLabelLine(line.text, figureNumber));
  });
}

function getReferencedFigureLines(page: ExtractedPaperPage, figureNumbers: number[]) {
  if (figureNumbers.length === 0) return [];

  return page.text_lines.filter((line) => {
    return figureNumbers.some((figureNumber) => isReferencedFigureLabelLine(line.text, figureNumber));
  });
}

function pageContainsSupportContext(page: ExtractedPaperPage | null) {
  if (!page) return false;
  return page.text_lines.some((line) => !shouldIgnorePageLine(line.text) && SUPPORT_CONTEXT_PATTERN.test(line.text));
}

function getFooterFloor(page: ExtractedPaperPage, pageHeight: number, ceilingY?: number) {
  const footerRegionMaxY = Math.max(140, pageHeight * 0.28);
  const footerLines = page.text_lines
    .filter((line) => shouldIgnorePageLine(line.text))
    .filter((line) => line.bbox.y1 <= footerRegionMaxY)
    .filter((line) => ceilingY === undefined || line.bbox.y1 < ceilingY);

  return footerLines.length > 0
    ? Math.min(pageHeight - MIN_VISIBLE_CROP_HEIGHT, Math.max(...footerLines.map((line) => line.bbox.y1)) + 8)
    : 0;
}

function resolveFigureSupportTopOnPage(
  unit: QuestionUnit,
  page: ExtractedPaperPage,
  questionBoundaryTop: number,
  ceilingTop: number,
) {
  if (ceilingTop <= questionBoundaryTop + 8) {
    return null;
  }

  const figureNumbers = getReferencedFigureNumbers(unit);
  const exactFigureLines = getReferencedFigureLines(page, figureNumbers)
    .filter((line) => line.bbox.y0 >= questionBoundaryTop - 12)
    .filter((line) => line.bbox.y1 <= ceilingTop + 4);

  const candidateLines = exactFigureLines.length > 0
    ? exactFigureLines
    : page.text_lines
      .filter((line) => !shouldIgnorePageLine(line.text))
      .filter((line) => SUPPORT_CONTEXT_PATTERN.test(line.text))
      .filter((line) => line.bbox.y0 >= questionBoundaryTop - 12)
      .filter((line) => line.bbox.y1 <= ceilingTop + 4);

  if (candidateLines.length === 0) {
    return null;
  }

  const supportTop = Math.max(...candidateLines.map((line) => line.bbox.y1)) + 18;
  return Math.min(ceilingTop, Math.max(questionBoundaryTop + 24, supportTop));
}

function resolveSamePageFigureSupportTop(
  unit: QuestionUnit,
  pageNumber: number,
  pageHeight: number,
  selectedBox: CropBox,
  siblingBoxes: CropBox[],
) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) {
    return null;
  }

  const nearestAbove = getNearestSiblingAbove(selectedBox, siblingBoxes);
  const ceilingTop = nearestAbove ? Math.min(pageHeight, nearestAbove.bottom - 10) : pageHeight;
  return resolveFigureSupportTopOnPage(unit, extractedPage, selectedBox.top, ceilingTop);
}

function resolveSamePageFigureSupportCropBox(
  unit: QuestionUnit,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  selectedBox: CropBox,
  siblingBoxes: CropBox[],
) {
  const supportTop = resolveSamePageFigureSupportTop(unit, pageNumber, pageHeight, selectedBox, siblingBoxes);
  if (supportTop === null) {
    return null;
  }

  const cropBox = {
    left: 0,
    right: pageWidth,
    bottom: Math.min(pageHeight - 4, selectedBox.top + 8),
    top: supportTop,
  } satisfies CropBox;

  return isValidCropBox(cropBox, pageWidth, pageHeight) ? cropBox : null;
}

function resolvePreviousPageFigureSupportCropBox(
  unit: QuestionUnit,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) {
    return null;
  }

  const figureNumbers = getReferencedFigureNumbers(unit);
  const hasReferencedFigure = getReferencedFigureLines(extractedPage, figureNumbers).length > 0;
  if (!hasReferencedFigure && !pageContainsSupportContext(extractedPage)) {
    return null;
  }

  const cropBox = {
    left: 0,
    right: pageWidth,
    bottom: getFooterFloor(extractedPage, pageHeight),
    top: pageHeight,
  } satisfies CropBox;

  return isValidCropBox(cropBox, pageWidth, pageHeight) ? cropBox : null;
}

function shouldUseAnswerLayout(unit: QuestionUnit) {
  if (isMathematicsUnit(unit)) {
    return false;
  }

  return unit.totalMarks >= 4;
}

function determineRenderPageNumbers(unit: QuestionUnit, unitStartPages: Map<string, QuestionUnit[]>) {
  const rawPageNumbers = Array.from(new Set(unit.pages.map((page) => page.pageNumber))).sort((a, b) => a - b);
  const figureNumbers = getReferencedFigureNumbers(unit);
  const firstPageNumber = rawPageNumbers[0];
  const actualFirstPageNumber = unit.pages[0]?.pageNumber;

  if (isEnglishLanguageUnit(unit)) {
    return actualFirstPageNumber ? [actualFirstPageNumber] : (firstPageNumber ? [firstPageNumber] : []);
  }

  if (isMathematicsUnit(unit) && actualFirstPageNumber) {
    return rawPageNumbers.filter((pageNumber) => pageNumber === actualFirstPageNumber || unit.totalMarks > 5);
  }

  if (firstPageNumber && hasSupportDependency(unit)) {
    const firstPage = getExtractedPage(unit.sourceRelativePath, firstPageNumber);
    const previousPageNumber = firstPageNumber - 1;
    const previousPage = previousPageNumber > 0 ? getExtractedPage(unit.sourceRelativePath, previousPageNumber) : null;
    const firstPageHasReferencedFigure = pageContainsReferencedFigure(firstPage, figureNumbers);
    const previousPageHasReferencedFigure = pageContainsReferencedFigure(previousPage, figureNumbers);
    const firstPageHasSupport = figureNumbers.length > 0
      ? firstPageHasReferencedFigure
      : pageContainsSupportContext(firstPage);
    const previousPageHasSupport = figureNumbers.length > 0
      ? previousPageHasReferencedFigure
      : pageContainsSupportContext(previousPage);

    if (!firstPageHasSupport && previousPageHasSupport) {
      rawPageNumbers.unshift(previousPageNumber);
    }
  }

  if (isCombinedScienceUnit(unit) && firstPageNumber > 1) {
    const previousPageNumber = firstPageNumber - 1;
    const hasPreviousPageAlready = rawPageNumbers.includes(previousPageNumber);
    const partCode = (unit.parts[0]?.questionPartNumber ?? "").trim().toLowerCase();
    const isLikelyDependentSubPart = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|b|c|d|e|f|g|h)$/.test(partCode);

    if (!hasPreviousPageAlready && isLikelyDependentSubPart) {
      const firstPage = getExtractedPage(unit.sourceRelativePath, firstPageNumber);
      const previousPage = getExtractedPage(unit.sourceRelativePath, previousPageNumber);
      const firstPageHasSupport = pageContainsSupportContext(firstPage);
      const previousPageHasSupport = pageContainsSupportContext(previousPage);

      if (!firstPageHasSupport && previousPageHasSupport) {
        rawPageNumbers.unshift(previousPageNumber);
      }
    }
  }

  return rawPageNumbers.filter((pageNumber, index) => {
    if (index === 0) return true;
    if (actualFirstPageNumber && pageNumber === actualFirstPageNumber) return true;

    const page = getExtractedPage(unit.sourceRelativePath, pageNumber);
    if (page && isBoilerplateOnlyPage(page)) return false;

    const pageStarters = unitStartPages.get(`${unit.sourceRelativePath}::${pageNumber}`) ?? [];
    return pageStarters.every((entry) => entry.unitKey === unit.unitKey);
  });
}

function buildShortQuestionCropBox(pageWidth: number, pageHeight: number, selectedBox: CropBox, siblingBoxes: CropBox[], marks: number, includeFigureAbove: boolean, isMaths = false) {
  const answerExtension = isMaths
    ? (marks <= 1
      ? 70
      : marks === 2
        ? 95
        : marks === 3
          ? 120
          : marks === 4
            ? 150
            : 180)
    : (marks <= 1
      ? 140
      : marks === 2
        ? 190
        : marks === 3
          ? 240
          : marks === 4
            ? 290
            : 340);
  const nearestBelow = getNearestSiblingBelow(selectedBox, siblingBoxes);
  const nearestAbove = includeFigureAbove ? getNearestSiblingAbove(selectedBox, siblingBoxes) : null;
  const bottom = nearestBelow
    ? Math.max(nearestBelow.top + 10, selectedBox.bottom - answerExtension)
    : Math.max(0, selectedBox.bottom - answerExtension);
  const top = includeFigureAbove
    ? Math.max(
      Math.min(pageHeight, selectedBox.top + 28),
      nearestAbove ? Math.min(pageHeight, nearestAbove.bottom - 10) : pageHeight,
    )
    : Math.min(pageHeight, selectedBox.top + 28);

  return {
    left: 0,
    right: pageWidth,
    bottom,
    top,
  };
}

function buildShortQuestionCropBoxWithSupportTop(
  pageWidth: number,
  pageHeight: number,
  selectedBox: CropBox,
  siblingBoxes: CropBox[],
  marks: number,
  supportTop: number | null,
) {
  const baseCrop = buildShortQuestionCropBox(pageWidth, pageHeight, selectedBox, siblingBoxes, marks, false);
  if (supportTop === null) {
    return baseCrop;
  }

  return {
    ...baseCrop,
    top: Math.max(baseCrop.top, supportTop),
  } satisfies CropBox;
}

function shouldPackShortSnippet(unit: QuestionUnit, pageHeight: number, cropBox: CropBox, includeFigureAbove: boolean) {
  const snippetHeight = cropBox.top - cropBox.bottom;
  const isScience = isCombinedScienceUnit(unit);
  const isMaths = isMathematicsUnit(unit);
  if (isMaths) {
    return snippetHeight <= pageHeight * (includeFigureAbove ? 0.82 : 0.72);
  }
  const maxRatio = includeFigureAbove
    ? (isScience ? MAX_SHORT_SNIPPET_WITH_FIGURE_PAGE_RATIO_SCIENCE : MAX_SHORT_SNIPPET_WITH_FIGURE_PAGE_RATIO)
    : (isScience ? MAX_SHORT_SNIPPET_PAGE_RATIO_SCIENCE : MAX_SHORT_SNIPPET_PAGE_RATIO);
  return snippetHeight <= pageHeight * maxRatio;
}

function shouldAttemptCompactLayout(unit: QuestionUnit) {
  if (isCombinedScienceUnit(unit) || isBusinessUnit(unit)) {
    return false;
  }

  if (isMathematicsUnit(unit)) {
    return unit.totalMarks <= 5;
  }

  return unit.totalMarks <= 3;
}

async function prepareSnippet(
  outputDoc: PDFDocument,
  pageAssetUrl: string,
  cropBox: CropBox,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  sourcePageIndex = 0,
) {
  const sourceDoc = await loadSourcePdfDocument(pageAssetUrl, sourcePdfCache, sourceDocCache);

  const workingDoc = await PDFDocument.create();
  const [workingPage] = await workingDoc.copyPages(sourceDoc, [sourcePageIndex]);
  const embeddedPage = await outputDoc.embedPage(workingPage, cropBox);
  return {
    embeddedPage,
    width: cropBox.right - cropBox.left,
    height: cropBox.top - cropBox.bottom,
  };
}

function buildShortPageItem(
  pageWidth: number,
  pageHeight: number,
  snippets: PreparedSnippet[],
  allowDownscale: boolean,
) {
  if (snippets.length === 0) {
    return null;
  }

  const availableWidth = pageWidth - SHORT_PAGE_SIDE_MARGIN * 2;
  const availableHeight = pageHeight - SHORT_PAGE_TOP_MARGIN - SHORT_PAGE_BOTTOM_MARGIN;
  const naturalWidth = Math.max(...snippets.map((snippet) => snippet.width));
  const naturalHeight = snippets.reduce((sum, snippet) => sum + snippet.height, 0) + SHORT_PAGE_GAP * (snippets.length - 1);

  let scale = Math.min(1, availableWidth / Math.max(1, naturalWidth));
  if (naturalHeight * scale > availableHeight) {
    if (!allowDownscale) {
      return null;
    }

    scale = Math.min(scale, availableHeight / Math.max(1, naturalHeight));
  }

  if (allowDownscale && scale < MIN_COMPOSED_SNIPPET_SCALE) {
    return null;
  }

  return {
    pageWidth,
    pageHeight,
    snippets,
    scale,
    scaledHeight: naturalHeight * scale,
  } satisfies ShortPageItem;
}

function drawShortPageItem(page: import("pdf-lib").PDFPage, item: ShortPageItem, cursorTop: number) {
  let snippetTop = cursorTop;
  for (const snippet of item.snippets) {
    const scaledWidth = snippet.width * item.scale;
    const scaledHeight = snippet.height * item.scale;
    page.drawPage(snippet.embeddedPage, {
      x: SHORT_PAGE_SIDE_MARGIN,
      y: snippetTop - scaledHeight,
      width: scaledWidth,
      height: scaledHeight,
    });
    snippetTop -= scaledHeight + SHORT_PAGE_GAP;
  }
}

function buildRenderPageOccupancyMap(units: QuestionUnit[], renderPageNumbersByUnit: Map<string, number[]>) {
  const map = new Map<string, number>();
  for (const unit of units) {
    const renderPageNumbers = renderPageNumbersByUnit.get(unit.unitKey) ?? [];
    for (const pageNumber of renderPageNumbers) {
      const key = `${unit.sourceRelativePath}::${pageNumber}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

function getPageOccupancyCount(pageOccupancy: Map<string, number>, sourceRelativePath: string, pageNumber: number) {
  return pageOccupancy.get(`${sourceRelativePath}::${pageNumber}`) ?? 0;
}

function isValidCropBox(cropBox: CropBox, pageWidth: number, pageHeight: number) {
  return cropBox.left >= 0
    && cropBox.bottom >= 0
    && cropBox.right <= pageWidth
    && cropBox.top <= pageHeight
    && cropBox.right - cropBox.left > 1
    && cropBox.top - cropBox.bottom >= MIN_VISIBLE_CROP_HEIGHT;
}

function isLargeCrop(pageHeight: number, cropBox: CropBox) {
  return (cropBox.top - cropBox.bottom) >= pageHeight * LARGE_CROP_PAGE_RATIO;
}

function isFullPageCrop(cropBox: CropBox, pageWidth: number, pageHeight: number) {
  return cropBox.left <= 0
    && cropBox.bottom <= 0
    && cropBox.right >= pageWidth
    && cropBox.top >= pageHeight;
}

function resolveFullPageTextCropBox(
  unit: QuestionUnit,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  unitStartPages: Map<string, QuestionUnit[]>,
  options?: {
    includeFigureSupport?: boolean;
  },
) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage || extractedPage.text_lines.length === 0) {
    return null;
  }

  if (pageNumber > (unit.pages[0]?.pageNumber ?? pageNumber) && unit.totalMarks <= 3) {
    return null;
  }

  if (isBoilerplateOnlyPage(extractedPage)) {
    return null;
  }

  const relevantLines = extractedPage.text_lines.filter((line) => !shouldIgnorePageLine(line.text));
  if (relevantLines.length === 0) {
    return null;
  }

  const promptLine = findPromptLine(extractedPage, unit.parts[0]?.promptText ?? "");
  const pageStartNumber = unit.pages[0]?.pageNumber ?? pageNumber;
  const isContinuationPage = pageNumber > pageStartNumber;
  if (!promptLine && isContinuationPage && unit.totalMarks <= 6) {
    return null;
  }

  const starterUnits = (unitStartPages.get(`${unit.sourceRelativePath}::${pageNumber}`) ?? [])
    .filter((entry) => entry.unitKey !== unit.unitKey);
  const siblingPromptLines = starterUnits
    .map((entry) => findPromptLine(extractedPage, entry.parts[0]?.promptText ?? ""))
    .filter((line): line is ExtractedTextLine => line !== null)
    .sort((a, b) => b.bbox.y1 - a.bbox.y1);

  const nextSiblingLine = promptLine
    ? siblingPromptLines.find((line) => line.bbox.y1 < promptLine.bbox.y0 - 4) ?? null
    : siblingPromptLines[0] ?? null;
  const figureNumbers = getReferencedFigureNumbers(unit);
  const hasReferencedFigureOnPage = pageContainsReferencedFigure(extractedPage, figureNumbers);
  const footerFloor = getFooterFloor(extractedPage, pageHeight, promptLine?.bbox.y0);

  const regionLines = relevantLines.filter((line) => {
    if (promptLine && line.bbox.y1 > promptLine.bbox.y1 + 180) return false;
    if (nextSiblingLine && line.bbox.y0 < nextSiblingLine.bbox.y1) return false;
    return true;
  });

  const lowestTextY = regionLines.length > 0
    ? Math.min(...regionLines.map((line) => line.bbox.y0))
    : promptLine?.bbox.y0 ?? Math.min(...relevantLines.map((line) => line.bbox.y0));

  let top = promptLine
    ? Math.min(pageHeight, promptLine.bbox.y1 + 18)
    : Math.min(pageHeight, Math.max(...relevantLines.map((line) => line.bbox.y1)) + 12);

  if (promptLine) {
    const contextAbove = relevantLines.filter((line) =>
      line.bbox.y0 >= promptLine.bbox.y1
      && line.bbox.y1 <= pageHeight,
    );
    if (contextAbove.length > 0) {
      top = Math.min(pageHeight, Math.max(...contextAbove.map((line) => line.bbox.y1)) + 12);
    }
    if (options?.includeFigureSupport !== false && hasFigureContext(unit)) {
      const figureSupportTop = resolveFigureSupportTopOnPage(unit, extractedPage, promptLine.bbox.y1, pageHeight);
      if (figureSupportTop !== null) {
        top = Math.max(top, figureSupportTop);
      } else if (hasReferencedFigureOnPage || contextAbove.some((line) => SUPPORT_CONTEXT_PATTERN.test(line.text))) {
        top = pageHeight;
      }
    }
  }

  const answerExtension = getFullPageAnswerExtension(unit.totalMarks);
  const bottomFromText = Math.max(0, lowestTextY - answerExtension);
  let bottom = bottomFromText;
  if (isContinuationPage && !promptLine) {
    bottom = footerFloor;
  } else if (unit.totalMarks > 3 && !nextSiblingLine) {
    bottom = footerFloor;
  } else {
    if (nextSiblingLine) {
      bottom = Math.max(bottom, nextSiblingLine.bbox.y1 + 10);
    }
    bottom = Math.max(bottom, footerFloor);
  }

  const cropBox = {
    left: 0,
    right: pageWidth,
    bottom,
    top,
  } satisfies CropBox;

  return isValidCropBox(cropBox, pageWidth, pageHeight) ? cropBox : null;
}

function resolveStandardCropBox(
  unit: QuestionUnit,
  allUnits: QuestionUnit[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  selectedBox: CropBox | null,
  siblingBoxes: CropBox[],
  isFirstRenderPage: boolean,
  answerLayout: boolean,
  pageOccupancyCount: number,
  unitStartPages: Map<string, QuestionUnit[]>,
) {
  const isFullPageSource = unit.parts.some((part) => part.sourceMode === "full_page");
  if (isMathematicsUnit(unit)) {
    const mathsCrop = resolveMathQuestionCropBox(unit, allUnits, pageNumber, pageWidth, pageHeight, unitStartPages);
    if (mathsCrop && isValidCropBox(mathsCrop, pageWidth, pageHeight)) {
      return mathsCrop;
    }

    const textCrop = resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages, { includeFigureSupport: false });
    if (textCrop && isValidCropBox(textCrop, pageWidth, pageHeight)) {
      return textCrop;
    }

    if (selectedBox) {
      const mathsCrop = expandCropBox(selectedBox, pageWidth, pageHeight, 6);
      if (isValidCropBox(mathsCrop, pageWidth, pageHeight)) {
        return mathsCrop;
      }
    }

    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (isBusinessUnit(unit) || isEnglishLanguageUnit(unit)) {
    const textCrop = resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages, { includeFigureSupport: false });
    if (textCrop && isValidCropBox(textCrop, pageWidth, pageHeight)) {
      return textCrop;
    }
  }

  if (isFullPageSource) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (isCombinedScienceUnit(unit)) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (!selectedBox) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (answerLayout && isFirstRenderPage && !hasSiblingBelow(selectedBox, siblingBoxes)) {
    const includeFigureAbove = hasFigureContext(unit);
    const supportTop = includeFigureAbove
      ? resolveSamePageFigureSupportTop(unit, pageNumber, pageHeight, selectedBox, siblingBoxes)
      : null;
    const cropBox = {
      left: 0,
      right: pageWidth,
      bottom: 0,
      top: includeFigureAbove
        ? supportTop ?? pageHeight
        : Math.min(pageHeight, selectedBox.top + ANSWER_LAYOUT_TOP_PADDING),
    };

    if (isValidCropBox(cropBox, pageWidth, pageHeight)) {
      return cropBox;
    }
  }

  if (answerLayout && !isFirstRenderPage) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  const includeFigureAbove = hasFigureContext(unit) && isFirstRenderPage;
  const supportTop = includeFigureAbove
    ? resolveSamePageFigureSupportTop(unit, pageNumber, pageHeight, selectedBox, siblingBoxes)
    : null;
  const preferredCrop = includeFigureAbove
    ? buildShortQuestionCropBoxWithSupportTop(pageWidth, pageHeight, selectedBox, siblingBoxes, Math.max(unit.totalMarks, 3), supportTop)
    : expandCropBox(selectedBox, pageWidth, pageHeight);

  if (pageOccupancyCount <= 1 && !isLargeCrop(pageHeight, preferredCrop) && isValidCropBox(preferredCrop, pageWidth, pageHeight)) {
    return preferredCrop;
  }

  const safeExpandedCrop = expandCropBox(selectedBox, pageWidth, pageHeight, 8);
  if (isValidCropBox(safeExpandedCrop, pageWidth, pageHeight)) {
    return safeExpandedCrop;
  }

  return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
}

async function fetchPdfBytes(url: string, cache: Map<string, Uint8Array>) {
  const cached = cache.get(url);
  if (cached) return cached;

  const isRemote = /^https?:\/\//i.test(url);
  const bytes = isRemote
    ? await (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch source PDF: ${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    })()
    : new Uint8Array(readFileSync(url));

  cache.set(url, bytes);
  return bytes;
}

async function loadSourcePdfDocument(
  pageAssetUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
) {
  let sourceDoc = sourceDocCache.get(pageAssetUrl);
  if (sourceDoc) {
    return sourceDoc;
  }

  const sourceBytes = await fetchPdfBytes(pageAssetUrl, sourcePdfCache);
  try {
    sourceDoc = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
  } catch {
    sourceDoc = await loadNormalizedPdfDocumentWithQpdf(pageAssetUrl, sourceBytes);
  }
  sourceDocCache.set(pageAssetUrl, sourceDoc);
  return sourceDoc;
}

async function loadNormalizedPdfDocumentWithQpdf(cacheKey: string, sourceBytes: Uint8Array) {
  execFileSync("mkdir", ["-p", TEMP_PDF_NORMALIZE_DIR]);
  const baseName = Buffer.from(cacheKey).toString("base64url");
  const inputPath = resolve(TEMP_PDF_NORMALIZE_DIR, `${baseName}.input.pdf`);
  const outputPath = resolve(TEMP_PDF_NORMALIZE_DIR, `${baseName}.normalized.pdf`);
  execFileSync("/bin/sh", ["-lc", `rm -f \"${inputPath}\" \"${outputPath}\"`]);
  writeFileSync(inputPath, Buffer.from(sourceBytes));
  execFileSync("qpdf", [inputPath, outputPath]);
  const normalizedBytes = new Uint8Array(readFileSync(outputPath));
  return await PDFDocument.load(normalizedBytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
}

async function copyLocalPdfPagesWithQpdfFallback(outputDoc: PDFDocument, filePath: string) {
  const pageCount = Number(execFileSync("qpdf", ["--show-npages", filePath], { encoding: "utf8" }).trim());
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    throw new Error(`Unable to determine page count for ${filePath}`);
  }

  execFileSync("mkdir", ["-p", TEMP_PDF_SPLIT_DIR]);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const splitPath = resolve(TEMP_PDF_SPLIT_DIR, `${Buffer.from(filePath).toString("base64url")}-${pageIndex + 1}.pdf`);
    execFileSync("qpdf", ["--empty", "--pages", filePath, String(pageIndex + 1), "--", splitPath]);
    const splitDocBytes = new Uint8Array(readFileSync(splitPath));
    const splitDoc = await PDFDocument.load(splitDocBytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    const [copiedPage] = await outputDoc.copyPages(splitDoc, [0]);
    outputDoc.addPage(copiedPage);
  }
}

async function withSourcePdfCandidate<T>(
  unit: QuestionUnit,
  pageNumber: number,
  pageAssetsBySource: Map<string, SourcePageAsset[]>,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  attempt: (
    candidate: SourcePdfCandidate,
    sourceDoc: PDFDocument,
    sourcePdfPage: import("pdf-lib").PDFPage,
  ) => Promise<T>,
) {
  const candidates = getSourcePdfCandidatesForPage(unit, pageNumber, pageAssetsBySource);
  if (candidates.length === 0) {
    return null;
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const sourceDoc = await loadSourcePdfDocument(candidate.pdfUrl, sourcePdfCache, sourceDocCache);
      const sourcePdfPage = sourceDoc.getPage(candidate.sourcePageIndex);
      return await attempt(candidate, sourceDoc, sourcePdfPage);
    } catch (error) {
      lastError = error;
      clearSourcePdfCandidateCaches(candidate, sourcePdfCache, sourceDocCache);
    }
  }

  throw new Error(
    `No usable source PDF found for ${unit.unitKey} page ${pageNumber}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function generateStrictSourcePaperPdf({ title, selectedUnits, allUnits, pageAssetsBySource, prefaceSourcePdfs = [], coverPage }: GeneratePaperPdfInput) {
  const outputDoc = await PDFDocument.create();
  outputDoc.setTitle(title);
  drawExamCoverPage(outputDoc, coverPage);

  const orderedUnits = Array.from(
    new Map(selectedUnits.map((unit) => [unit.sourceQuestionKey, unit])).values(),
  ).sort((a, b) => {
    if (a.totalMarks !== b.totalMarks) return a.totalMarks - b.totalMarks;
    if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
    if (a.questionNumber !== b.questionNumber) return a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true });
    return (a.year ?? 0) - (b.year ?? 0);
  });

  const sourcePdfCache = new Map<string, Uint8Array>();
  const sourceDocCache = new Map<string, PDFDocument>();
  const prependedInsertBySource = new Set<string>();

  for (const prefacePdfPath of Array.from(new Set(prefaceSourcePdfs))) {
    try {
      const insertDoc = await loadSourcePdfDocument(prefacePdfPath, sourcePdfCache, sourceDocCache);
      const pageIndexes = Array.from({ length: insertDoc.getPageCount() }, (_, index) => index);
      const copiedPages = await outputDoc.copyPages(insertDoc, pageIndexes);
      for (const copiedPage of copiedPages) {
        outputDoc.addPage(copiedPage);
      }
    } catch {
      await copyLocalPdfPagesWithQpdfFallback(outputDoc, prefacePdfPath);
    }
  }

  const unitStartPages = buildUnitStartPageMap(allUnits);
  const renderPageNumbersByUnit = new Map(
    orderedUnits.map((unit) => [unit.unitKey, determineRenderPageNumbers(unit, unitStartPages)]),
  );
  const selectedPageOccupancy = buildRenderPageOccupancyMap(orderedUnits, renderPageNumbersByUnit);
  const shortUnits = orderedUnits.filter(shouldAttemptCompactLayout);
  const standardUnits = orderedUnits.filter((unit) => !shouldAttemptCompactLayout(unit));

  if (shortUnits.length > 0) {
    let currentPage: import("pdf-lib").PDFPage | null = null;
    let currentPageWidth = 595;
    let currentPageHeight = 842;
    let cursorTop = 0;

    for (const unit of shortUnits) {
      const renderPageNumbers = renderPageNumbersByUnit.get(unit.unitKey) ?? [];
      let shortPageItem: ShortPageItem | null = null;

      if (renderPageNumbers.length !== 1) {
        standardUnits.push(unit);
        continue;
      }

      if (!shortPageItem) {
        const pageNumber = renderPageNumbers[0] ?? unit.pages[0]?.pageNumber;
        const unitPage = unit.pages.find((page) => page.pageNumber === pageNumber) ?? unit.pages[0];
        if (!unitPage || !pageNumber) {
          standardUnits.push(unit);
          continue;
        }

        shortPageItem = await withSourcePdfCandidate(
          unit,
          pageNumber,
          pageAssetsBySource,
          sourcePdfCache,
          sourceDocCache,
          async (sourcePage, _sourceDoc, sourcePdfPage) => {
            const pageGeometry = getVisiblePageGeometry(sourcePdfPage);
            const pageWidth = pageGeometry.width;
            const pageHeight = pageGeometry.height;
            const siblingBoxes = getSiblingBoxesForPage(unit, allUnits, pageNumber);
            const includeFigureAbove = hasFigureContext(unit);
            const isFullPageSource = unit.parts.some((part) => part.sourceMode === "full_page");
            const isMaths = isMathematicsUnit(unit);
            const selectedBox = unitPage.bboxUnion ? toCropBox(unitPage.bboxUnion) : null;
            let candidateItem: ShortPageItem | null = null;
            const targetPageWidth = isMaths ? MATH_OUTPUT_PAGE_WIDTH : pageGeometry.width;
            const targetPageHeight = isMaths ? MATH_OUTPUT_PAGE_HEIGHT : pageGeometry.height;
            const mathsCropBox = isMaths
              ? resolveMathQuestionCropBox(unit, allUnits, pageNumber, pageWidth, pageHeight, unitStartPages)
              : null;

            if (includeFigureAbove && selectedBox) {
              const supportCrop = resolveSamePageFigureSupportCropBox(unit, pageNumber, pageWidth, pageHeight, selectedBox, siblingBoxes);
              const questionCrop = isFullPageSource
                ? resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages, { includeFigureSupport: false })
                : buildShortQuestionCropBox(pageWidth, pageHeight, selectedBox, siblingBoxes, unit.totalMarks, false, isMaths);

              if (supportCrop && questionCrop && isValidCropBox(questionCrop, pageWidth, pageHeight)) {
                const probeDoc = await PDFDocument.create();
                await prepareSnippet(probeDoc, sourcePage.pdfUrl, toPdfCropBox(supportCrop, pageGeometry), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                await prepareSnippet(probeDoc, sourcePage.pdfUrl, toPdfCropBox(questionCrop, pageGeometry), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                await probeDoc.save();
                const supportSnippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, toPdfCropBox(supportCrop, pageGeometry), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                const questionSnippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, toPdfCropBox(questionCrop, pageGeometry), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                candidateItem = buildShortPageItem(targetPageWidth, targetPageHeight, [supportSnippet, questionSnippet], true);
              }
            }

            if (candidateItem) {
              return candidateItem;
            }

            const supportTop = includeFigureAbove && selectedBox
              ? resolveSamePageFigureSupportTop(unit, pageNumber, pageHeight, selectedBox, siblingBoxes)
              : null;
            const cropBox = mathsCropBox ?? (isFullPageSource
              ? resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages)
              : selectedBox
                ? buildShortQuestionCropBoxWithSupportTop(pageWidth, pageHeight, selectedBox, siblingBoxes, unit.totalMarks, supportTop)
                : null);

            if (
              !cropBox
              || !isValidCropBox(cropBox, pageWidth, pageHeight)
              || !shouldPackShortSnippet(unit, pageHeight, cropBox, includeFigureAbove)
            ) {
              return null;
            }

            const probeDoc = await PDFDocument.create();
            const pdfCropBox = toPdfCropBox(cropBox, pageGeometry);
            await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            await probeDoc.save();
            const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            return buildShortPageItem(targetPageWidth, targetPageHeight, [snippet], false);
          },
        );

        if (!shortPageItem) {
          standardUnits.push(unit);
          continue;
        }
      }

      if (!shortPageItem) {
        standardUnits.push(unit);
        continue;
      }

      if (!currentPage || cursorTop - shortPageItem.scaledHeight < SHORT_PAGE_BOTTOM_MARGIN) {
        currentPageWidth = shortPageItem.pageWidth;
        currentPageHeight = shortPageItem.pageHeight;
        currentPage = outputDoc.addPage([currentPageWidth, currentPageHeight]);
        cursorTop = currentPageHeight - SHORT_PAGE_TOP_MARGIN;
      }

      drawShortPageItem(currentPage, shortPageItem, cursorTop);
      cursorTop -= shortPageItem.scaledHeight + SHORT_PAGE_GAP;
    }
  }

  for (const unit of standardUnits) {
    const renderPageNumbers = renderPageNumbersByUnit.get(unit.unitKey) ?? [];
    if (renderPageNumbers.length === 0) continue;
    const firstPageNumber = unit.pages[0]?.pageNumber ?? renderPageNumbers[0];

    if (isEnglishLanguageUnit(unit) && prefaceSourcePdfs.length === 0 && !prependedInsertBySource.has(unit.sourceRelativePath)) {
      for (const insertPdfPath of deriveDownloadedInsertPdfPaths(unit)) {
        try {
          const insertDoc = await loadSourcePdfDocument(insertPdfPath, sourcePdfCache, sourceDocCache);
          const pageIndexes = Array.from({ length: insertDoc.getPageCount() }, (_, index) => index);
          const copiedPages = await outputDoc.copyPages(insertDoc, pageIndexes);
          for (const copiedPage of copiedPages) {
            outputDoc.addPage(copiedPage);
          }
        } catch {
          await copyLocalPdfPagesWithQpdfFallback(outputDoc, insertPdfPath);
        }
      }
      prependedInsertBySource.add(unit.sourceRelativePath);
    }

    for (const pageNumber of renderPageNumbers) {
      const rendered = await withSourcePdfCandidate(
        unit,
        pageNumber,
        pageAssetsBySource,
        sourcePdfCache,
        sourceDocCache,
        async (sourcePage, sourceDoc, sourcePdfPage) => {
          const pageGeometry = getVisiblePageGeometry(sourcePdfPage);
          const pageWidth = pageGeometry.width;
          const pageHeight = pageGeometry.height;
          const isMaths = isMathematicsUnit(unit);
          const targetPageWidth = isMaths ? MATH_OUTPUT_PAGE_WIDTH : pageWidth;
          const targetPageHeight = isMaths ? MATH_OUTPUT_PAGE_HEIGHT : pageHeight;
          const matchingUnitPage = unit.pages.find((entry) => entry.pageNumber === pageNumber) ?? null;
          const siblingBoxes = getSiblingBoxesForPage(unit, allUnits, pageNumber);
          const selectedBox = matchingUnitPage?.bboxUnion ? toCropBox(matchingUnitPage.bboxUnion) : null;
          const isFirstRenderPage = pageNumber === firstPageNumber;
          const answerLayout = shouldUseAnswerLayout(unit);
          const pageOccupancyCount = getPageOccupancyCount(selectedPageOccupancy, unit.sourceRelativePath, pageNumber);
          const cropBox = resolveStandardCropBox(
            unit,
            allUnits,
            pageNumber,
            pageWidth,
            pageHeight,
            selectedBox,
            siblingBoxes,
            isFirstRenderPage,
            answerLayout,
            pageOccupancyCount,
            unitStartPages,
          );

          if (isFullPageCrop(cropBox, pageWidth, pageHeight)) {
            if (isMathematicsUnit(unit)) {
              const pdfCropBox = toPdfCropBox(cropBox, pageGeometry);
              const probeDoc = await PDFDocument.create();
              await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
              await probeDoc.save();
              const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
              const outputPage = outputDoc.addPage([targetPageWidth, targetPageHeight]);
              outputPage.drawPage(snippet.embeddedPage, {
                x: 0,
                y: 0,
                width: targetPageWidth,
                height: targetPageHeight,
              });
              return true;
            }

            const probeDoc = await PDFDocument.create();
            const [probePage] = await probeDoc.copyPages(sourceDoc, [sourcePage.sourcePageIndex]);
            probeDoc.addPage(probePage);
            await probeDoc.save();
            const [copiedPage] = await outputDoc.copyPages(sourceDoc, [sourcePage.sourcePageIndex]);
            outputDoc.addPage(copiedPage);
            return true;
          }

          const cropWidth = cropBox.right - cropBox.left;
          const cropHeight = cropBox.top - cropBox.bottom;
          const pdfCropBox = toPdfCropBox(cropBox, pageGeometry);
          const probeDoc = await PDFDocument.create();
          await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
          await probeDoc.save();
          const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
          const outputPage = outputDoc.addPage([targetPageWidth, targetPageHeight]);
          outputPage.drawPage(snippet.embeddedPage, {
            x: 0,
            y: Math.max(0, targetPageHeight - cropHeight - STANDARD_PAGE_TOP_MARGIN),
            width: cropWidth,
            height: cropHeight,
          });
          return true;
        },
      );

      if (!rendered) {
        throw new Error(`Missing page asset CDN URL for ${unit.unitKey} page ${pageNumber}`);
      }
    }
  }

  return await outputDoc.save();
}
