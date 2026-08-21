
import { createCanvas, loadImage } from "@napi-rs/canvas";

import {
  isFooterFurnitureLine,
  isHeaderFurnitureLine,
} from "../../domain/page-text";
import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import { checkQuestionLayout } from "./question-layout";

export type QaSeverity = "error" | "warning";

export type QaFinding = {
  check: string;
  severity: QaSeverity;
  pageNumber?: number;
  message: string;
};

export type RenderedTextPage = { pageNumber: number; text: string };
export type RenderedPngPage = { pageNumber: number; png: Buffer };

export type QaCheckOptions = {
  subjectKey?: string;
  totalMarks?: number;
  selectedUnitCount?: number;
  expectedOrdinalCount?: number;
  selectedUnitMarks?: number[];
  coverPage?: {
    totalMarks: number;
    timeMinutes: number;
    questionCount: number;
  };
};

const BLANK_PAGE_INK_THRESHOLD = 0.003;
const BLANK_PAGE_TEXT_THRESHOLD = 25;
const CONTENT_PAGE_START = 2;

type InkStats = {
  coverage: number;
};

async function computeInkStats(png: Buffer): Promise<InkStats> {
  const image = await loadImage(png);
  const scale = Math.min(1, 500 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let ink = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245) continue;
      ink += 1;
    }
  }

  return {
    coverage: ink / (width * height),
  };
}

export async function computeInkCoverage(png: Buffer): Promise<number> {
  return (await computeInkStats(png)).coverage;
}

function meaningfulTextLength(pageText: string): number {
  const meaningfulLines: string[] = [];
  for (const rawLine of pageText.split(/\s{2,}|\n/)) {
    const line = rawLine.trim();
    if (line.length >= 3 && !isHeaderFurnitureLine(line) && !isFooterFurnitureLine(line)) meaningfulLines.push(line);
  }
  return meaningfulLines.join("")
    .replace(/\s+/g, "").length;
}

export async function checkBlankPages(pngPages: RenderedPngPage[]): Promise<QaFinding[]> {
  const findings: QaFinding[] = [];
  for (const page of pngPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    const stats = await computeInkStats(page.png);
    if (stats.coverage >= BLANK_PAGE_INK_THRESHOLD) continue;
    findings.push({
      check: "blank-page",
      severity: "error",
      pageNumber: page.pageNumber,
      message: `page is ${(stats.coverage * 100).toFixed(1)}% inked with no meaningful question content — near-blank`,
    });
  }
  return findings;
}

function checkRepeatedFurniture(textPages: RenderedTextPage[]): QaFinding[] {
  const counts = new Map<string, number>();
  for (const page of textPages) {
    const seenOnPage = new Set<string>();
    for (const rawLine of page.text.split(/\s{2,}|\n/)) {
      const line = rawLine.trim();
      if (line.length < 8) continue;
      if (!isHeaderFurnitureLine(line) && !isFooterFurnitureLine(line)) continue;
      const key = line.toLowerCase().replace(/\s+/g, " ").slice(0, 48);
      if (seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const findings: QaFinding[] = [];
  for (const [key, count] of counts) {
    if (count >= 3) {
      findings.push({
        check: "repeated-furniture",
        severity: "warning",
        message: `instruction/footer furniture "${key}" appears on ${count} pages`,
      });
    }
  }
  return findings;
}

async function computeOuterGutterInkProfile(png: Buffer) {
  const image = await loadImage(png);
  const scale = Math.min(1, 500 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gutterWidth = Math.max(1, Math.round(width * 0.1));
  let ink = 0;
  let activeColumns = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < gutterWidth; x += 1) {
      const leftIndex = (y * width + x) * 4;
      const rightIndex = (y * width + (width - x - 1)) * 4;
      if (data[leftIndex] < 235 || data[leftIndex + 1] < 235 || data[leftIndex + 2] < 235) ink += 1;
      if (data[rightIndex] < 235 || data[rightIndex + 1] < 235 || data[rightIndex + 2] < 235) ink += 1;
    }
  }
  for (let x = 0; x < gutterWidth; x += 1) {
    let columnInk = 0;
    for (let y = 0; y < height; y += 1) {
      const leftIndex = (y * width + x) * 4;
      const rightIndex = (y * width + (width - x - 1)) * 4;
      if (data[leftIndex] < 235 || data[leftIndex + 1] < 235 || data[leftIndex + 2] < 235) columnInk += 1;
      if (data[rightIndex] < 235 || data[rightIndex + 1] < 235 || data[rightIndex + 2] < 235) columnInk += 1;
    }
    if (columnInk >= height * 0.08) activeColumns += 1;
  }
  return {
    coverage: ink / (gutterWidth * height * 2),
    activeColumnRatio: activeColumns / gutterWidth,
  };
}

async function checkVisibleFurniture(pngPages: RenderedPngPage[], textPages: RenderedTextPage[], subjectKey?: string): Promise<QaFinding[]> {
  const findings: QaFinding[] = [];
  const badPatterns = [
    /\bturn over\b/i,
    /\bdo not write (?:in|outside)/i,
    /\bmark your new answer with a cross\b/i,
  ];
  const includesLegitimateEnglishSourceFooter = subjectKey === "aqa-english-language";
  const pngByPage = new Map(pngPages.map((page) => [page.pageNumber, page.png]));
  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    const normalized = page.text.replace(/\s+/g, " ");
    const hasFurniture = badPatterns.some((pattern) => pattern.test(normalized))
      || !includesLegitimateEnglishSourceFooter && /\bend of sources\b/i.test(normalized);
    if (!hasFurniture) continue;
    const png = pngByPage.get(page.pageNumber);
    if (png) {
      const profile = await computeOuterGutterInkProfile(png);
      if (profile.coverage < 0.004 || profile.activeColumnRatio < 0.1) continue;
    }
    findings.push({
      check: "visible-source-furniture",
      severity: "error",
      pageNumber: page.pageNumber,
      message: "source paper furniture is visible on generated page",
    });
  }
  return findings;
}

function checkGeneratedCover(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  const cover = textPages.find((page) => page.pageNumber === 1);
  if (!cover) {
    return [{
      check: "cover-page",
      severity: "error",
      pageNumber: 1,
      message: "generated paper is missing its cover page",
    }];
  }

  const normalized = normalizeRenderedText(cover.text);
  const findings: QaFinding[] = [];
  const requiredLabels = [
    "focused practice paper",
    "name",
    "school",
    "candidate number",
    "instructions",
    "information",
    "this paper covers",
    "do not turn over until you are ready",
  ];
  for (const label of requiredLabels) {
    if (normalized.includes(label)) continue;
    findings.push({
      check: "cover-page-content",
      severity: "error",
      pageNumber: 1,
      message: `cover is missing required label "${label}"`,
    });
  }

  const forbiddenPatterns = [
    /\bofficial\b/i,
    /\bverified\b/i,
    /\bbarcode\b/i,
    /for examiner['’]s use/i,
    /references appear beside each question/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (!pattern.test(normalized)) continue;
    findings.push({
      check: "cover-page-content",
      severity: "error",
      pageNumber: 1,
      message: `cover contains prohibited wording matching ${pattern}`,
    });
  }

  const expected = options?.coverPage;
  if (expected) {
    for (const value of [expected.totalMarks, expected.timeMinutes, expected.questionCount]) {
      if (new RegExp(`\\b${value}\\b`).test(normalized)) continue;
      findings.push({
        check: "cover-page-facts",
        severity: "error",
        pageNumber: 1,
        message: `cover does not show final fact value ${value}`,
      });
    }
  }

  return findings;
}

function checkQuestionMix(options?: QaCheckOptions): QaFinding[] {
  const marks = options?.selectedUnitMarks ?? [];
  if (marks.length < 4 || (options?.totalMarks ?? 0) < 30) return [];
  const low = marks.filter((mark) => mark <= 2).length;
  const medium = marks.filter((mark) => mark > 2 && mark <= 5).length;
  const high = marks.filter((mark) => mark > 5).length;
  const findings: QaFinding[] = [];
  if (medium === 0 || low === 0 || high === 0) {
    findings.push({
      check: "question-mix-skew",
      severity: "warning",
      message: `question mix is skewed: ${low} short, ${medium} medium, ${high} extended`,
    });
  }
  if (high >= marks.length - 1) {
    findings.push({
      check: "question-mix-too-heavy",
      severity: "warning",
      message: `paper is dominated by extended questions: ${high}/${marks.length}`,
    });
  }
  return findings;
}

export function checkRenderedQuestionTotals(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  if (!options?.subjectKey?.includes("mathematics") || !options.selectedUnitMarks?.length) return [];

  const totals = new Map<number, { marks: Set<number>; count: number }>();
  const pattern = /Total\s+for\s+Question\s+(\d+)\s+(?:is|=)\s+(\d+)\s+marks?/gi;
  for (const page of textPages) {
    for (const match of page.text.matchAll(pattern)) {
      const questionNumber = Number(match[1]);
      const marks = Number(match[2]);
      const entry = totals.get(questionNumber) ?? { marks: new Set<number>(), count: 0 };
      entry.marks.add(marks);
      entry.count += 1;
      totals.set(questionNumber, entry);
    }
  }

  const findings: QaFinding[] = [];
  options.selectedUnitMarks.forEach((expected, index) => {
    const questionNumber = index + 1;
    const actual = totals.get(questionNumber);
    if (actual?.count === 1 && actual.marks.has(expected)) return;
    findings.push({
      check: "question-total-mismatch",
      severity: "error",
      message: actual === undefined
        ? `generated maths question ${questionNumber} has no rendered total; expected ${expected} marks`
        : actual.count > 1
          ? `generated maths question ${questionNumber} renders ${actual.count} totals; expected exactly one total of ${expected} marks`
          : `generated maths question ${questionNumber} renders ${Array.from(actual.marks).join(", ")} marks but its validated parts total ${expected}`,
    });
  });

  for (const [questionNumber, actual] of totals) {
    if (questionNumber >= 1 && questionNumber <= options.selectedUnitMarks.length) continue;
    findings.push({
      check: "question-total-mismatch",
      severity: "error",
      message: `generated maths paper contains an unexpected total for Question ${questionNumber} (${actual.count} occurrence${actual.count === 1 ? "" : "s"})`,
    });
  }

  return findings;
}

async function checkCoverOnlyOrMissingQuestions(pngPages: RenderedPngPage[], textPages: RenderedTextPage[], options?: QaCheckOptions): Promise<QaFinding[]> {
  const contentPages: RenderedTextPage[] = [];
  let meaningfulPages = 0;
  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    contentPages.push(page);
    if (meaningfulTextLength(page.text) >= BLANK_PAGE_TEXT_THRESHOLD) meaningfulPages += 1;
  }
  const contentPngPages = pngPages.filter((page) => page.pageNumber >= CONTENT_PAGE_START);
  const inkedPages = await Promise.all(contentPngPages.map((page) => computeInkCoverage(page.png)));
  const findings: QaFinding[] = [];

  if ((options?.selectedUnitCount ?? 1) > 0 && meaningfulPages === 0 && !inkedPages.some((coverage) => coverage >= BLANK_PAGE_INK_THRESHOLD)) {
    findings.push({
      check: "cover-only-paper",
      severity: "error",
      message: "paper has selected units but no meaningful rendered question pages",
    });
  }

  return findings;
}

function checkPageBloat(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  if (!options?.totalMarks || options.totalMarks <= 0) return [];
  const contentPageCount = Math.max(0, textPages.length - 1);
  const maxExpectedPages = Math.max(6, Math.ceil(options.totalMarks / 2) + 5);
  if (contentPageCount <= maxExpectedPages) return [];
  return [{
    check: "page-bloat",
    severity: "warning",
    message: `${contentPageCount} content pages for ${options.totalMarks} marks exceeds expected ceiling ${maxExpectedPages}`,
  }];
}

function checkResourcePagesWithoutQuestions(textPages: RenderedTextPage[]): QaFinding[] {
  const findings: QaFinding[] = [];
  const textByPage = new Map(textPages.map((page) => [page.pageNumber, page.text.toLowerCase().replace(/\s+/g, " ")]));
  const extractSupportLabels = (text: string) => {
    const labels = new Set<string>();
    for (const match of text.matchAll(/\b(?:figure|resource|table|map|graph|photo|photograph)\s+(\d{1,3})\b/g)) {
      labels.add(match[1]);
    }
    return Array.from(labels);
  };

  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    const normalized = page.text.toLowerCase().replace(/\s+/g, " ");
    const looksLikeSupportOnly = /\bfor use with question\b|\bfigure \d+\b|\bresource \d+\b/.test(normalized);
    if (!looksLikeSupportOnly) continue;
    const hasQuestionInstruction = /\b(?:state|identify|describe|explain|suggest|calculate|outline|compare|evaluate|assess|complete|devise|determine|show that|which|what|give)\b/.test(normalized)
      || /\b0\s*\d\s*\.\s*\d\b/.test(normalized)
      || /\(\s*(?:[a-z]|[ivx]{1,4})\s*\)/.test(normalized);
    if (hasQuestionInstruction) continue;
    const labels = extractSupportLabels(normalized);
    const adjacentText = `${textByPage.get(page.pageNumber - 1) ?? ""} ${textByPage.get(page.pageNumber + 1) ?? ""}`;
    if (labels.length > 0 && labels.some((label) => new RegExp(`\\bfigure\\s+${label}\\b|\\bresource\\s+${label}\\b`).test(adjacentText))) {
      continue;
    }
    findings.push({
      check: "support-page-without-question",
      severity: "warning",
      pageNumber: page.pageNumber,
      message: "resource/figure page appears without a nearby question prompt",
    });
  }
  return findings;
}

function checkCopyrightPlaceholders(textPages: RenderedTextPage[]): QaFinding[] {
  const findings: QaFinding[] = [];
  const placeholderPattern = /\b(?:cannot be|not|has been|item)\s+(?:reproduced|removed)\s+here\s+due\s+to\s+third[- ]party\s+copyright\s+restrictions\b|\bitem\s+removed\s+due\s+to\s+third[- ]party\s+copyright\s+restrictions\b/i;

  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    if (!placeholderPattern.test(page.text.replace(/\s+/g, " "))) continue;
    findings.push({
      check: "copyright-placeholder",
      severity: "error",
      pageNumber: page.pageNumber,
      message: "page contains a missing third-party copyrighted figure/extract placeholder",
    });
  }

  return findings;
}

function checkGenericExtraAnswerPages(textPages: RenderedTextPage[]): QaFinding[] {
  const findings: QaFinding[] = [];
  const genericExtraPagePattern = /additional page, if required|write the question numbers in the left-hand margin|\bextra answer space\b/i;

  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    if (!genericExtraPagePattern.test(page.text.replace(/\s+/g, " "))) continue;
    findings.push({
      check: "generic-extra-answer-page",
      severity: "error",
      pageNumber: page.pageNumber,
      message: "generic source extra-answer page rendered inside the generated paper",
    });
  }

  return findings;
}

function checkSuspiciousAqaCompoundMarkers(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  if (!options?.subjectKey?.startsWith("aqa-") || !options.selectedUnitCount) return [];
  const findings: QaFinding[] = [];
  const markerPattern = /(?:^|\s)(\d\s*\d)\s*\.\s*(\d+)(?=\s|$)/g;
  for (const page of textPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    for (const match of page.text.matchAll(markerPattern)) {
      const questionNumber = Number(match[1].replace(/\s+/g, ""));
      if (questionNumber > 0 && questionNumber <= options.selectedUnitCount) continue;
      findings.push({
        check: "suspicious-aqa-compound-marker",
        severity: "error",
        pageNumber: page.pageNumber,
        message: `AQA compound marker ${match[1]}.${match[2]} is outside the generated question range 01-${String(options.selectedUnitCount).padStart(2, "0")}.`,
      });
    }
  }
  return findings;
}

function normalizeRenderedText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function checkBusinessMissingReferences(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  if (options?.subjectKey !== "aqa-business" && options?.subjectKey !== "edexcel-business") return [];

  const findings: QaFinding[] = [];
  const normalizedPages = textPages.map((page) => ({
    pageNumber: page.pageNumber,
    text: normalizeRenderedText(page.text),
  }));

  const getContextWindow = (pageNumber: number) => {
    const context: string[] = [];
    for (const page of normalizedPages) {
      if (page.pageNumber >= pageNumber - 3 && page.pageNumber <= pageNumber + 1) context.push(page.text);
    }
    return context.join(" ");
  };

  for (const page of normalizedPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;

    const references = Array.from(page.text.matchAll(/\b(?:using|use|from|in)\s+(item|table|figure)\s+([a-z]|\d{1,3})\b/g));
    for (const match of references) {
      const kind = match[1];
      const label = match[2];
      const context = getContextWindow(page.pageNumber).replace(
        new RegExp(`\\b(?:using|use|from|in)\\s+${kind}\\s+${label}\\b`, "gi"),
        " ",
      );
      const labelPattern = kind === "item"
        ? new RegExp(`\\bitem\\s*${label}\\s*:`, "i")
        : new RegExp(`\\b${kind}\\s*${label}\\b`, "i");
      if (labelPattern.test(context)) continue;

      findings.push({
        check: "missing-business-reference",
        severity: "error",
        pageNumber: page.pageNumber,
        message: `question references ${kind} ${label.toUpperCase()} but that ${kind} is not visible nearby`,
      });
    }
  }

  return findings;
}

export async function runDeterministicChecks(
  pngPages: RenderedPngPage[],
  textPages: RenderedTextPage[],
  options?: QaCheckOptions,
): Promise<QaFinding[]> {
  const blank = await checkBlankPages(pngPages);
  return [
    ...checkGeneratedCover(textPages, options),
    ...blank,
    ...await checkCoverOnlyOrMissingQuestions(pngPages, textPages, options),
    ...checkPageBloat(textPages, options),
    ...checkCopyrightPlaceholders(textPages),
    ...checkGenericExtraAnswerPages(textPages),
    ...checkSuspiciousAqaCompoundMarkers(textPages, options),
    ...checkResourcePagesWithoutQuestions(textPages),
    ...checkBusinessMissingReferences(textPages, options),
    ...checkRenderedQuestionTotals(textPages, options),
    ...await checkVisibleFurniture(pngPages, textPages, options?.subjectKey),
    ...checkQuestionMix(options),
    ...checkRepeatedFurniture(textPages),
  ];
}

export async function assertGeneratedPaperQuality(
  pdfBytes: Uint8Array,
  options: QaCheckOptions,
) {
  const rendered = await renderPdfToPngBuffers(pdfBytes, 0.75);
  const findings = await runDeterministicChecks(rendered.pages, rendered.textPages, options);
  if (options.selectedUnitCount !== undefined || options.expectedOrdinalCount !== undefined) {
    findings.push(...await checkQuestionLayout(pdfBytes, options));
  }
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length === 0) return;

  throw new Error(
    `Generated paper failed preflight: ${errors.map((finding) => finding.message).join("; ")}`,
  );
}
