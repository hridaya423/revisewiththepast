
import { createCanvas, loadImage } from "@napi-rs/canvas";

import {
  isFooterFurnitureLine,
  isHeaderFurnitureLine,
} from "@/lib/paper-maker/page-text";

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
};

const BLANK_PAGE_INK_THRESHOLD = 0.005;
const BLANK_PAGE_TEXT_THRESHOLD = 25;
const CONTENT_PAGE_START = 2;

export async function computeInkCoverage(png: Buffer): Promise<number> {
  const image = await loadImage(png);
  const scale = Math.min(1, 500 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink += 1;
  }
  return ink / (width * height);
}

function meaningfulTextLength(pageText: string): number {
  return pageText
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && !isHeaderFurnitureLine(line) && !isFooterFurnitureLine(line))
    .join("")
    .replace(/\s+/g, "").length;
}

async function checkBlankPages(
  pngPages: RenderedPngPage[],
  textPages: RenderedTextPage[],
): Promise<QaFinding[]> {
  const textByPage = new Map(textPages.map((page) => [page.pageNumber, page.text]));
  const findings: QaFinding[] = [];
  for (const page of pngPages) {
    if (page.pageNumber < CONTENT_PAGE_START) continue;
    const coverage = await computeInkCoverage(page.png);
    if (coverage >= BLANK_PAGE_INK_THRESHOLD) continue;
    if (meaningfulTextLength(textByPage.get(page.pageNumber) ?? "") >= BLANK_PAGE_TEXT_THRESHOLD) continue;
    findings.push({
      check: "blank-page",
      severity: "error",
      pageNumber: page.pageNumber,
      message: `page is ${(coverage * 100).toFixed(1)}% inked with no question text — near-blank`,
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

function checkCoverOnlyOrMissingQuestions(textPages: RenderedTextPage[], options?: QaCheckOptions): QaFinding[] {
  const contentPages = textPages.filter((page) => page.pageNumber >= CONTENT_PAGE_START);
  const meaningfulLengths = contentPages.map((page) => meaningfulTextLength(page.text));
  const meaningfulPages = meaningfulLengths.filter((length) => length >= BLANK_PAGE_TEXT_THRESHOLD).length;
  const findings: QaFinding[] = [];

  if ((options?.selectedUnitCount ?? 1) > 0 && meaningfulPages === 0) {
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
    const hasQuestionInstruction = /\b(?:state|identify|describe|explain|suggest|calculate|outline|compare|evaluate|assess|complete|which|what|give)\b/.test(normalized)
      || /\b0\s*\d\s*\.\s*\d\b/.test(normalized);
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

export async function runDeterministicChecks(
  pngPages: RenderedPngPage[],
  textPages: RenderedTextPage[],
  options?: QaCheckOptions,
): Promise<QaFinding[]> {
  const blank = await checkBlankPages(pngPages, textPages);
  return [
    ...blank,
    ...checkCoverOnlyOrMissingQuestions(textPages, options),
    ...checkPageBloat(textPages, options),
    ...checkResourcePagesWithoutQuestions(textPages),
    ...checkRepeatedFurniture(textPages),
  ];
}
