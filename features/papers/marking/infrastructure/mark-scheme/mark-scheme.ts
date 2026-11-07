import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import { getPdfDocument, loadPdfJsForNode, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";
import { getPaperAssetsByBoardSubjectFromConvex } from "@/features/papers/infrastructure/question-bank";
import {
  buildStructuredLines,
  detectEdexcelScienceQuestionStart,
  detectOcrComputerScienceQuestionStart,
  detectOcrComputerScienceQuestionNumbers,
  detectPageQuestionNumber,
  findEdexcelScienceQuestionStart,
  normalizeInlineText,
  normalizeQuestionNumber,
  pageHasQuestionStart,
  type CachedPdfPage,
  type PositionedPdfItem,
  type StructuredPdfLine,
} from "./text-structure";
import { compareQuestionPaths } from "@/shared/domain/question-path";

export { detectPageQuestionNumber, normalizeQuestionNumber } from "./text-structure";
export type { CachedPdfPage, PositionedPdfItem, StructuredPdfLine } from "./text-structure";

type MarkableUnit = Awaited<ReturnType<typeof getMarkableUnitsByUnitKeys>>[number];
type PdfJsDocument = Awaited<ReturnType<typeof getPdfDocument>>;
type PositionedTextItem = { str: string; transform: number[] };

function isPositionedTextItem(item: unknown): item is PositionedTextItem {
  if (typeof item !== "object" || item === null || !("str" in item) || !("transform" in item)) return false;
  return typeof item.str === "string"
    && Array.isArray(item.transform)
    && item.transform.every((value) => typeof value === "number");
}

const PDF_TEXT_CACHE = new Map<string, CachedPdfPage[]>();
const PDF_BYTES_CACHE = new Map<string, Uint8Array>();
const PAPER_ASSET_CACHE = new Map<string, Awaited<ReturnType<typeof getPaperAssetsByBoardSubjectFromConvex>>>();

export function inferTierFromSourceRelativePath(sourceRelativePath: string) {
  const normalized = sourceRelativePath.toLowerCase();
  if (normalized.includes("/foundation/")) return "foundation" as const;
  if (normalized.includes("/higher/")) return "higher" as const;
  return "none" as const;
}

function deriveDownloadedPdfPath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\\"))) {
    throw new Error(`Unsafe mark scheme asset path: ${relativePath}`);
  }
  return resolve(process.cwd(), "data", "downloads", ...segments);
}

const TRUSTED_ASSET_HOSTS = new Set(["cdn.hackclub.com"]);

function assertTrustedAssetUrl(remoteUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new Error("Mark scheme asset URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" || !TRUSTED_ASSET_HOSTS.has(parsed.hostname)) {
    throw new Error("Mark scheme asset URL host is not allowed.");
  }
}

async function loadMarkSchemeBytes(relativePath: string, remoteUrl: string) {
  if (PDF_BYTES_CACHE.has(relativePath)) return PDF_BYTES_CACHE.get(relativePath)!;

  const localPath = deriveDownloadedPdfPath(relativePath);
  let data: Uint8Array;
  if (existsSync(localPath)) {
    data = new Uint8Array(readFileSync(localPath));
  } else {
    assertTrustedAssetUrl(remoteUrl);
    data = new Uint8Array(await fetch(remoteUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to load mark scheme PDF (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    }));
  }

  PDF_BYTES_CACHE.set(relativePath, data);
  return data;
}

export async function loadMarkSchemeTextPages(relativePath: string, remoteUrl: string) {
  if (PDF_TEXT_CACHE.has(relativePath)) return PDF_TEXT_CACHE.get(relativePath)!;

  const data = await loadMarkSchemeBytes(relativePath, remoteUrl);
  const [document, pdfjs] = await Promise.all([
    getPdfDocument(data.slice()),
    loadPdfJsForNode(),
  ]);
  const pages: CachedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const positionedItems: PositionedPdfItem[] = textContent.items.flatMap((item) => {
      if (!isPositionedTextItem(item)) return [];
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      return [{ text: item.str, x: transform[4], y: viewport.height - transform[5] }];
    });

    pages.push({
      pageNumber,
      text: normalizeInlineText(positionedItems.map((item) => item.text).join(" ")),
      lines: buildStructuredLines(pageNumber, positionedItems, viewport.width),
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
  }

  PDF_TEXT_CACHE.set(relativePath, pages);
  return pages;
}

function normalizeMarkSchemeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const EDEXCEL_QUALIFICATION_CODES: Record<string, string> = {
  "combined-science": "1SC0",
  biology: "1BI0",
  chemistry: "1CH0",
  physics: "1PH0",
  business: "1BS0",
  french: "1FR0",
  mathematics: "1MA1",
};

export function markSchemeDocumentMatchesUnitIdentity(
  unit: Pick<MarkableUnit, "boardCode" | "subjectSlug">,
  pages: CachedPdfPage[],
) {
  if (unit.boardCode !== "edexcel") return true;
  const expectedCode = EDEXCEL_QUALIFICATION_CODES[unit.subjectSlug];
  if (!expectedCode) return true;
  const coverText = pages.slice(0, 2).map((page) => page.text).join(" ");
  const detectedCode = coverText.match(/\b1(?:SC|BI|CH|PH|BS|FR|MA)0\b/i)?.[0]?.toUpperCase();
  return detectedCode === undefined || detectedCode === expectedCode;
}

function narrowAqaEnglishLanguagePages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  const questionNumbers = Array.from(new Set(unit.parts.map((part) => normalizeQuestionNumber(part.questionNumber))));
  if (questionNumbers.length === 0) return [];
  const targetQuestions = new Set(questionNumbers);
  const questionPattern = (question: string) => new RegExp(`\\b0\\s*${question}\\b`, "i");
  const pageQuestion = (page: CachedPdfPage) => questionNumbers.find((question) => questionPattern(question).test(page.text));
  const startIndex = pages.findIndex((page) => pageQuestion(page));
  if (startIndex < 0) return [];

  let endIndex = pages.length;
  for (let index = startIndex + 1; index < pages.length; index += 1) {
    const match = normalizeMarkSchemeText(pages[index].text).match(/\b0\s*(\d{1,2})\b/);
    if (match && !targetQuestions.has(normalizeQuestionNumber(match[1]))) {
      endIndex = index;
      break;
    }
  }
  return pages.slice(startIndex, endIndex);
}

function englishLiteratureQuestionPattern(unit: MarkableUnit) {
  const question = normalizeQuestionNumber(unit.questionNumber);
  const part = unit.parts.length === 1 ? unit.parts[0]?.questionPartNumber?.trim() : null;
  const questionNumber = `0?${question}`;
  if (part) return new RegExp(`\\bQuestion\\s+${questionNumber}\\s*\\.\\s*${part}\\b|\\b${questionNumber}\\s*\\.\\s*${part}\\b`, "i");
  return new RegExp(`\\bQuestion\\s+${questionNumber}\\b`, "i");
}

function isDifferentEnglishLiteratureQuestionPage(page: CachedPdfPage, unit: MarkableUnit) {
  const targetQuestion = normalizeQuestionNumber(unit.questionNumber);
  const targetPart = unit.parts.length === 1 ? unit.parts[0]?.questionPartNumber?.trim() ?? null : null;
  for (const match of normalizeMarkSchemeText(page.text).matchAll(/\bQuestion\s+0?(\d{1,2})(?:\s*\.\s*(\d+))?\b/gi)) {
    const question = normalizeQuestionNumber(match[1]);
    const part = match[2] ?? null;
    if (question !== targetQuestion) return true;
    if (targetPart && part && part !== targetPart) return true;
  }
  return false;
}

function narrowAqaEnglishLiteraturePages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  const targetPattern = englishLiteratureQuestionPattern(unit);
  const startIndex = pages.findIndex((page) => targetPattern.test(page.text));
  if (startIndex < 0) return [];
  let endIndex = pages.length;
  for (let index = startIndex + 1; index < pages.length; index += 1) {
    if (isDifferentEnglishLiteratureQuestionPage(pages[index], unit)) {
      endIndex = index;
      break;
    }
  }
  return pages.slice(startIndex, endIndex);
}

function narrowFallbackMarkSchemePages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  if (unit.boardCode !== "aqa") return [];
  if (unit.subjectSlug === "english-language") return narrowAqaEnglishLanguagePages(unit, pages);
  if (unit.subjectSlug === "english-literature") return narrowAqaEnglishLiteraturePages(unit, pages);
  if (unit.subjectSlug === "business" || unit.subjectSlug === "geography") return narrowAqaNumberedQuestionPages(unit, pages);
  return [];
}

function aqaPartPattern(questionNumber: string, partNumber: string) {
  const escapedPart = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b0?${questionNumber}\\s*(?:\\.|\\s)\\s*${escapedPart}(?![\\dA-Za-z])(?=\\s+[A-Z0-9‘’“”'"([{•]|\\s*$)`);
}

function isAqaQuestionPartLine(line: StructuredPdfLine, questionNumber: string, partNumber: string) {
  const normalizedQuestion = normalizeQuestionNumber(questionNumber);
  if (/\bLevel\s+Marks?\b/i.test(line.fullText)) return false;
  const extractedColumns = normalizeInlineText([line.leftText, line.answerText].filter(Boolean).join(" "));
  const questionColumnText = extractedColumns || normalizeInlineText(line.fullText);
  return aqaPartPattern(normalizedQuestion, partNumber).test(questionColumnText);
}

export function findAqaNumberedQuestionStartIndex(pages: CachedPdfPage[], questionNumber: string, partNumber: string) {
  return pages.findIndex((page) => page.lines.some((line) => isAqaQuestionPartLine(line, questionNumber, partNumber)));
}

function aqaOtherPartPattern(questionNumber: string, partNumber: string) {
  const escapedPart = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b0?${questionNumber}\\s*(?:\\.|\\s)\\s*(?!${escapedPart}(?![\\dA-Za-z]))\\d{1,2}(?:\\s*\\([a-z]{1,4}\\))?(?=\\s+[A-Z0-9‘’“”'"([{•]|\\s*$)`);
}

function aqaDifferentQuestionStart(text: string, questionNumber: string) {
  for (const match of text.matchAll(/\b0?(\d{1,2})\s*(?:\.|\s)\s*\d{1,2}\b/g)) {
    if (normalizeQuestionNumber(match[1]) !== questionNumber) return match;
  }
  return null;
}

function getAqaWholeQuestionNumber(page: CachedPdfPage) {
  for (const line of page.lines) {
    for (const columnText of [line.leftText, line.answerText]) {
      const token = columnText.trim();
      if (!/^\d{2}$/.test(token) || !line.fullText.trim().startsWith(`${token} `)) continue;
      return normalizeQuestionNumber(token);
    }
  }
  return null;
}

function resolveAqaMarkSchemePartLabel(
  unit: MarkableUnit,
  pages: CachedPdfPage[],
  questionNumber: string,
  partNumber: string,
) {
  const isLetterPart = /^[a-z]{1,4}$/i.test(partNumber);
  const escapedPart = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelPattern = isLetterPart
    ? new RegExp(`\\b0?${questionNumber}\\s+(\\d{1,2})\\s*\\(\\s*${escapedPart}\\s*\\)`, "gi")
    : new RegExp(`\\b0?${questionNumber}\\s+${escapedPart}\\s*\\(\\s*([a-z]{1,4})\\s*\\)`, "gi");
  const candidates: { pageIndex: number; label: string; context: string }[] = [];
  pages.forEach((page, pageIndex) => {
    for (const match of page.text.matchAll(labelPattern)) {
      const start = match.index ?? 0;
      candidates.push({
        pageIndex,
        label: isLetterPart
          ? `${match[1]}(${partNumber.toLowerCase()})`
          : `${partNumber}(${String(match[1]).toLowerCase()})`,
        context: page.text.slice(start, start + 400),
      });
    }
  });
  if (candidates.length === 0) return null;
  if (new Set(candidates.map((candidate) => candidate.label)).size === 1) return candidates[0];

  const normalizedPrompt = normalizeInlineText(unit.parts[0]?.promptText ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ");
  const promptWords = new Set(normalizedPrompt.split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  let best: (typeof candidates)[number] & { score: number } | null = null;
  let tied = false;
  for (const candidate of candidates) {
    const context = candidate.context.toLowerCase();
    const letter = candidate.label.match(/\(([a-z]{1,4})\)/)?.[1];
    let score = letter && normalizedPrompt.includes(`(${letter})`) ? 100 : 0;
    for (const word of promptWords) {
      if (context.includes(word)) score += 1;
    }
    if (!best || score > best.score) {
      best = { ...candidate, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  return best && !tied && best.score >= 2 ? best : null;
}

export function narrowAqaNumberedQuestionPages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  const questionNumber = normalizeQuestionNumber(unit.questionNumber);
  const parts = unit.parts.map((part) => part.questionPartNumber).filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    const startIndex = pages.findIndex((page) => getAqaWholeQuestionNumber(page) === questionNumber);
    if (startIndex < 0) return [];
    const nextQuestionOffset = pages.slice(startIndex + 1).findIndex((page) => {
      const pageQuestionNumber = getAqaWholeQuestionNumber(page);
      return pageQuestionNumber !== null && pageQuestionNumber !== questionNumber;
    });
    return pages.slice(startIndex, nextQuestionOffset < 0 ? undefined : startIndex + 1 + nextQuestionOffset);
  }
  let startIndex = findAqaNumberedQuestionStartIndex(pages, questionNumber, parts[0]);
  if (startIndex < 0) {
    const resolved = resolveAqaMarkSchemePartLabel(unit, pages, questionNumber, parts[0]);
    if (!resolved) return [];
    parts[0] = resolved.label;
    startIndex = resolved.pageIndex;
  }
  const startPattern = aqaPartPattern(questionNumber, parts[0]);

  if (parts.length === 1) {
    const selectedPages: CachedPdfPage[] = [];
    const page = pages[startIndex];
    const startMatch = page.text.match(startPattern);
    const startOffset = startMatch?.index ?? 0;
    const nextPartPattern = aqaOtherPartPattern(questionNumber, parts[0]);
    const firstPageRemainder = page.text.slice(startOffset);
    const firstNextMatch = firstPageRemainder.slice(1).match(nextPartPattern);
    const firstOtherQuestion = aqaDifferentQuestionStart(firstPageRemainder.slice(1), questionNumber);
    const firstEnd = Math.min(
      firstNextMatch?.index === undefined ? Infinity : 1 + firstNextMatch.index,
      firstOtherQuestion?.index === undefined ? Infinity : 1 + firstOtherQuestion.index,
    );
    const firstText = normalizeInlineText(firstPageRemainder.slice(0, Number.isFinite(firstEnd) ? firstEnd : undefined));
    if (firstText) selectedPages.push({ ...page, pageNumber: 0, text: firstText, lines: [] });
    if (firstNextMatch || firstOtherQuestion) return selectedPages;

    for (let index = startIndex + 1; index < pages.length; index += 1) {
      const continuation = pages[index];
      const nextMatch = continuation.text.match(nextPartPattern);
      const otherQuestion = aqaDifferentQuestionStart(continuation.text, questionNumber);
      const end = Math.min(nextMatch?.index ?? Infinity, otherQuestion?.index ?? Infinity);
      const text = normalizeInlineText(continuation.text.slice(0, Number.isFinite(end) ? end : undefined));
      if (text) selectedPages.push({ ...continuation, pageNumber: 0, text, lines: [] });
      if (nextMatch || otherQuestion || /\bSection\s+[B-Z]\b/i.test(continuation.text)) break;
    }
    return selectedPages;
  }

  const nextQuestion = String(Number(questionNumber) + 1);
  const nextQuestionPattern = aqaPartPattern(nextQuestion, "1");
  let endIndex = pages.length;
  for (let index = startIndex + 1; index < pages.length; index += 1) {
    if (nextQuestionPattern.test(pages[index].text) || /\bSection\s+[B-Z]\b/i.test(pages[index].text)) {
      endIndex = index;
      break;
    }
  }
  return pages.slice(startIndex, endIndex);
}

const MS_TABLE_HEADER_LABEL = /^(?:question(?:\s+number)?|part|qu)\b/i;
const MS_TABLE_HEADER_KEYWORD = /\b(?:answer|working|marks?|notes?|guidance|scheme)\b/gi;

function isMarkSchemeTableHeaderLine(line: StructuredPdfLine) {
  const keywordCount = (line.fullText.match(MS_TABLE_HEADER_KEYWORD) ?? []).length;
  return (MS_TABLE_HEADER_LABEL.test(line.leftText.trim()) && keywordCount >= 1)
    || (line.leftText.trim() === "" && keywordCount >= 2);
}

export function selectedAnswerRegionBounds(
  lines: StructuredPdfLine[],
  pageHeight: number,
  nextBoundary: StructuredPdfLine | null,
  previousBoundary: StructuredPdfLine | null = null,
) {
  if (lines.length === 0) return null;
  const topLineY = Math.max(...lines.map((line) => line.y));
  const bottomLineY = Math.min(...lines.map((line) => line.y));
  // Bound mid-gap between rows so neighbouring glyphs are never sliced. When the
  // row directly above is the table's column header, keep it — excerpts read
  // wrong without Question/Answer/Mark headings.
  const regionTop = previousBoundary === null
    ? Math.min(pageHeight, topLineY + 8)
    : isMarkSchemeTableHeaderLine(previousBoundary)
      ? Math.min(pageHeight, previousBoundary.y + 20)
      : (previousBoundary.y + topLineY) / 2;
  const regionBottom = nextBoundary
    ? (bottomLineY + nextBoundary.y) / 2
    : Math.max(0, bottomLineY - 8);
  return { regionTop, regionBottom, regionNextBottom: nextBoundary ? regionBottom : undefined };
}

// Publisher/copyright lines sit at the foot of source mark-scheme pages. They
// are never answer content; leaving them in a selection drags the region crop
// down to the page footer.
const MS_FOOTER_LINE = /Pearson Education|Registered (?:company|office)|\b80 Strand\b|Copyright|©|Turn over|https?:\/\/|www\./i;

function isMarkSchemeFooterLine(line: StructuredPdfLine) {
  return MS_FOOTER_LINE.test(line.fullText);
}

const MS_SECTION_HEADING = /^SECTION\s+[A-Z]/i;

// The leading question number of a row, if the row opens a question. Normally
// the Qu column carries it, but some mark schemes (Edexcel French) leave the
// column layout undetected and leftText empty — there a fullText row still
// opens a question only when it leads with a number and ends in a mark
// ("10 Normally I go … (7)"). Level bands ("7 The meaning…") and prose never
// end in a bare mark, so they are not mistaken for question starts.
function questionRowNumber(line: StructuredPdfLine): number | null {
  const leftText = line.leftText.trim();
  const leftMatch = leftText.match(/^0?(\d{1,2})(?![\d.])/);
  if (leftMatch !== null && !/^\d{1,2}\s+marks?\b/i.test(leftText)) return Number(leftMatch[1]);
  if (leftText !== "") return null;
  const fullText = line.fullText.trim();
  if (!/\(\d{1,2}\)\s*$/.test(fullText) || /^\d{1,2}\s+marks?\b/i.test(fullText)) return null;
  const fullMatch = fullText.match(/^0?(\d{1,2})(?![\d.])(?=\s|\()/);
  return fullMatch !== null ? Number(fullMatch[1]) : null;
}

function isSectionHeadingLine(line: StructuredPdfLine) {
  return MS_SECTION_HEADING.test(line.fullText.trim());
}

export function trimPageToQuestionRange(page: CachedPdfPage, questionNumber: string, options?: { aqaDottedLabels?: boolean }) {
  const targetStart = new RegExp(`^0?${questionNumber}(?:\\s*\\(|[a-z]\\b|\\s|$)`, "i");
  const otherStart = new RegExp(`^(?!0?${questionNumber}(?:\\s|\\(|[a-z]|$))0?\\d{1,2}(?:\\s*\\(|[a-z]\\b|\\s*$)`, "i");
  const unitNumber = Number(normalizeQuestionNumber(questionNumber));
  // AQA mark schemes leave the Qu column empty and print part labels inline as
  // "1.7 ..." in the row text — leftText alone can start the trim mid-question.
  // The trailing lookahead excludes decimals ("68.26 x", "5.46m (1)"): a real
  // part label is followed by a capitalised prompt, mark bracket, or bullet.
  const dottedLabel = options?.aqaDottedLabels ? /^0?(\d{1,2})\s*\.\s*\d{1,2}(?![\dA-Za-z])(?=\s+[A-Z0-9‘’“”'"([{•]|\s*$)/ : null;
  const dottedStart = dottedLabel ? new RegExp(`^0?${questionNumber}\\s*\\.\\s*\\d{1,2}(?![\\dA-Za-z])(?=\\s+[A-Z0-9‘’“”'"([{•]|\\s*$)`, "i") : null;
  let startIndex = page.lines.findIndex((line) => targetStart.test(line.leftText.trim()));
  if (dottedStart) {
    const dottedIndex = page.lines.findIndex((line) => dottedStart.test(line.fullText.trim()));
    if (dottedIndex >= 0 && (startIndex < 0 || dottedIndex < startIndex)) startIndex = dottedIndex;
  }
  // A continuation page has no `N…` start of its own — the unit owns rows only
  // until a different question's start (a source page can carry one question's
  // tail straight into the next question's header). A page with no owned rows
  // contributes no region.
  if (startIndex < 0) {
    // Text-only narrowed pages (AQA numbered-question slices carry scoped text
    // with no lines) have no rows to cut — keep them as collected.
    if (page.lines.length === 0) return page;
    let endIndex = page.lines.length;
    for (let index = 0; index < page.lines.length; index += 1) {
      const rowNumber = questionRowNumber(page.lines[index]);
      const dottedOther = dottedLabel !== null && Number.isFinite(unitNumber)
        && (() => { const match = page.lines[index].fullText.trim().match(dottedLabel); return match !== null && Number(match[1]) !== unitNumber; })();
      const differentQuestionRow = rowNumber !== null
        && Number.isFinite(unitNumber) && rowNumber !== unitNumber;
      if (differentQuestionRow || dottedOther) {
        endIndex = index;
        break;
      }
    }
    const lines = page.lines.slice(0, endIndex);
    while (lines.length > 0 && isMarkSchemeFooterLine(lines[lines.length - 1])) lines.pop();
    if (lines.length === 0) return { ...page, text: "", lines: [] };
    const pageHeight = page.pageHeight ?? Math.max(...page.lines.map((line) => line.y), 0) + 36;
    const region = selectedAnswerRegionBounds(lines, pageHeight, page.lines[endIndex] ?? null, null);
    if (!region) return { ...page, text: "", lines: [] };
    return {
      ...page,
      pageNumber: 0,
      sourcePageNumber: page.sourcePageNumber ?? page.pageNumber,
      text: normalizeInlineText(lines.map((line) => line.fullText).join(" ")),
      lines,
      ...region,
    };
  }

  let endIndex = page.lines.length;
  for (let index = startIndex + 1; index < page.lines.length; index += 1) {
    const leftText = page.lines[index].leftText.trim();
    // A row leading with a higher question number starts the next question even
    // when the Qu and Answer cells merged into leftText ("2 2 × 2 × 3 × 5").
    // Rows whose column layout never resolved carry the number only in fullText
    // — there a mark-suffixed row ("10 Normally… (7)") is still a question
    // start, while level bands ("7 The meaning…") are not.
    const rowNumber = questionRowNumber(page.lines[index]);
    const higherQuestionRow = rowNumber !== null && Number.isFinite(unitNumber) && rowNumber > unitNumber;
    const foreignMarkRow = leftText === "" && rowNumber !== null && Number.isFinite(unitNumber) && rowNumber !== unitNumber;
    // A lower-or-equal number followed by a part marker is a part label of the
    // current question (AQA Pt column "3(b)"), not a new question.
    const partLabelRow = rowNumber !== null && rowNumber <= unitNumber
      && /^\d{1,2}\s*\((?:[a-z]|[ivx]{1,4}|\d+)\)/i.test(leftText);
    const dottedOther = dottedLabel !== null && Number.isFinite(unitNumber)
      && (() => { const match = page.lines[index].fullText.trim().match(dottedLabel); return match !== null && Number(match[1]) !== unitNumber; })();
    if (higherQuestionRow || foreignMarkRow || dottedOther
      || (otherStart.test(leftText) && !partLabelRow)) {
      endIndex = index;
      break;
    }
  }

  const lines = page.lines.slice(startIndex, endIndex);
  while (lines.length > 0 && isMarkSchemeFooterLine(lines[lines.length - 1])) lines.pop();
  if (startIndex === 0 && lines.length === page.lines.length) return page;
  if (lines.length === 0) return page;
  const pageHeight = page.pageHeight ?? Math.max(...page.lines.map((line) => line.y), 0) + 36;
  const nextBoundary = page.lines[endIndex];
  const region = selectedAnswerRegionBounds(lines, pageHeight, nextBoundary ?? null, page.lines[startIndex - 1] ?? null);
  if (!region) return page;
  return {
    ...page,
    pageNumber: 0,
    sourcePageNumber: page.sourcePageNumber ?? page.pageNumber,
    text: normalizeInlineText(lines.map((line) => line.fullText).join(" ")),
    lines,
    ...region,
  };
}

export function trimMixedQuestionPages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  if (unit.subjectSlug === "english-language" || unit.subjectSlug === "english-literature") return pages;
  const targetQuestionNumber = normalizeQuestionNumber(unit.questionNumber);
  const preserveReadingOrderText = unit.boardCode === "edexcel"
    && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug);
  return pages.map((page) => {
    const trimmed = trimPageToQuestionRange(page, targetQuestionNumber, { aqaDottedLabels: unit.boardCode === "aqa" });
    return preserveReadingOrderText ? { ...trimmed, text: page.text } : trimmed;
  });
}

function narrowInlineQuestionTextPages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  const isEdexcelScience = unit.boardCode === "edexcel"
    && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug);
  if (!isEdexcelScience && unit.subjectSlug !== "french" && unit.subjectSlug !== "mathematics") return [];
  const questionNumber = normalizeQuestionNumber(unit.questionNumber);
  const startPattern = unit.subjectSlug === "mathematics"
      ? new RegExp(`\\b${questionNumber}\\s*\\([a-z]\\)`, "i")
      : new RegExp(`\\b${questionNumber}\\s*\\((?:[a-z]|[ivx]{1,4})\\)`, "i");
  const nextQuestion = String(Number(questionNumber) + 1);
  const nextPattern = unit.subjectSlug === "mathematics"
      ? new RegExp(`\\b${nextQuestion}(?:\\s*\\([a-z]\\))?\\b`, "i")
      : new RegExp(`\\b${nextQuestion}\\s*\\((?:[a-z]|[ivx]{1,4})\\)`, "i");
  const effectiveNextPattern = unit.subjectSlug === "mathematics"
    ? new RegExp(String.raw`\b${nextQuestion}(?:\s*\([a-z]\))?\s+(?=[A-Za-z0-9(–—-])`, "i")
    : nextPattern;
  const startsTargetQuestion = (page: CachedPdfPage) => isEdexcelScience
    ? detectEdexcelScienceQuestionStart(page, questionNumber)
    : startPattern.test(page.text);
  const nextQuestionOffset = (text: string) => isEdexcelScience
    ? findEdexcelScienceQuestionStart(text, nextQuestion) ?? -1
    : text.search(effectiveNextPattern);
  const startIndex = pages.findIndex(startsTargetQuestion);
  if (startIndex < 0) return [];

  const selectedPages: CachedPdfPage[] = [];
  for (let index = startIndex; index < pages.length; index += 1) {
    const page = pages[index];
    const startOffset = index === startIndex
      ? Math.max(0, isEdexcelScience ? findEdexcelScienceQuestionStart(page.text, questionNumber) ?? 0 : page.text.search(startPattern))
      : 0;
    const afterStart = page.text.slice(startOffset);
    const nextOffset = nextQuestionOffset(afterStart);
    const pageTextBeforeNext = afterStart.slice(0, nextOffset >= 0 ? nextOffset : afterStart.length);
    if (index > startIndex && nextOffset >= 0 && !new RegExp(`\\b${questionNumber}\\b`, "i").test(pageTextBeforeNext)) break;
    const text = normalizeInlineText(pageTextBeforeNext);
    const startLineIndex = index === startIndex
      ? page.lines.findIndex((line) => isEdexcelScience
        ? detectEdexcelScienceQuestionStart({ pageNumber: page.pageNumber, text: line.fullText, lines: [line] }, questionNumber)
        : startPattern.test(`${line.leftText} ${line.fullText}`))
      : 0;
    const nextLineIndex = startLineIndex >= 0
      ? page.lines.findIndex((line, lineIndex) => lineIndex > startLineIndex && (isEdexcelScience
        ? detectEdexcelScienceQuestionStart({ pageNumber: page.pageNumber, text: line.fullText, lines: [line] }, nextQuestion)
        : effectiveNextPattern.test(`${line.leftText} ${line.fullText}`)))
      : -1;
    const selectedLines = startLineIndex >= 0
      ? page.lines.slice(startLineIndex, nextLineIndex >= 0 ? nextLineIndex : undefined)
      : [];
    // The text-level nextPattern needs a part marker ("10(a)"), but a table can
    // carry a bare question number ("10 Normally…") — cut the selection at the
    // first row that opens a different question or section.
    const unitNumber = Number(questionNumber);
    let cutIndex = -1;
    for (let index = 0; index < selectedLines.length; index += 1) {
      const rowNumber = questionRowNumber(selectedLines[index]);
      if ((rowNumber !== null && Number.isFinite(unitNumber) && rowNumber !== unitNumber)
        || isSectionHeadingLine(selectedLines[index])) {
        cutIndex = index;
        break;
      }
    }
    if (cutIndex >= 0) {
      selectedLines.length = cutIndex;
    }
    while (selectedLines.length > 0 && isMarkSchemeFooterLine(selectedLines[selectedLines.length - 1])) selectedLines.pop();
    if (text) {
      const foreignLine = cutIndex >= 0 && startLineIndex >= 0 ? page.lines[startLineIndex + cutIndex] : null;
      const nextLine = foreignLine ?? (nextLineIndex >= 0 ? page.lines[nextLineIndex] : null);
      const previousLine = startLineIndex > 0 ? page.lines[startLineIndex - 1] : null;
      const region = selectedAnswerRegionBounds(selectedLines, page.pageHeight ?? Infinity, nextLine, previousLine);
      selectedPages.push({
        ...page,
        pageNumber: 0,
        sourcePageNumber: page.sourcePageNumber ?? page.pageNumber,
        text: selectedLines.length > 0 ? normalizeInlineText(selectedLines.map((line) => line.fullText).join(" ")) : text,
        lines: selectedLines.length > 0 ? selectedLines : [],
        regionTop: region?.regionTop,
        regionBottom: region?.regionBottom ?? 0,
        regionNextBottom: region?.regionNextBottom,
      });
    }
    if (nextOffset >= 0) break;
    if (index > startIndex && detectPageQuestionNumber(page) && detectPageQuestionNumber(page) !== questionNumber) break;
  }
  return selectedPages;
}

async function getPaperAssets(boardCode: string, subjectSlug: string) {
  const key = `${boardCode}::${subjectSlug}`;
  if (!PAPER_ASSET_CACHE.has(key)) {
    PAPER_ASSET_CACHE.set(key, await getPaperAssetsByBoardSubjectFromConvex(boardCode, subjectSlug));
  }
  return PAPER_ASSET_CACHE.get(key)!;
}

function sessionsMatch(assetSession: string | null | undefined, unitSession: string | null | undefined) {
  const normalizedAsset = (assetSession ?? "").trim().toLowerCase();
  const normalizedUnit = (unitSession ?? "").trim().toLowerCase();
  const assetIsUnknown = !normalizedAsset || normalizedAsset === "unknown" || normalizedAsset === "none";
  const unitIsUnknown = !normalizedUnit || normalizedUnit === "unknown" || normalizedUnit === "none";
  if (unitIsUnknown) return assetIsUnknown;
  return !assetIsUnknown && normalizedAsset === normalizedUnit;
}

type MarkSchemeAssetIdentity = {
  kind: string;
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session?: string | null;
  tier?: string | null;
};

type MarkSchemePaperIdentity = {
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: string | null;
  tier: string;
};

export function resolveMarkSchemeAsset<T extends MarkSchemeAssetIdentity>(identity: MarkSchemePaperIdentity, candidates: readonly T[]) {
  const matching = candidates.filter((asset) => asset.kind === "mark_scheme"
    && asset.boardCode === identity.boardCode
    && asset.subjectSlug === identity.subjectSlug
    && asset.paperCode === identity.paperCode
    && asset.year === identity.year
    && sessionsMatch(asset.session, identity.session));
  const exactTier = matching.filter((asset) => asset.tier === identity.tier);
  if (exactTier.length === 1) return { status: "found" as const, asset: exactTier[0] };
  if (exactTier.length > 1) return { status: "ambiguous" as const };
  const untiered = matching.filter((asset) => !asset.tier || asset.tier === "none");
  if (untiered.length === 1) return { status: "found" as const, asset: untiered[0] };
  if (untiered.length > 1) return { status: "ambiguous" as const };
  return { status: "not-found" as const };
}

export function collectedPagesMatchUnit(unit: MarkableUnit, pages: CachedPdfPage[]) {
  const sourceText = normalizeMarkSchemeText(pages.map((page) => page.text).join(" "));
  if (!sourceText) return false;

  if (unit.subjectSlug === "english-language") {
    const questionNumbers = new Set(unit.parts.map((part) => normalizeQuestionNumber(part.questionNumber)));
    return Array.from(questionNumbers).every((questionNumber) => new RegExp(`\\b0?${questionNumber}\\b`).test(sourceText));
  }

  if (unit.boardCode === "edexcel" && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug)) {
    if (unit.parts.length >= 2) return splitMarkSchemePagesByParts(unit, pages) !== null;
    return pages.some((page) => detectEdexcelScienceQuestionStart(page, unit.questionNumber));
  }

  return true;
}

export function getOwnedOcrQuestionNumbers(unit: Pick<MarkableUnit, "questionNumber" | "parts">) {
  const numbers = new Set(unit.parts.map((part) => normalizeQuestionNumber(part.questionNumber)));
  numbers.add(normalizeQuestionNumber(unit.questionNumber));
  for (const part of unit.parts) {
    for (const match of part.promptText.matchAll(/\[\s*\d+\s*(?:marks?)?\s*\]\s+(\d{1,2})\s*\*?\s+(?=[A-Z])/gi)) {
      numbers.add(normalizeQuestionNumber(match[1]));
    }
  }
  return numbers;
}

function requireMatchingCollectedPages(unit: MarkableUnit, pages: CachedPdfPage[]) {
  if (pages.length === 0 || !collectedPagesMatchUnit(unit, pages)) {
    throw new Error(`Collected mark scheme pages did not match question ${normalizeQuestionNumber(unit.questionNumber)}`);
  }
  return pages;
}

export type LocatedMarkScheme = {
  markSchemeAsset: Awaited<ReturnType<typeof getPaperAssetsByBoardSubjectFromConvex>>[number];
  collectedPages: CachedPdfPage[];
};

function isMarkSchemeFurniturePage(text: string) {
  if (/Modifications to the mark scheme for Modified Large Print/i.test(text)) return true;
  const normalized = normalizeMarkSchemeText(text);
  if (normalized.length < 250 && /Pearson Education Limited/i.test(normalized) && /Registered company number/i.test(normalized)) return true;
  return false;
}

function hasOtherQuestionLabel(text: string, targetQuestionNumber: string) {
  for (const match of text.matchAll(/\bQ\s?(\d{1,2})\b/g)) {
    if (normalizeQuestionNumber(match[1]) !== targetQuestionNumber) return true;
  }
  return false;
}

export async function locateMarkSchemePagesForUnit(unit: MarkableUnit): Promise<LocatedMarkScheme> {
  const paperAssets = await getPaperAssets(unit.boardCode, unit.subjectSlug);
  const targetTier = inferTierFromSourceRelativePath(unit.sourceRelativePath);
  const resolvedAsset = resolveMarkSchemeAsset({
    boardCode: unit.boardCode,
    subjectSlug: unit.subjectSlug,
    paperCode: unit.paperCode,
    year: unit.year,
    session: unit.session,
    tier: targetTier,
  }, paperAssets);
  if (resolvedAsset.status === "ambiguous") throw new Error(`Ambiguous mark scheme assets found for ${unit.paperCode} ${unit.year ?? ""} ${unit.session ?? ""}`.trim());
  if (resolvedAsset.status === "not-found") throw new Error(`No unique mark scheme asset found for ${unit.paperCode} ${unit.year ?? ""} ${unit.session ?? ""}`.trim());
  const markSchemeAsset = resolvedAsset.asset;

  const pages = await loadMarkSchemeTextPages(markSchemeAsset.relativePath, markSchemeAsset.cdnUrl);
  if (!markSchemeDocumentMatchesUnitIdentity(unit, pages)) {
    throw new Error(`Mark scheme document identity did not match ${unit.subjectSlug}`);
  }
  const targetQuestionNumber = normalizeQuestionNumber(unit.questionNumber);
  const isEdexcelScience = unit.boardCode === "edexcel" && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug);
  const ownedOcrQuestionNumbers = unit.subjectSlug === "computer-science" ? getOwnedOcrQuestionNumbers(unit) : null;
  if (unit.boardCode === "aqa" && (unit.subjectSlug === "business" || unit.subjectSlug === "geography")) {
    const narrowedPages = narrowFallbackMarkSchemePages(unit, pages);
    if (narrowedPages.length > 0) return { markSchemeAsset, collectedPages: requireMatchingCollectedPages(unit, trimMixedQuestionPages(unit, narrowedPages)) };
  }
  const collectedPages: CachedPdfPage[] = [];
  let collecting = false;

  for (const page of pages) {
    const pageQuestionNumber = detectPageQuestionNumber(page);
    const hasTargetStart = pageHasQuestionStart(page, targetQuestionNumber)
      || (isEdexcelScience && detectEdexcelScienceQuestionStart(page, targetQuestionNumber));
    if (!collecting) {
      const hasSubjectSpecificStart = unit.subjectSlug === "computer-science" && detectOcrComputerScienceQuestionStart(page, targetQuestionNumber);
      if (pageQuestionNumber === targetQuestionNumber || hasTargetStart || hasSubjectSpecificStart) {
        collecting = true;
        collectedPages.push(page);
      }
      continue;
    }

    const ocrQuestionNumbers = unit.subjectSlug === "computer-science" ? detectOcrComputerScienceQuestionNumbers(page) : [];
    const hasOwnedOcrQuestion = ownedOcrQuestionNumbers
      ? ocrQuestionNumbers.some((questionNumber) => ownedOcrQuestionNumbers.has(questionNumber))
      : false;
    const hasOtherSubjectQuestion = ownedOcrQuestionNumbers
      ? ocrQuestionNumbers.some((questionNumber) => !ownedOcrQuestionNumbers.has(questionNumber))
      : false;
    if (unit.subjectSlug === "computer-science" && !/\bMark Scheme\b/i.test(page.text)) {
      break;
    }
    if ((pageQuestionNumber && pageQuestionNumber !== targetQuestionNumber && !hasTargetStart) || (unit.subjectSlug === "computer-science" && hasOtherSubjectQuestion && !hasOwnedOcrQuestion)) {
      break;
    }
    if (isMarkSchemeFurniturePage(page.text) || hasOtherQuestionLabel(page.text, targetQuestionNumber)) {
      break;
    }
    collectedPages.push(page);
  }

  if (collectedPages.length === 0 && (unit.parts.length > 1 || unit.subjectSlug !== "mathematics")) {
    const narrowedPages = narrowFallbackMarkSchemePages(unit, pages);
    if (narrowedPages.length > 0) return { markSchemeAsset, collectedPages: requireMatchingCollectedPages(unit, trimMixedQuestionPages(unit, narrowedPages)) };
    const inlinePages = narrowInlineQuestionTextPages(unit, pages);
    if (inlinePages.length > 0) return { markSchemeAsset, collectedPages: requireMatchingCollectedPages(unit, inlinePages) };
    throw new Error(`Could not isolate mark scheme pages for question ${targetQuestionNumber}`);
  }

  if (collectedPages.length === 0) {
    throw new Error(`Could not isolate mark scheme pages for question ${targetQuestionNumber}`);
  }

  return { markSchemeAsset, collectedPages: requireMatchingCollectedPages(unit, trimMixedQuestionPages(unit, collectedPages)) };
}

export type MarkSchemePdfFailure = {
  unitKey: string;
  label: string;
  error: string;
};

export type MarkSchemePdfResult = {
  bytes: Uint8Array;
  includedCount: number;
  failures: MarkSchemePdfFailure[];
};

type MarkSchemeFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type TableLayout = {
  page: PDFPage;
  y: number;
  pageNumber: number;
};

type LevelDescriptor = {
  level: string;
  marks: string;
  description: string;
};

type StructuredMarkSchemeEntry = {
  prompt: string;
  guidance: string;
  answerLetter: string | null;
  answerText: string | null;
  levels: LevelDescriptor[];
  indicativeContent: string;
};

type RenderedMarkSchemePage = CachedPdfPage & {
  unit?: MarkableUnit;
  totalRow?: boolean;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MS_LEFT = 46;
const MS_RIGHT = 549;
const MS_TOP = 760;
const MS_BOTTOM = 58;
const MS_QUESTION_W = 58;
const MS_PART_W = 44;
const MS_MARKS_W = 52;
const MS_GUIDANCE_W = MS_RIGHT - MS_LEFT - MS_QUESTION_W - MS_PART_W - MS_MARKS_W;
const LANDSCAPE_WIDTH = A4_HEIGHT;
const LANDSCAPE_HEIGHT = A4_WIDTH;

function formatSourceLabel(unit: MarkableUnit) {
  return [unit.paperCode, unit.year, unit.session].filter(Boolean).join(" ");
}

function titleCaseSlug(value: string) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

const MS_BOARD_LABELS: Record<string, string> = { aqa: "AQA", edexcel: "Edexcel", ocr: "OCR" };

function formatUnitLabel(unit: MarkableUnit, order: number) {
  const board = MS_BOARD_LABELS[unit.boardCode] ?? titleCaseSlug(unit.boardCode);
  const paper = titleCaseSlug([unit.subjectSlug, unit.paperCode].filter(Boolean).join(" "));
  const session = unit.session && unit.session !== "unknown" ? titleCaseSlug(unit.session) : null;
  const when = [session, unit.year].filter(Boolean).join(" ");
  const sourceQuestion = normalizeQuestionNumber(unit.questionNumber);
  const sourceRef = sourceQuestion ? ` · source Q${sourceQuestion}` : "";
  return `Question ${order} — ${board} ${paper}${when ? `, ${when}` : ""}${sourceRef}`;
}

// A page hosting several regions lists each question compactly — the full
// board/paper/session string would overflow the label band.
function joinedRegionLabel(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return labels.map((label) => {
    const question = label.match(/^Question \d+/);
    const source = label.match(/ · source Q\S+/);
    return `${question?.[0] ?? label}${source?.[0] ?? ""}`;
  }).join(" / ");
}

// pdf-lib standard fonts encode via WinAnsi: ASCII + Latin-1 supplement + this
// extra block (OE, smart quotes, dashes, bullets, euro, trademark, ...).
const WINANSI_EXTRA = "ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™";
const NON_WINANSI_PATTERN = new RegExp(`[^\\x09\\x0A\\x0D\\x20-\\x7E\\xA0-\\xFF${WINANSI_EXTRA}]`, "g");

function safePdfText(text: string) {
  return text
    .replace(/[−]/g, "-")
    .replace(/[→⇒]/g, "->")
    .replace(/[←⇐]/g, "<-")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[α]/gi, "alpha")
    .replace(/[β]/gi, "beta")
    .replace(/[γ]/gi, "gamma")
    .replace(NON_WINANSI_PATTERN, " ");
}

type SelectedAnswerRegionInput = {
  unitKey: string;
  assetPath: string;
  page: CachedPdfPage;
};

export type SelectedAnswerRegion = {
  assetPath: string;
  sourcePageNumber: number;
  top: number;
  bottom: number;
  unitKeys: string[];
};

export function planSelectedAnswerRegions(inputs: SelectedAnswerRegionInput[]) {
  const regions = new Map<string, SelectedAnswerRegion>();
  for (const { unitKey, assetPath, page } of inputs) {
    const sourcePageNumber = page.sourcePageNumber ?? page.pageNumber;
    // Untrimmed pages (a unit's tail page with no question start) fall back to
    // whole-page line extents — publisher/copyright lines must not anchor them.
    const boundLines = page.lines.filter((line) => !isMarkSchemeFooterLine(line));
    // A page with no content lines and no explicit bounds (a footer-only tail,
    // or a selection that emptied) contributes no region — without this, empty
    // bounds widen to a full-page crop.
    if (boundLines.length === 0 && page.regionTop === undefined) continue;
    const top = page.regionTop ?? Math.min(page.pageHeight ?? Infinity, Math.max(...boundLines.map((line) => line.y)) + 8);
    const nextBottom = page.regionNextBottom;
    const bottom = Math.min(
      page.regionBottom ?? Math.max(0, Math.min(...boundLines.map((line) => line.y)) - 8),
      nextBottom ?? Infinity,
    );
    if (sourcePageNumber < 1 || top === undefined || bottom === undefined || !Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) continue;
    const key = `${assetPath}:${sourcePageNumber}:${top}:${bottom}`;
    const existing = regions.get(key);
    if (existing) {
      existing.unitKeys.push(unitKey);
    } else {
      regions.set(key, { assetPath, sourcePageNumber, top, bottom, unitKeys: [unitKey] });
    }
  }
  return Array.from(regions.values());
}

async function renderAndValidateAnswerRegion(pdfJsDoc: PdfJsDocument, region: SelectedAnswerRegion, pageWidth: number, pageHeight: number) {
  const scale = 2;
  const png = await renderPdfPageToPng(pdfJsDoc, region.sourcePageNumber, scale);
  const image = await loadImage(png);
  const sourceScaleY = image.height / pageHeight;
  const sourceX = 0;
  const sourceWidth = image.width;
  const rawTop = Math.max(0, Math.floor((pageHeight - region.top) * sourceScaleY));
  const rawBottom = Math.min(image.height, Math.ceil((pageHeight - region.bottom) * sourceScaleY));
  if (sourceWidth < 1 || rawBottom - rawTop < 1) throw new Error("Selected mark scheme answer region was empty.");

  const sourceCanvas = createCanvas(sourceWidth, image.height);
  const sourceContext = sourceCanvas.getContext("2d");
  sourceContext.drawImage(image, 0, 0);
  // Snap each crop edge to a near-white row so no neighbouring glyph is sliced.
  // Direction matters: a bound inside heavy ink means the edge landed within a
  // row, so snap away from the selection — top goes up, bottom goes down. A
  // bound on light ink is a neighbouring sliver, so snap toward the selection
  // through light rows only, falling back if a heavy row is reached first.
  const rowInk = (y: number) => {
    const data = sourceContext.getImageData(0, y, sourceWidth, 1).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 235 || data[index + 1] < 235 || data[index + 2] < 235) dark += 1;
    }
    return dark / sourceWidth;
  };
  const WHITE_INK = 0.01;
  const HEAVY_INK = 0.05;
  const snapWindow = Math.ceil(16 * sourceScaleY);
  const findWhiteUp = (from: number, limit: number) => {
    for (let y = from; y >= limit; y -= 1) if (rowInk(y) < WHITE_INK) return y;
    return -1;
  };
  const findWhiteDown = (from: number, limit: number) => {
    for (let y = from; y <= limit; y += 1) if (rowInk(y) < WHITE_INK) return y;
    return -1;
  };

  let sourceY = rawTop;
  const topInk = rowInk(rawTop);
  if (topInk >= WHITE_INK) {
    let snapped = -1;
    if (topInk >= HEAVY_INK) {
      snapped = findWhiteUp(rawTop - 1, Math.max(0, rawTop - snapWindow));
    } else {
      for (let y = rawTop + 1; y < Math.min(rawTop + snapWindow, rawBottom); y += 1) {
        const ink = rowInk(y);
        if (ink < WHITE_INK) { snapped = y; break; }
        if (ink >= HEAVY_INK) break;
      }
      if (snapped < 0) snapped = findWhiteUp(rawTop - 1, Math.max(0, rawTop - snapWindow));
    }
    if (snapped >= 0) sourceY = snapped;
  }

  let sourceBottom = rawBottom;
  const bottomInk = rawBottom - 1 > sourceY ? rowInk(rawBottom - 1) : 0;
  if (bottomInk >= WHITE_INK) {
    let snapped = -1;
    if (bottomInk >= HEAVY_INK) {
      const up = findWhiteUp(rawBottom - 2, Math.max(sourceY, rawBottom - snapWindow));
      if (up >= 0) snapped = up + 1;
    } else {
      for (let y = rawBottom - 2; y > Math.max(sourceY, rawBottom - snapWindow); y -= 1) {
        const ink = rowInk(y);
        if (ink < WHITE_INK) { snapped = y + 1; break; }
        if (ink >= HEAVY_INK) break;
      }
      if (snapped < 0) {
        const down = findWhiteDown(rawBottom, Math.min(image.height - 1, rawBottom + snapWindow));
        if (down >= 0) snapped = down;
      }
    }
    if (snapped > sourceY) sourceBottom = snapped;
  }
  const sourceHeight = sourceBottom - sourceY;
  if (sourceHeight < 1) throw new Error("Selected mark scheme answer region was empty.");

  const canvas = createCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");
  context.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  context.fillStyle = "#fff";
  // Header/footer bands only mask page furniture — apply them only when the
  // region actually reaches the page edge, otherwise they eat real rows.
  const headerBandHeight = Math.ceil(28 * sourceScaleY);
  const footerBandHeight = Math.ceil(18 * sourceScaleY);
  const reachesPageTop = region.top >= pageHeight - 50;
  const reachesPageBottom = region.bottom <= 50;
  if (reachesPageTop && sourceHeight > headerBandHeight) {
    context.fillRect(0, 0, sourceWidth, headerBandHeight);
  }
  if (reachesPageBottom && sourceHeight > headerBandHeight + footerBandHeight) {
    context.fillRect(0, sourceHeight - footerBandHeight, sourceWidth, footerBandHeight);
  }
  const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
  let ink = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) ink += 1;
  }
  if (ink < 20) throw new Error("Selected mark scheme answer region contained no visible answer content.");
  return canvas.toBuffer("image/png");
}

const MS_REGION_MARGIN = 30;
const MS_REGION_LABEL_BAND = 18;
const MS_REGION_PACK_GAP = 10;

async function measureSelectedAnswerRegionHeight(pdfJsDoc: PdfJsDocument, region: SelectedAnswerRegion) {
  const pdfJsPage = await pdfJsDoc.getPage(region.sourcePageNumber);
  const viewport = pdfJsPage.getViewport({ scale: 1 });
  const regionHeight = Math.min(viewport.height, region.top) - Math.max(0, region.bottom);
  const scale = Math.min(1,
    (LANDSCAPE_WIDTH - MS_REGION_MARGIN * 2) / viewport.width,
    (LANDSCAPE_HEIGHT - MS_REGION_MARGIN * 2 - MS_REGION_LABEL_BAND) / regionHeight);
  return regionHeight * scale;
}

async function renderSelectedAnswerRegionImage(
  outputDoc: PDFDocument,
  pdfJsDoc: PdfJsDocument,
  region: SelectedAnswerRegion,
) {
  const pdfJsPage = await pdfJsDoc.getPage(region.sourcePageNumber);
  const viewport = pdfJsPage.getViewport({ scale: 1 });
  const top = Math.min(viewport.height, region.top);
  const bottom = Math.max(0, region.bottom);
  if (top <= bottom) throw new Error("Selected mark scheme answer boundaries were invalid.");
  const validatedPng = await renderAndValidateAnswerRegion(pdfJsDoc, { ...region, top, bottom }, viewport.width, viewport.height);
  const regionHeight = top - bottom;
  const image = await outputDoc.embedPng(validatedPng);
  const availableWidth = LANDSCAPE_WIDTH - MS_REGION_MARGIN * 2;
  const availableHeight = LANDSCAPE_HEIGHT - MS_REGION_MARGIN * 2 - MS_REGION_LABEL_BAND;
  const imageScale = Math.min(1, availableWidth / viewport.width, availableHeight / regionHeight);
  return { image, width: viewport.width * imageScale, height: regionHeight * imageScale };
}

function placeSelectedAnswerRegion(
  outputDoc: PDFDocument,
  rendered: Awaited<ReturnType<typeof renderSelectedAnswerRegionImage>>,
  label: string,
  labelFont: PDFFont,
) {
  const page = outputDoc.addPage([LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT]);
  const topBound = LANDSCAPE_HEIGHT - MS_REGION_MARGIN - MS_REGION_LABEL_BAND;
  page.drawImage(rendered.image, {
    x: (LANDSCAPE_WIDTH - rendered.width) / 2,
    y: topBound - rendered.height,
    width: rendered.width,
    height: rendered.height,
  });
  drawLabelBand(page, label, labelFont);
  return { page, bottomY: topBound - rendered.height };
}

// Pack regions beneath the previous one instead of stranding a lone row or a
// near-full excerpt on its own page. A mild shrink (≥0.9) is invisible; a
// short tail may shrink further (a "Total for question N" row at 0.65 is
// still readable).
export function regionPacksBelow(renderedHeight: number, availableSpace: number) {
  if (availableSpace <= 0) return false;
  const scale = Math.min(1, availableSpace / renderedHeight);
  return scale >= 0.9 || (renderedHeight <= 140 && scale >= 0.65);
}

export async function drawSelectedAnswerRegion(
  outputDoc: PDFDocument,
  pdfJsDoc: PdfJsDocument,
  region: SelectedAnswerRegion,
  label: string,
  labelFont: PDFFont,
) {
  const rendered = await renderSelectedAnswerRegionImage(outputDoc, pdfJsDoc, region);
  return placeSelectedAnswerRegion(outputDoc, rendered, label, labelFont);
}

export async function assembleMarkSchemePdf(units: MarkableUnit[], options?: { revisionPaperCode?: string }): Promise<MarkSchemePdfResult> {
  const outputDoc = await PDFDocument.create({ updateMetadata: false });
  outputDoc.setTitle("GCSE Mark Scheme");
  const [labelFont, noteFont] = await Promise.all([
    outputDoc.embedFont(StandardFonts.HelveticaBold),
    outputDoc.embedFont(StandardFonts.Helvetica),
  ]);
  const fonts = { regular: noteFont, bold: labelFont } satisfies MarkSchemeFonts;
  const srcDocCache = new Map<string, PDFDocument | null>();
  const pdfJsDocCache = new Map<string, PdfJsDocument>();
  const failures: MarkSchemePdfFailure[] = [];

  drawMarkSchemeCoverPage(outputDoc, units, fonts, options?.revisionPaperCode);

  let tableLayout: TableLayout | null = null;

  let includedCount = 0;
  const emittedAnswerRegions = new Map<string, { page: PDFPage; labels: string[] }>();
  let packableRegionPage: { page: PDFPage; bottomY: number; labels: string[] } | null = null;

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const order = index + 1;
    const label = formatUnitLabel(unit, order);

    try {
      const { markSchemeAsset, collectedPages } = await locateMarkSchemePagesForUnit(unit);

      let srcDoc = srcDocCache.get(markSchemeAsset.relativePath);
      if (!srcDocCache.has(markSchemeAsset.relativePath)) {
        const bytes = await loadMarkSchemeBytes(markSchemeAsset.relativePath, markSchemeAsset.cdnUrl);
        srcDoc = await PDFDocument.load(bytes.slice(), {
          ignoreEncryption: true,
          throwOnInvalidObject: unit.boardCode === "aqa",
        }).catch(() => null);
        srcDocCache.set(markSchemeAsset.relativePath, srcDoc);
      }

      let drewLabel = false;
      let copiedPages = 0;
      let fallbackSegmentIndex = 0;
      const groupedPages = unit.boardCode === "aqa" && unit.subjectSlug === "geography"
        ? collectedPages.reduce<CachedPdfPage[]>((pages, page) => {
          const previous = pages.at(-1);
          if (page.pageNumber < 1 && previous && previous.pageNumber < 1) {
            previous.text = `${previous.text}\n${page.text}`;
          } else {
            pages.push({ ...page });
          }
          return pages;
        }, [])
        : collectedPages;
      const isEdexcelScience = unit.boardCode === "edexcel"
        && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug);
      const preserveSourceAnswerRegion = isEdexcelScience
        || unit.subjectSlug === "mathematics"
        || unit.subjectSlug === "computer-science"
        || unit.subjectSlug === "english-language"
        || unit.subjectSlug === "english-literature"
        || unit.subjectSlug === "french";
      if (preserveSourceAnswerRegion) {
        let pdfJsDoc = pdfJsDocCache.get(markSchemeAsset.relativePath);
        if (!pdfJsDoc) {
          const bytes = await loadMarkSchemeBytes(markSchemeAsset.relativePath, markSchemeAsset.cdnUrl);
          pdfJsDoc = await getPdfDocument(bytes.slice());
          pdfJsDocCache.set(markSchemeAsset.relativePath, pdfJsDoc);
        }
        const answerPages = groupedPages.filter((page) => normalizeInlineText(page.text.replace(/\bPMT\b/gi, "")).length >= 10);
        const regions = planSelectedAnswerRegions(answerPages.map((page) => ({
          unitKey: unit.unitKey,
          assetPath: markSchemeAsset.relativePath,
          page,
        })));
        const softRegionFallback = ["english-language", "english-literature", "french"].includes(unit.subjectSlug);
        if (regions.length === 0 && !softRegionFallback) throw new Error("Could not establish selected mark scheme answer boundaries.");
        if (regions.length > 0) {
          tableLayout = null;
          for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
            const region = regions[regionIndex];
            const key = `${region.assetPath}:${region.sourcePageNumber}:${region.top}:${region.bottom}`;
            const emitted = emittedAnswerRegions.get(key);
            if (emitted) {
              emitted.labels.push(label);
              drawLabelBand(emitted.page, joinedRegionLabel(emitted.labels), labelFont);
              continue;
            }
            const rendered = await renderSelectedAnswerRegionImage(outputDoc, pdfJsDoc, region);
            const packSpace = packableRegionPage ? packableRegionPage.bottomY - MS_REGION_MARGIN - MS_REGION_PACK_GAP : 0;
            const packScale = Math.min(1, packSpace / rendered.height);
            if (packableRegionPage && regionPacksBelow(rendered.height, packSpace)) {
              const packWidth = rendered.width * packScale;
              const packHeight = rendered.height * packScale;
              packableRegionPage.bottomY -= MS_REGION_PACK_GAP + packHeight;
              packableRegionPage.page.drawImage(rendered.image, {
                x: (LANDSCAPE_WIDTH - packWidth) / 2,
                y: packableRegionPage.bottomY,
                width: packWidth,
                height: packHeight,
              });
              packableRegionPage.labels.push(label);
              drawLabelBand(packableRegionPage.page, joinedRegionLabel([...new Set(packableRegionPage.labels)]), labelFont);
              emittedAnswerRegions.set(key, { page: packableRegionPage.page, labels: packableRegionPage.labels });
              continue;
            }
            // If this unit's next region is a short tail that would just miss
            // packing beneath this one, shrink this region slightly to make
            // room — a stranded one-row page reads worse than a marginally
            // smaller excerpt.
            let drawn = rendered;
            const nextRegion = regions[regionIndex + 1];
            if (nextRegion && !emittedAnswerRegions.has(`${nextRegion.assetPath}:${nextRegion.sourcePageNumber}:${nextRegion.top}:${nextRegion.bottom}`)) {
              const tailHeight = await measureSelectedAnswerRegionHeight(pdfJsDoc, nextRegion);
              const capacity = LANDSCAPE_HEIGHT - MS_REGION_MARGIN * 2 - MS_REGION_LABEL_BAND;
              const squeeze = (capacity - MS_REGION_PACK_GAP - tailHeight) / rendered.height;
              if (tailHeight <= 140 && squeeze < 1 && squeeze >= 0.75) {
                drawn = { ...rendered, width: rendered.width * squeeze, height: rendered.height * squeeze };
              }
            }
            const placed = placeSelectedAnswerRegion(outputDoc, drawn, label, labelFont);
            const labels = [label];
            packableRegionPage = { page: placed.page, bottomY: placed.bottomY, labels };
            emittedAnswerRegions.set(key, { page: placed.page, labels });
          }
          includedCount += 1;
          continue;
        }
        // soft-fallback subjects: no usable region — fall through to the structured path.
      }
      packableRegionPage = null;
      const splitPages = splitMarkSchemePagesByParts(unit, groupedPages);
      const isMultipartUnit = unit.parts.filter((part) => (part.marks ?? 0) > 0).length > 1
        && unit.parts.every((part) => (part.marks ?? 0) === 0 || (part.questionPartNumber && normalizeQuestionNumber(part.questionNumber) === normalizeQuestionNumber(unit.questionNumber)));
      if (isMultipartUnit && !splitPages) {
        throw new Error(`Could not split mark scheme guidance for multipart question ${unit.questionNumber}.`);
      }
      const renderedPages: RenderedMarkSchemePage[] = splitPages
        ?? (unit.subjectSlug === "french" && groupedPages.length > 0
          ? [{ ...groupedPages[0], pageNumber: 0, text: groupedPages.map((page) => page.text).join("\n"), lines: [] }]
          : groupedPages);
      for (const page of renderedPages) {
        const rowUnit = page.unit ?? unit;
        if (page.pageNumber > 0 && normalizeInlineText(page.text).length < 120 && !pageHasQuestionStart(page, normalizeQuestionNumber(rowUnit.questionNumber))) continue;
        if (page.pageNumber < 1 || rowUnit.subjectSlug === "mathematics" || rowUnit.subjectSlug === "business" || rowUnit.subjectSlug === "computer-science" || rowUnit.subjectSlug === "french") {
          tableLayout = drawMarkSchemeTableRow(outputDoc, tableLayout, {
            unit: rowUnit,
            order,
            text: page.text,
            lines: page.lines,
            continuation: page.unit ? false : fallbackSegmentIndex > 0,
            totalRow: page.totalRow,
          }, fonts);
          fallbackSegmentIndex += 1;
          copiedPages += 1;
          drewLabel = true;
          continue;
        }

        let addedPages: import("pdf-lib").PDFPage[] | null = null;
        tableLayout = null;
        if (srcDoc) try {
          const [copied] = await outputDoc.copyPages(srcDoc, [page.pageNumber - 1]);
          addedPages = [outputDoc.addPage(copied)];
        } catch {
          addedPages = null;
        }
        if (!addedPages) try {
          let pdfJsDoc = pdfJsDocCache.get(markSchemeAsset.relativePath);
          if (!pdfJsDoc) {
            const bytes = await loadMarkSchemeBytes(markSchemeAsset.relativePath, markSchemeAsset.cdnUrl);
            pdfJsDoc = await getPdfDocument(bytes.slice());
            pdfJsDocCache.set(markSchemeAsset.relativePath, pdfJsDoc);
          }
          const png = await renderPdfPageToPng(pdfJsDoc, page.pageNumber, 2);
          const image = await outputDoc.embedPng(png);
          const added = outputDoc.addPage([image.width / 2, image.height / 2]);
          added.drawImage(image, { x: 0, y: 0, width: image.width / 2, height: image.height / 2 });
          addedPages = [added];
        } catch {
          addedPages = drawTextFallbackPages(outputDoc, page.text, noteFont);
        }
        copiedPages += addedPages.length;
        for (const added of addedPages) {
          if (!drewLabel) {
            drawLabelBand(added, label, labelFont);
            drewLabel = true;
          }
        }
      }

      if (copiedPages === 0) {
        throw new Error("Located mark scheme pages were outside the source PDF page range.");
      }
      includedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        unitKey: unit.unitKey,
        label,
        error: message,
      });
      tableLayout = null;
    }
  }

  if (failures.length > 0 || includedCount !== units.length) return { bytes: new Uint8Array(), includedCount, failures };

  const bytes = await outputDoc.save();
  return { bytes, includedCount, failures };
}

function drawMarkSchemeCoverPage(outputDoc: PDFDocument, units: MarkableUnit[], fonts: MarkSchemeFonts, revisionPaperCode?: string) {
  const page = outputDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const first = units[0];
  const board = MS_BOARD_LABELS[first?.boardCode ?? ""] ?? (first ? titleCaseSlug(first.boardCode) : "GCSE");
  const subject = first ? titleCaseSlug(first.subjectSlug) : "Mark scheme";
  const paperCodes = new Set(units.map((unit) => unit.paperCode));
  const paper = paperCodes.size === 1 ? titleCaseSlug(Array.from(paperCodes)[0]) : "custom paper";
  const tier = first ? inferTierFromSourceRelativePath(first.sourceRelativePath) : "none";
  const tierLabel = tier === "none" ? null : `${titleCaseSlug(tier)} tier`;
  const marks = units.reduce((sum, unit) => sum + unit.totalMarks, 0);
  const questionCount = units.reduce((count, unit) => {
    if (unit.subjectSlug !== "english-language" || unit.sectionCode !== "A") return count + 1;
    return count + new Set(unit.parts.map((part) => part.questionNumber)).size;
  }, 0);
  const sourceCount = new Set(units.map((unit) => formatSourceLabel(unit))).size;

  const NAVY = rgb(0.055, 0.11, 0.24);
  const BLUE = rgb(0.278, 0.278, 0.847);
  const MINT = rgb(0.451, 0.91, 0.765);
  const RULE = rgb(0.1, 0.15, 0.3);
  const MUTED = rgb(0.32, 0.36, 0.45);
  const LEFT = 48;
  const RIGHT = A4_WIDTH - 48;
  const CONTENT_WIDTH = RIGHT - LEFT;

  page.drawRectangle({ x: 24, y: 821, width: A4_WIDTH - 56, height: 5, color: BLUE });
  page.drawRectangle({ x: A4_WIDTH - 32, y: 821, width: 8, height: 5, color: MINT });

  page.drawSvgPath("M 1 5 L 17 1 L 22 27 L 6 31 Z", { x: LEFT, y: 795, scale: 1, color: NAVY });
  page.drawSvgPath("M 6 7 L 23 4 L 27 30 L 10 33 Z", { x: LEFT, y: 795, scale: 1, color: BLUE });
  page.drawSvgPath("M 11 19 L 15 23 L 23 12 L 25 14 L 15 27 L 9 21 Z", { x: LEFT, y: 795, scale: 1, color: rgb(1, 1, 1) });
  page.drawText("Revise with the Past", { x: LEFT + 34, y: 780, size: 18, font: fonts.bold, color: NAVY });
  const code = revisionPaperCode ?? `RWTP-MS-${String(units.length).padStart(2, "0")}PAPER`;
  const codeWidth = fonts.bold.widthOfTextAtSize(code, 8.2);
  const typeWidth = fonts.regular.widthOfTextAtSize("MARK SCHEME", 8.2);
  page.drawText(code, { x: RIGHT - codeWidth, y: 786, size: 8.2, font: fonts.bold, color: NAVY });
  page.drawText("MARK SCHEME", { x: RIGHT - typeWidth, y: 773, size: 8.2, font: fonts.regular, color: NAVY });
  page.drawLine({ start: { x: LEFT, y: 748 }, end: { x: RIGHT, y: 748 }, thickness: 1, color: RULE });

  const identity = `${board} GCSE ${subject}${tierLabel ? ` · ${tierLabel}` : ""}`.toUpperCase();
  const identityWidth = fonts.bold.widthOfTextAtSize(identity, 11);
  page.drawText(identity.length > 64 ? `${identity.slice(0, 61)}...` : identity, { x: LEFT, y: 716, size: Math.min(11, 11 * CONTENT_WIDTH / Math.max(identityWidth, 1)), font: fonts.bold, color: BLUE });
  page.drawText("Mark scheme", { x: LEFT, y: 665, size: 32, font: fonts.bold, color: NAVY });

  page.drawLine({ start: { x: LEFT, y: 625 }, end: { x: RIGHT, y: 625 }, thickness: 1, color: RULE });
  page.drawLine({ start: { x: LEFT, y: 567 }, end: { x: RIGHT, y: 567 }, thickness: 1, color: RULE });
  const facts = [
    [String(marks), "MARKS"],
    [String(questionCount), questionCount === 1 ? "QUESTION" : "QUESTIONS"],
    [String(sourceCount), sourceCount === 1 ? "SOURCE PAPER" : "SOURCE PAPERS"],
  ];
  const factWidth = CONTENT_WIDTH / facts.length;
  facts.forEach(([value, label], index) => {
    const center = LEFT + factWidth * index + factWidth / 2;
    const valueWidth = fonts.bold.widthOfTextAtSize(value, 22);
    const labelWidth = fonts.bold.widthOfTextAtSize(label, 8.5);
    page.drawText(value, { x: center - valueWidth / 2, y: 595, size: 22, font: fonts.bold, color: BLUE });
    page.drawText(label, { x: center - labelWidth / 2, y: 579, size: 8.5, font: fonts.bold, color: NAVY });
    if (index < facts.length - 1) page.drawLine({ start: { x: LEFT + factWidth * (index + 1), y: 573 }, end: { x: LEFT + factWidth * (index + 1), y: 619 }, thickness: 0.8, color: RULE });
  });

  page.drawText("How to use this mark scheme", { x: LEFT, y: 520, size: 14, font: fonts.bold, color: NAVY });
  const notes = [
    `This mark scheme covers only the ${questionCount} question${questionCount === 1 ? "" : "s"} selected for the paired practice paper (${paper}).`,
    "Each question band shows the generated question number and the source paper it was taken from.",
    "Award marks exactly as shown; alternative correct responses earn equivalent credit.",
  ];
  let noteY = 496;
  for (const note of notes) {
    page.drawText("•", { x: LEFT, y: noteY, size: 9, font: fonts.regular, color: NAVY });
    page.drawText(note, { x: LEFT + 12, y: noteY, size: 9, font: fonts.regular, color: NAVY });
    noteY -= 16;
  }

  page.drawLine({ start: { x: LEFT, y: 86 }, end: { x: RIGHT, y: 86 }, thickness: 2.4, color: BLUE });
  const turnText = "MARK AGAINST THE SCHEME THAT MATCHES EACH QUESTION";
  const turnWidth = fonts.bold.widthOfTextAtSize(turnText, 8.5);
  page.drawText(turnText, { x: LEFT + (CONTENT_WIDTH - turnWidth) / 2, y: 67, size: 8.5, font: fonts.bold, color: NAVY });
  const footerCodeWidth = fonts.regular.widthOfTextAtSize(code, 8.5);
  page.drawText(code, { x: RIGHT - footerCodeWidth, y: 42, size: 8.5, font: fonts.regular, color: MUTED });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safePdfText(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Matches on a whitespace-free lowercase stream so pdf.js artefacts (kerned
// words split into "iden tify", soft hyphens) cannot break the match, while
// still slicing the original text at the mapped position.
function compactWithIndex(text: string) {
  let compact = "";
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char) || char === "\u00AD") continue;
    map.push(index);
    compact += char.toLowerCase();
  }
  return { compact, map };
}

export function stripMatchedPrompt(text: string, prompt: string, prefixLength: number) {
  if (!prompt) return text;
  const haystack = compactWithIndex(text);
  const needle = compactWithIndex(prompt).compact;
  const cutAfter = (compactIndex: number) => text.slice(haystack.map[compactIndex] + 1).replace(/^[\s.,;:)\]]+/, "").trim();
  const fullIndex = haystack.compact.indexOf(needle);
  if (fullIndex >= 0) return cutAfter(fullIndex + needle.length - 1);
  const prefix = compactWithIndex(prompt.slice(0, prefixLength)).compact;
  const prefixIndex = haystack.compact.indexOf(prefix);
  if (prefixIndex < 0) return text;
  let matchedLength = prefix.length;
  while (
    prefixIndex + matchedLength < haystack.compact.length
    && matchedLength < needle.length
    && haystack.compact[prefixIndex + matchedLength] === needle[matchedLength]
  ) {
    matchedLength += 1;
  }
  return cutAfter(prefixIndex + matchedLength - 1);
}

function cleanFallbackGuidance(text: string, unit: MarkableUnit) {
  let guidance = stripSourceFurnitureText(safePdfText(text))
    .replace(/\bPMT\b/g, " ")
    .replace(/\(\s*(?:Source|Adapted)\s*:[^)]*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bMARK SCHEME\s*[-–—]\s*GCSE\s+[^\n]+?\s*[-–—]\s*(?:JUNE|NOVEMBER)\s+\d{4}\b/gi, " ")
    .replace(/\bQuestion\s+Answer(?:\s+Additional\s+guidance)?\s+Mark\s+number\b/gi, " ")
    .replace(/\(?\bTotal\s+for\s+(?:the\s+)?question\s+\d+\s*(?:=|is)?\s*\d+\s*marks?\)?/gi, " ")
    .replace(/\bAO(\d)\s+([a-z])\b/gi, "AO$1$2")
    .replace(/\s+/g, " ")
    .trim();
  const question = normalizeQuestionNumber(unit.questionNumber);
  const firstPart = unit.parts[0]?.questionPartNumber?.trim();
  if (unit.subjectSlug === "french" && unit.totalMarks === 1 && firstPart && /^[a-zivx]+$/i.test(firstPart)) return `Correct answer: ${firstPart}`;
  if (firstPart) guidance = guidance.replace(new RegExp(`^0?${question}\\s+${firstPart}\\s+`, "i"), "");
  if (unit.subjectSlug === "french") {
    guidance = guidance
      .replace(/\bQuestion\s+number\s+Answer\s+Mark\b/gi, " ")
      .replace(/\bQuestion\s+number\s+Answer\s+Request\s+Mark\b/gi, " ")
      .replace(/\b\d{2}[A-Z]\d{2}\s+Question\s+Answer\s+Mark\s+Request\s+Mark\s+\d+\([^)]*\)\s*/gi, " ")
      .replace(/\b\d{2}[A-Z]\d{2}\s+Answer\s+Mark\s+\d+\([^)]*\)\s*/gi, " ");
  }
  for (const part of unit.parts) {
    const prompt = normalizeInlineText(part.promptText).slice(0, 140);
    if (!prompt) continue;
    guidance = stripMatchedPrompt(guidance, prompt, 50);
  }
  return guidance.replace(/\bAO(\d)([a-z]?)\b/gi, "AO$1$2").replace(/\s+([.,;:])/g, "$1").trim() || stripSourceFurnitureText(safePdfText(text));
}

function stripSourceFurnitureText(text: string) {
  return text
    .replace(/\bDO NOT WRITE (?:IN THIS AREA|OUTSIDE(?: THE BOX)?)/gi, " ")
    .replace(/\bTURN OVER(?: FOR THE NEXT QUESTION)?/gi, " ");
}

function cleanQuestionPrompt(unit: MarkableUnit) {
  const raw = stripSourceFurnitureText(safePdfText(normalizeInlineText(unit.parts.flatMap((part) => part.promptText ? [part.promptText] : []).join(" "))));
  let prompt = raw
    .replace(/\(\s*(?:Source|Adapted)\s*:[^)]*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^(?:Figure|Table|Graph|Chart|Extract|Map|Photo(?:graph)?)\s*[\w.]*\s+[\s\S]{0,400}?\(\s*[a-z]{1,2}\s*\)\s*(?=[A-Z0-9"'])/i, " ")
    // Flattened resource dump ("1.11 Table 1 Extract … Revenue 75 …") followed
    // by the real question that references it ("Using Table 1, calculate …").
    .replace(/^[\s\S]{0,60}?\b(?:Table|Figure|Item|Extract|Source)\s+\w+\s+[\s\S]{10,500}?(?=(?:Using|Referring\s+to|Look\s+at|Study)\s+(?:Table|Figure|Item|Extract|Source)\s+\w+\b)/i, " ")
    .replace(/\([^)]*\b(?:G|H|F|QP|Jun|June|Nov|November)\b[^)]*\)$/i, "")
    .replace(/\bQuestion\s+\d+\s+[A-Z][^0]+(?=0\s*\d\s*\.)/i, "")
    .replace(/^0\s*(\d)\s*\.\s*(\d+)/, "0 $1 . $2")
    .replace(/\s*_{4,}.*$/g, "")
    // MS-table column headers leaking into the extracted prompt tail.
    .replace(/\s+Workings\s+Answer\s*$/i, "")
    .replace(/\s+Marks?\s+for\s+this\s+question:?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const marker = prompt.match(/\b0\s*\d\s*\.\s*\d+\s+/);
  if (marker?.index !== undefined) prompt = prompt.slice(marker.index).replace(marker[0], "").trim();
  prompt = prompt.replace(/\s*\[\d+\s*marks?\]\s*/i, " ").trim();
  if (unit.totalMarks <= 1) {
    prompt = prompt.replace(/\s+[A-D]\s+.+?(?=\s*$)/, "").trim();
  }
  return prompt || raw;
}

function partMarkerPattern(unit: MarkableUnit, partNumber: string) {
  const question = normalizeQuestionNumber(unit.questionNumber);
  const escapedPart = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^\d+$/.test(partNumber)) {
    const separator = unit.boardCode === "aqa" ? "\\s*\\.\\s*" : "\\s*(?:\\.|\\s)\\s*";
    return new RegExp(`\\b0?${question}${separator}${escapedPart}\\b`, "i");
  }
  const nestedPart = `\\s*\\([a-z]\\)\\s*(?:\\(\\s*${escapedPart}\\s*\\)|${escapedPart}\\b)(?:\\s*\\*)?(?=\\s|$)`;
  const spacedNestedPart = `\\s+[a-z]\\s+(?:\\(?${escapedPart}\\)?)(?=\\s|$)`;
  const directPart = `(?:\\.|\\s+)\\s*${escapedPart}\\b|\\s*\\(\\s*${escapedPart}\\s*\\)(?:\\s*\\([ivx]+\\))?(?:\\s*\\*)?(?=\\s|$)`;
  return new RegExp(`(?:\\bQuestion\\s+|\\bQ\\s*|\\*\\s*|\\b)0?${question}(?:${escapedPart}\\b|${nestedPart}|${spacedNestedPart}|${directPart})`, "i");
}

function barePartMarkerPattern(partNumber: string) {
  const escapedPart = partNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\(\\s*${escapedPart}\\s*\\)(?:\\s*\\([ivx]+\\))?(?:\\s*\\*)?(?=\\s|$)`, "i");
}

function partPathMarkerPattern(unit: MarkableUnit, partPath: string[]) {
  const question = normalizeQuestionNumber(unit.questionNumber);
  const pathPattern = partPath.map((token) => {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?:\\(\\s*${escapedToken}\\s*\\)|\\s+${escapedToken}\\b)`;
  }).join("\\s*");
  const compactPathPattern = partPath.map((token) => {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?:\\(\\s*${escapedToken}\\s*\\)|${escapedToken})`;
  }).join("\\s*");
  const mergedPathPattern = `\\(\\s*${partPath.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")}\\s*\\)`;
  const parentPathPattern = partPath.at(-1)?.toLowerCase() === "i"
    ? partPath.slice(0, -1).map((token) => {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return `(?:\\(\\s*${escapedToken}\\s*\\)|${escapedToken})`;
      }).join("\\s*")
    : null;
  const alternatives = [pathPattern, compactPathPattern, mergedPathPattern, parentPathPattern].filter(Boolean).join("|");
  return new RegExp(`(?:\\bQuestion\\s+|\\bQ\\s*|\\*\\s*|\\b)0?${question}\\s*(?:${alternatives})(?:\\s*\\*)?(?=\\s|$|[A-Z0-9‘’“”'([{•])`, "i");
}

function findNextQuestionPartBoundary(unit: MarkableUnit, text: string, from: number) {
  const question = normalizeQuestionNumber(unit.questionNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numericPart = unit.boardCode === "aqa" ? "\\.\\s*\\d+\\b" : "(?:\\.\\s*|\\s+)\\d+\\b";
  const pattern = new RegExp(`(?:\\bQuestion\\s+0?\\d{1,2}\\s*(?:\\.|\\s|\\()?\\s*(?:[a-z]|[ivx]{1,4})|\\b0?${question}\\s*(?:${numericPart}|\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)|[a-z]\\b))`, "gi");
  for (const match of text.slice(from).matchAll(pattern)) {
    if (match.index === undefined) continue;
    const absoluteIndex = from + match.index;
    const immediatePrefix = text[absoluteIndex - 1];
    if ((immediatePrefix === "*" || immediatePrefix?.toLowerCase() === "q")
      && (absoluteIndex < 2 || /\s/.test(text[absoluteIndex - 2]))) continue;
    const precedingText = text.slice(from, from + match.index);
    if (/(?:compare(?:d)?\s+with|see|as\s+in|reference\s+to)\s*$/i.test(precedingText)) continue;
    return from + match.index;
  }
  return null;
}

function isQuestionPartBoundaryLine(unit: MarkableUnit, line: StructuredPdfLine) {
  const text = `${line.leftText} ${line.fullText}`;
  if (/^\s*\((?:[a-z]|[ivx]{1,4})\)(?:\s*\([ivx]{1,4}\))?(?:\s|$)/i.test(text)) return true;
  // A row whose Qu column carries a higher question number starts a following
  // question — Edexcel tables label these as bare numbers ("2", "3", ...).
  // (Must be strictly higher: an AQA continuation row can carry a bare part
  // label like "3(b)" under an empty Qu cell.)
  const quNumber = line.leftText.trim().match(/^0?(\d{1,2})\b/);
  const unitNumber = Number(normalizeQuestionNumber(unit.questionNumber));
  if (quNumber && Number.isFinite(unitNumber) && Number(quNumber[1]) > unitNumber) return true;
  const question = normalizeQuestionNumber(unit.questionNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numericPart = unit.boardCode === "aqa" ? "\\.\\s*\\d+\\b" : "(?:\\.\\s*|\\s+)\\d+\\b";
  return new RegExp(`^\\s*(?:Question\\s+0?\\d{1,2}\\b\\s*(?:(?:\\.\\s*)?\\d+\\b|\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)|[a-z]\\b)|0?${question}\\b\\s*(?:${numericPart}|\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)|[a-z]\\b))`, "i").test(text);
}

function findStructuredPartStart(lines: StructuredPdfLine[], markerIndex: number) {
  const marker = lines[markerIndex];
  if (!marker) return { contentIndex: markerIndex, boundaryIndex: markerIndex };
  const earliest = Math.max(0, markerIndex - 5);
  let headerIndex = -1;
  for (let index = markerIndex - 1; index >= earliest; index -= 1) {
    const line = lines[index];
    if (line.pageNumber !== marker.pageNumber) break;
    if (/\b(?:Answer|Indicative\s+content)\b.*\bMark\b/i.test(line.fullText)) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) return { contentIndex: markerIndex, boundaryIndex: markerIndex };

  let startIndex = headerIndex + 1;
  while (startIndex < markerIndex && /^(?:number|no\s*:?|cs\s+no\s*:?|:)$/i.test(lines[startIndex].fullText.trim())) {
    startIndex += 1;
  }
  return { contentIndex: startIndex, boundaryIndex: headerIndex };
}

export function splitMarkSchemePagesByParts(unit: MarkableUnit, pages: CachedPdfPage[]): RenderedMarkSchemePage[] | null {
  // Zero-mark parts are context carriers (e.g. a section extract shared by the
  // real parts) — they have no guidance to segment and duplicate a sibling's
  // part label, so only mark-bearing parts get their own segment.
  const markableParts = unit.parts.filter((part) => (part.marks ?? 0) > 0);
  if (markableParts.length < 2 || markableParts.some((part) => !part.questionPartNumber)) return null;
  if (markableParts.reduce((sum, part) => sum + (part.marks ?? 0), 0) !== unit.totalMarks) return null;
  const isEdexcelScience = unit.boardCode === "edexcel"
    && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug);
  const useCanonicalPathOrder = !isEdexcelScience && (unit.subjectSlug === "french"
    || markableParts.some((part) => (part.questionPath?.length ?? 0) > 0));
  const orderedParts = markableParts
    .map((part, index) => ({ part, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.part;
      const right = rightEntry.part;
      if (useCanonicalPathOrder) {
        const leftPath = left.questionPath && left.questionPath.length > 0
          ? left.questionPath
          : left.questionPartNumber ? [left.questionPartNumber] : [];
        const rightPath = right.questionPath && right.questionPath.length > 0
          ? right.questionPath
          : right.questionPartNumber ? [right.questionPartNumber] : [];
        const pathCompare = compareQuestionPaths(leftPath, rightPath);
        if (pathCompare !== 0) return pathCompare;
      }
      if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
      const leftTop = Math.max(left.bbox?.y1 ?? 0, left.bbox?.y0 ?? 0);
      const leftBottom = Math.min(left.bbox?.y1 ?? 0, left.bbox?.y0 ?? 0);
      const rightTop = Math.max(right.bbox?.y1 ?? 0, right.bbox?.y0 ?? 0);
      const rightBottom = Math.min(right.bbox?.y1 ?? 0, right.bbox?.y0 ?? 0);
      const overlaps = Math.min(leftTop, rightTop) > Math.max(leftBottom, rightBottom);
      if (!overlaps && leftTop !== rightTop) return rightTop - leftTop;
      return leftEntry.index - rightEntry.index;
    })
    .map(({ part }) => part);
  const sourceLines = pages.flatMap((page) => page.lines);
  const sourceText = normalizeMarkSchemeText(pages.map((page) => page.text).join(" "));
  // A zero-mark context part's prompt (e.g. a section extract) is a prefix of
  // the sibling part prompts it precedes — strip it so rows show the real
  // question, not the whole stimulus.
  const contextPrompts = unit.parts
    .filter((part) => (part.marks ?? 0) === 0)
    .map((part) => normalizeInlineText(part.promptText))
    .filter((prompt) => prompt.length > 0);
  const partWithoutContext = (part: MarkableUnit["parts"][number]) => {
    const prompt = normalizeInlineText(part.promptText);
    const context = contextPrompts.find((candidate) => prompt.startsWith(candidate));
    if (!context) return part;
    return { ...part, promptText: prompt.slice(context.length).trim() };
  };
  const buildInlineSegments = () => {
    if (!sourceText) return null;
    const starts: Array<{ index: number; part: MarkableUnit["parts"][number] }> = [];
    let searchFrom = 0;
    for (const [partIndex, part] of orderedParts.entries()) {
      const partNumber = part.questionPartNumber?.trim();
      if (!partNumber) return null;
      const promptPrefix = normalizeInlineText(part.promptText).match(new RegExp(`^${normalizeQuestionNumber(unit.questionNumber)}\\s*((?:\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)\\s*)+)`, "i"));
      const partPath = part.questionPath && part.questionPath.length > 0
        ? part.questionPath
        : promptPrefix?.[1]
          ? Array.from(promptPrefix[1].matchAll(/\(\s*([a-z]|[ivx]{1,4})\s*\)/gi)).map((match) => match[1].toLowerCase())
          : [];
      const pathPattern = partPath.length > 1 ? partPathMarkerPattern(unit, partPath) : null;
      const markerPattern = partMarkerPattern(unit, partNumber);
      const barePattern = /^\d+$/.test(partNumber) ? null : barePartMarkerPattern(partNumber);
      const candidates = [pathPattern, markerPattern, partIndex > 0 ? barePattern : null].filter((pattern): pattern is RegExp => pattern !== null);
      let matchIndex = -1;
      for (const pattern of candidates) {
        const match = sourceText.slice(searchFrom).match(pattern);
        if (match?.index !== undefined) {
          const candidateIndex = searchFrom + match.index;
          if (matchIndex < 0 || candidateIndex < matchIndex) matchIndex = candidateIndex;
        }
      }
      if (matchIndex < 0) return null;
      starts.push({ index: matchIndex, part });
      searchFrom = matchIndex + 1;
    }
    if (starts.length !== orderedParts.length || starts.length < 2) return null;

    const partPages = starts.map((start, index) => {
      const selectedEnd = starts[index + 1]?.index ?? sourceText.length;
      const sourceBoundary = findNextQuestionPartBoundary(unit, sourceText, start.index + 1) ?? sourceText.length;
      const end = Math.min(selectedEnd, sourceBoundary);
      const segmentText = sourceText.slice(start.index, end).trim();
      const partUnit = {
        ...unit,
        unitKey: `${unit.unitKey}::${start.part.partKey}`,
        parts: [partWithoutContext(start.part)],
        totalMarks: start.part.marks ?? 0,
      } satisfies MarkableUnit;
      return {
        pageNumber: 0,
        text: segmentText,
        lines: [],
        unit: partUnit,
      } satisfies RenderedMarkSchemePage;
    });
    const totalUnit = {
      ...unit,
      unitKey: `${unit.unitKey}::total`,
      parts: [],
      pages: [],
    } satisfies MarkableUnit;
    return [
      ...partPages,
      {
        pageNumber: 0,
        text: `Total for Question ${normalizeQuestionNumber(unit.questionNumber)} is ${unit.totalMarks} ${unit.totalMarks === 1 ? "mark" : "marks"}`,
        lines: [],
        unit: totalUnit,
        totalRow: true,
      } satisfies RenderedMarkSchemePage,
    ];
  };

  if (sourceLines.length === 0) return buildInlineSegments();
  const starts: Array<{ index: number; boundaryIndex: number; markerIndex: number; part: MarkableUnit["parts"][number] }> = [];
  let searchFrom = 0;
  for (const [partIndex, part] of orderedParts.entries()) {
    const partNumber = part.questionPartNumber?.trim();
    if (!partNumber) return null;
    const promptPrefix = normalizeInlineText(part.promptText).match(new RegExp(`^${normalizeQuestionNumber(unit.questionNumber)}\\s*((?:\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)\\s*)+)`, "i"));
    const partPath = part.questionPath && part.questionPath.length > 0
      ? part.questionPath
      : promptPrefix?.[1]
        ? Array.from(promptPrefix[1].matchAll(/\(\s*([a-z]|[ivx]{1,4})\s*\)/gi)).map((match) => match[1].toLowerCase())
        : [];
    const pathPattern = partPath.length > 1 ? partPathMarkerPattern(unit, partPath) : null;
    const markerPattern = partMarkerPattern(unit, partNumber);
    const barePattern = /^\d+$/.test(partNumber) ? null : barePartMarkerPattern(partNumber);
    const fullLineIndex = sourceLines.findIndex((line, index) => {
      if (index < searchFrom) return false;
      const searchable = `${line.leftText} ${line.fullText}`;
      return (pathPattern?.test(searchable) ?? false)
        || markerPattern.test(searchable);
    });
    const bareLineIndex = barePattern
      ? sourceLines.findIndex((line, index) => index >= searchFrom && barePattern.test(`${line.leftText} ${line.fullText}`))
      : -1;
    const targetQuestionPattern = new RegExp(`\\b(?:Question\\s+)?0?${normalizeQuestionNumber(unit.questionNumber)}\\s*(?:\\.|\\(|[a-z]\\b)`, "i");
    const hasTargetQuestionBeforeBare = bareLineIndex >= 0
      && sourceLines.slice(0, bareLineIndex).some((line) => targetQuestionPattern.test(`${line.leftText} ${line.fullText}`));
    const lineIndex = partIndex === 0
      ? fullLineIndex >= 0 ? fullLineIndex : hasTargetQuestionBeforeBare ? bareLineIndex : -1
      : [fullLineIndex, bareLineIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
    if (lineIndex < 0) {
      return buildInlineSegments();
    }
    const start = findStructuredPartStart(sourceLines, lineIndex);
    starts.push({ index: start.contentIndex, boundaryIndex: start.boundaryIndex, markerIndex: lineIndex, part });
    searchFrom = lineIndex + 1;
  }
  if (starts.length !== orderedParts.length || starts.length < 2) return null;

  const partPages = starts.map((start, index) => {
    const selectedEnd = starts[index + 1]?.boundaryIndex ?? sourceLines.length;
    const sourceBoundary = sourceLines.findIndex((line, lineIndex) => lineIndex > start.markerIndex && isQuestionPartBoundaryLine(unit, line));
    const end = Math.min(selectedEnd, sourceBoundary < 0 ? sourceLines.length : sourceBoundary);
    const segmentLines = sourceLines.slice(start.index, end);
    const partUnit = {
      ...unit,
      unitKey: `${unit.unitKey}::${start.part.partKey}`,
      parts: [partWithoutContext(start.part)],
      totalMarks: start.part.marks ?? 0,
    } satisfies MarkableUnit;
    return {
      pageNumber: 0,
      text: normalizeMarkSchemeText(segmentLines.map((line) => line.fullText).join(" ")),
      lines: segmentLines,
      unit: partUnit,
    } satisfies RenderedMarkSchemePage;
  });
  const totalUnit = {
    ...unit,
    unitKey: `${unit.unitKey}::total`,
    parts: [],
    pages: [],
  } satisfies MarkableUnit;
  return [
    ...partPages,
    {
      pageNumber: 0,
      text: `Total for Question ${normalizeQuestionNumber(unit.questionNumber)} is ${unit.totalMarks} ${unit.totalMarks === 1 ? "mark" : "marks"}`,
      lines: [],
      unit: totalUnit,
      totalRow: true,
    },
  ];
}

function parseAnswer(text: string) {
  const answer = text.match(/\b([A-D])\s*:\s*([^.;]+?)(?=\s+No credit|\s+AO\d|\s+\d+\s*mark|$)/i);
  if (!answer) return { answerLetter: null, answerText: null };
  return { answerLetter: answer[1].toUpperCase(), answerText: answer[2].trim() };
}

function parseLevelDescriptors(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/\bLevel(?:\s+Mark(?:s)?\b|\s+\d\b)/i.test(normalized)) return [];
  const levels: LevelDescriptor[] = [];
  const parenthesizedPattern = /(?:Level\s+Mark(?:s)?\s+(?:Description|Descriptor)\s+)?(\d)\s*\(([^)]+)\)\s+(\d+\s*[-–]\s*\d+)\s+(.+?)(?=\s+Level\s+\d\s*\([^)]+\)\s+\d+\s*[-–]\s*\d+|\s+\d\s*\([^)]+\)\s+\d+\s*[-–]\s*\d+|\s+0\s+No relevant content|\s+Indicative content\b|\s+Pearson\s+Education\s+Limited\b|$)/gi;
  for (const match of normalized.matchAll(parenthesizedPattern)) {
    levels.push({
      level: `${match[1]} (${match[2]})`,
      marks: match[3].replace(/[–]/g, "-"),
      description: match[4].trim(),
    });
  }
  if (levels.length > 0) return levels;

  const plainPattern = /(?:^|\s)(\d)\s+(\d+(?:\s*[-–]\s*\d+)?)\s+(.+?)(?=\s+Level\s+\d\s+\d+(?:\s*[-–]\s*\d+)?\s+|\s+\d\s+\d+(?:\s*[-–]\s*\d+)?\s+|\s+(?:Indicative content|Answers?\s+may\s+include|Question\s+Answer|Total\s+for|Pearson\s+Education\s+Limited)\b|$)/gi;
  for (const match of normalized.matchAll(plainPattern)) {
    levels.push({
      level: match[1],
      marks: match[2].replace(/[–]/g, "-").replace(/\s+/g, ""),
      description: match[3].trim(),
    });
  }
  return levels;
}

function extractIndicativeContent(text: string) {
  const match = text.match(/\bIndicative content\b(.+)$/i);
  if (!match) return "";
  return match[1]
    .replace(/\s+\d+\s+Level\s+Marks\s+Description\b.+$/i, "")
    .replace(/\s+Level\s+Marks\s+Description\b.+$/i, "")
    .replace(/\s+Qu\s+Pt\s+Marking\s+Guidance\s+Total\s+marks\b.+$/i, "")
    .replace(/\s+\d+\s+Mark Scheme\s*[-–—]\s*(?:Hot desert|Cold) environment\b/gi, "")
    .replace(/\s+\d+\s+0?\d{1,2}\s+\d{1,2}\s+.+$/i, "")
    .replace(/\s+0?\d{1,2}\s+\d{1,2}\s+Using\s+Figure\b.+$/i, "")
    .replace(/\s+PMT\s+MARK SCHEME\b.+$/i, "")
    .trim()
    .replace(/^(?:[-–]?\s*\d+\s*[-–]\s*\d+|\d+)$/, "");
}

function continuationIndicativeContent(unit: MarkableUnit, text: string) {
  if (!unit.boardCode.includes("aqa") || unit.subjectSlug !== "geography") return "";
  return text
    .replace(/\bPMT\b/g, " ")
    .replace(/\bMARK SCHEME\s*[-–—]\s*GCSE\s+GEOGRAPHY\s*[-–—]\s*[^\d]+\d{4}\b/gi, " ")
    .replace(/\bMark Scheme\s*[-–—]\s*(?:Hot desert|Cold) environment\b/gi, " ")
    .replace(/\bQu\s+Pt\s+Marking\s+Guidance\s+Total\s+marks\b.+$/i, " ")
    .replace(/\b(?:cont\.)?\s*\d+\s+Indicative content\b/gi, " ")
    .replace(/\bIndicative content\b/gi, " ")
    .replace(/\s+\d+\s+0?\d{1,2}\s+\d{1,2}\s+.+$/i, "")
    .replace(/^\s*\d+\s+/, " ")
    .replace(/\s+0?\d{1,2}\s+\d{1,2}\s+Using\s+Figure\b.+$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-–]?\s*\d+\s*[-–]\s*\d+|\d+)$/, "");
}

function stripPromptAndStructure(text: string, entry: { prompt: string; levels: LevelDescriptor[]; indicativeContent: string; answerLetter: string | null; answerText: string | null }) {
  let guidance = stripMatchedPrompt(text, entry.prompt, 80);
  if (entry.answerLetter && entry.answerText) {
    const answerIndex = guidance.search(new RegExp(`\\b${entry.answerLetter}\\s*:\\s*${entry.answerText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
    if (answerIndex >= 0) guidance = guidance.slice(answerIndex).trim();
  }
  if (entry.levels.length > 0) {
    guidance = guidance.replace(/Level\s+Mark(?:s)?\s+(?:Description|Descriptor).+?(?=Indicative content|Answers?\s+may\s+include|Question\s+Answer|Total\s+for|$)/i, "").trim();
  }
  if (entry.indicativeContent) guidance = guidance.replace(/Indicative content.+$/i, "").trim();
  return guidance
    .replace(/\bMarks?\s+for\s+this\s+question:?\s*/gi, " ")
    .replace(/\[\s*\d+\s*marks?\s*\]\s*/gi, " ")
    .replace(/\s+\d{1,2}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStructuredEntry(unit: MarkableUnit, text: string, continuation = false): StructuredMarkSchemeEntry {
  let guidanceText = cleanFallbackGuidance(text, unit);
  // Split segments begin at the part's own marker — the Pt cell already shows
  // the generated label, so drop the source label (and its "[N marks]" tail).
  const ownPartNumber = unit.parts.length === 1 ? unit.parts[0]?.questionPartNumber?.trim() : undefined;
  if (ownPartNumber) {
    guidanceText = guidanceText
      .replace(new RegExp(`^\\s*(?:${partMarkerPattern(unit, ownPartNumber).source}|${barePartMarkerPattern(ownPartNumber).source})`, "i"), "")
      .replace(/^\s*\[\s*\d+\s*marks?\s*\]\s*/i, "");
  }
  if (!continuation && unit.boardCode === "edexcel" && ["biology", "chemistry", "physics", "combined-science"].includes(unit.subjectSlug) && unit.parts.length === 1) {
    const marker = guidanceText.match(partMarkerPattern(unit, unit.parts[0].questionPartNumber?.trim() ?? ""));
    const rowText = marker?.index === undefined ? guidanceText : guidanceText.slice(marker.index + marker[0].length).trim();
    const answerText = rowText.replace(/^\(\s*\d+\s*\)\s*/, "");
    if (/^(?:Accept|Allow|Ignore|Reject|Award|No credit)\b/i.test(answerText)) {
      throw new Error(`Mark scheme row for question ${unit.questionNumber} contains an image-only or missing answer.`);
    }
  }
  const prompt = continuation ? "" : cleanQuestionPrompt(unit);
  const answer = parseAnswer(guidanceText);
  const levels = parseLevelDescriptors(guidanceText);
  const indicativeContent = extractIndicativeContent(guidanceText) || (continuation ? continuationIndicativeContent(unit, guidanceText) : "");
  const guidance = continuation && unit.boardCode === "aqa" && unit.subjectSlug === "geography"
    ? ""
    : stripPromptAndStructure(guidanceText, { prompt, levels, indicativeContent, ...answer });
  return { prompt, guidance, levels, indicativeContent, ...answer };
}

function rowQuestionLabel(order: number) {
  return String(order).padStart(2, "0");
}

function rowPartLabel(unit: MarkableUnit, totalRow = false) {
  if (totalRow) return "Total";
  const labels = unit.parts.map((part) => part.questionPartNumber?.trim()).filter((part): part is string => Boolean(part));
  if (labels.length === 0) return "-";
  const numericLabels = labels.map((label) => Number.parseInt(label, 10));
  if (numericLabels.every((value, index) => Number.isInteger(value) && String(value) === labels[index])) {
    const ranges: string[] = [];
    let start = numericLabels[0];
    let end = start;
    for (const value of numericLabels.slice(1)) {
      if (value === end + 1) {
        end = value;
        continue;
      }
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = value;
      end = value;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    return ranges.join(", ");
  }
  return labels.join(", ");
}

export function formatGeneratedTotalRow(unit: MarkableUnit, order: number) {
  return `Total for Question ${order} is ${unit.totalMarks} ${unit.totalMarks === 1 ? "mark" : "marks"}`;
}

function drawTableHeader(page: PDFPage, fonts: MarkSchemeFonts) {
  page.drawText("MARK SCHEME", { x: MS_LEFT, y: 800, size: 10, font: fonts.bold, color: rgb(0.12, 0.12, 0.12) });
  page.drawLine({ start: { x: MS_LEFT, y: 785 }, end: { x: MS_RIGHT, y: 785 }, thickness: 0.8, color: rgb(0.12, 0.12, 0.12) });
  page.drawText("Qu", { x: MS_LEFT + 8, y: MS_TOP + 10, size: 12, font: fonts.bold });
  page.drawText("Pt", { x: MS_LEFT + MS_QUESTION_W + 8, y: MS_TOP + 10, size: 12, font: fonts.bold });
  page.drawText("Marking guidance", { x: MS_LEFT + MS_QUESTION_W + MS_PART_W + 8, y: MS_TOP + 10, size: 12, font: fonts.bold });
  page.drawText("Marks", { x: MS_RIGHT - MS_MARKS_W + 8, y: MS_TOP + 10, size: 12, font: fonts.bold });
  page.drawRectangle({ x: MS_LEFT, y: MS_TOP, width: MS_RIGHT - MS_LEFT, height: 34, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.8 });
  page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W, y: MS_TOP }, end: { x: MS_LEFT + MS_QUESTION_W, y: MS_TOP + 34 }, thickness: 0.6, color: rgb(0.05, 0.05, 0.05) });
  page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y: MS_TOP }, end: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y: MS_TOP + 34 }, thickness: 0.6, color: rgb(0.05, 0.05, 0.05) });
  page.drawLine({ start: { x: MS_RIGHT - MS_MARKS_W, y: MS_TOP }, end: { x: MS_RIGHT - MS_MARKS_W, y: MS_TOP + 34 }, thickness: 0.6, color: rgb(0.05, 0.05, 0.05) });
}

function newTablePage(outputDoc: PDFDocument, fonts: MarkSchemeFonts, pageNumber: number): TableLayout {
  const page = outputDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  drawTableHeader(page, fonts);
  page.drawText(String(pageNumber), { x: A4_WIDTH / 2 - 4, y: 28, size: 8, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) });
  return { page, y: MS_TOP - 22, pageNumber };
}

function levelTableHeight(levels: LevelDescriptor[], fonts: MarkSchemeFonts, width: number) {
  if (levels.length === 0) return 0;
  return 22 + levels.reduce((sum, level) => sum + Math.max(34, aoDescriptionHeight(level.description, fonts, 7.6, width - 110, 9) + 10), 0);
}

function drawWrappedLines(page: PDFPage, lines: string[], x: number, y: number, size: number, font: PDFFont, lineHeight: number) {
  let currentY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, font, color: rgb(0.05, 0.05, 0.05) });
    currentY -= lineHeight;
  }
  return currentY;
}

function drawAoAwareWrappedLines(page: PDFPage, lines: string[], x: number, y: number, size: number, fonts: MarkSchemeFonts, maxWidth: number, lineHeight: number) {
  let currentY = y;
  for (const line of lines) {
    const match = line.match(/^(AO\d[a-z]?)(.*)$/i);
    if (!match) {
      page.drawText(line, { x, y: currentY, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
      currentY -= lineHeight;
      continue;
    }
    const label = match[1].toUpperCase();
    const labelWidth = fonts.bold.widthOfTextAtSize(label, size) + 4;
    const remainder = match[2].trimStart();
    const remainderLines = remainder ? wrapText(remainder, fonts.regular, size, maxWidth - labelWidth) : [];
    page.drawText(label, { x, y: currentY, size, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
    if (remainderLines[0]) page.drawText(remainderLines[0], { x: x + labelWidth, y: currentY, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
    for (let index = 1; index < remainderLines.length; index += 1) {
      page.drawText(remainderLines[index], { x: x + labelWidth, y: currentY - index * lineHeight, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
    }
    currentY -= Math.max(1, remainderLines.length) * lineHeight;
  }
  return currentY;
}

function aoDescriptionChunks(text: string) {
  return text
    .replace(/\s+(AO\d[a-z]?\b)/gi, "\n$1")
    .split("\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function aoDescriptionHeight(text: string, fonts: MarkSchemeFonts, size: number, width: number, lineHeight: number) {
  return aoDescriptionChunks(text).reduce((sum, chunk) => {
    const match = chunk.match(/^(AO\d[a-z]?)\s+(.+)$/i);
    if (!match) return sum + wrapText(chunk, fonts.regular, size, width).length * lineHeight;
    const labelWidth = fonts.bold.widthOfTextAtSize(match[1], size) + 4;
    return sum + Math.max(1, wrapText(match[2], fonts.regular, size, width - labelWidth).length) * lineHeight;
  }, 0);
}

function drawAoDescription(page: PDFPage, text: string, x: number, y: number, width: number, fonts: MarkSchemeFonts, size: number, lineHeight: number) {
  let currentY = y;
  for (const chunk of aoDescriptionChunks(text)) {
    const match = chunk.match(/^(AO\d)\s+(.+)$/i);
    if (!match) {
      currentY = drawWrappedLines(page, wrapText(chunk, fonts.regular, size, width), x, currentY, size, fonts.regular, lineHeight);
      continue;
    }
    const label = match[1].toUpperCase();
    const labelWidth = fonts.bold.widthOfTextAtSize(label, size) + 4;
    const lines = wrapText(match[2], fonts.regular, size, width - labelWidth);
    page.drawText(label, { x, y: currentY, size, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
    if (lines[0]) page.drawText(lines[0], { x: x + labelWidth, y: currentY, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
    for (let index = 1; index < lines.length; index += 1) {
      page.drawText(lines[index], { x: x + labelWidth, y: currentY - index * lineHeight, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
    }
    currentY -= Math.max(1, lines.length) * lineHeight;
  }
  return currentY;
}

type BulletLine = { text: string; indent?: number; bold?: boolean; bullet?: boolean };

function splitIndicativeSentences(text: string) {
  return text
    .replace(/\b(\d+)\.\s*(\d+)\b/g, "$1·$2")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((item) => item.replace(/(\d+)·(\d+)/g, "$1.$2").trim())
    .filter(Boolean);
}

function indicativeContentItems(text: string): BulletLine[] {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/\s+(Alternatively,)/gi, "\n$1")
    .replace(/\s+(Application of understanding to [^:]+:)\s*/gi, "\n$1\n")
    .replace(/\s+(Accept arguments?\b)/gi, "\n$1")
    .replace(/\s+(AO\d\s*[-–]\s*\d+\s*marks?)\b/gi, "\n$1")
    .trim();
  const items: BulletLine[] = [];
  let nested = false;
  for (const chunk of normalized.split("\n").map((part) => part.trim()).filter(Boolean)) {
    if (/^AO\d\s*[-–]/i.test(chunk)) {
      items.push({ text: chunk.replace(/[–]/g, "-"), bold: true, bullet: false });
      nested = false;
      continue;
    }
    if (/^Application of understanding to .+:$/i.test(chunk)) {
      items.push({ text: chunk, bold: true });
      nested = true;
      continue;
    }
    if (/^Accept arguments?/i.test(chunk)) nested = false;
    for (const sentence of splitIndicativeSentences(chunk)) items.push({ text: sentence, indent: nested ? 1 : 0 });
  }
  return items;
}

function levelGuidanceItems(text: string): BulletLine[] {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/\s+(Level\s+\d+\s*\([^)]+\))/gi, "\n$1")
    .trim();
  return normalized
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => /^Level\s+\d+/i.test(part))
    .map((text) => ({ text, bold: true, bullet: true }));
}

function bulletItemsHeight(items: BulletLine[], fonts: MarkSchemeFonts, size: number, maxWidth: number, lineHeight: number) {
  return items.reduce((sum, item) => {
    const indent = item.indent ? 14 : 0;
    return sum + Math.max(lineHeight, wrapText(item.text, item.bold ? fonts.bold : fonts.regular, size, maxWidth - indent - 12).length * lineHeight);
  }, 0);
}

function drawBulletItems(page: PDFPage, items: BulletLine[], x: number, y: number, size: number, fonts: MarkSchemeFonts, maxWidth: number, lineHeight: number) {
  let currentY = y;
  for (const item of items) {
    const indent = item.indent ? 14 : 0;
    const font = item.bold ? fonts.bold : fonts.regular;
    const lines = wrapText(item.text, font, size, maxWidth - indent - 12);
    const hasBullet = item.bullet !== false;
    if (hasBullet) page.drawText("•", { x: x + indent, y: currentY, size, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
    lines.forEach((line, index) => {
      page.drawText(line, { x: x + indent + (hasBullet ? 12 : 0), y: currentY - index * lineHeight, size, font, color: rgb(0.05, 0.05, 0.05) });
    });
    currentY -= Math.max(lineHeight, lines.length * lineHeight);
  }
  return currentY;
}

function guidanceDisplayChunks(text: string) {
  return text
    .replace(/\((\d)\)\.?\s+/g, "($1)\n")
    .replace(/\s+(No credit|Credit|Accept|Allow|AO\d\b)/gi, "\n$1")
    .split("\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function wrapGuidanceDisplayChunks(chunks: string[], fonts: MarkSchemeFonts, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const chunk of chunks) {
    const prefix = /\(\d\)/.test(chunk) && !/^(No credit|Credit|Accept|Allow|AO\d\b)/i.test(chunk) ? "• " : "";
    const wrapped = wrapText(chunk, fonts.regular, size, maxWidth - (prefix ? 10 : 0));
    wrapped.forEach((line, index) => lines.push(`${index === 0 ? prefix : prefix ? "  " : ""}${line}`));
  }
  return lines;
}

function guidanceDisplayLines(text: string, fonts: MarkSchemeFonts, size: number, maxWidth: number) {
  return wrapGuidanceDisplayChunks(guidanceDisplayChunks(text), fonts, size, maxWidth);
}

function drawLevelTable(page: PDFPage, levels: LevelDescriptor[], x: number, yTop: number, width: number, fonts: MarkSchemeFonts) {
  const levelW = 62;
  const marksW = 48;
  const descW = width - levelW - marksW;
  let y = yTop;
  page.drawRectangle({ x, y: y - 18, width, height: 18, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.5 });
  page.drawText("Level", { x: x + 8, y: y - 13, size: 8, font: fonts.bold });
  page.drawText("Marks", { x: x + levelW + 8, y: y - 13, size: 8, font: fonts.bold });
  page.drawText("Description", { x: x + levelW + marksW + 8, y: y - 13, size: 8, font: fonts.bold });
  page.drawLine({ start: { x: x + levelW, y: y - 18 }, end: { x: x + levelW, y }, thickness: 0.4, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x: x + levelW + marksW, y: y - 18 }, end: { x: x + levelW + marksW, y }, thickness: 0.4, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;
  for (const level of levels) {
    const rowH = Math.max(34, aoDescriptionHeight(level.description, fonts, 7.6, descW - 10, 9) + 10);
    page.drawRectangle({ x, y: y - rowH, width, height: rowH, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.5 });
    page.drawLine({ start: { x: x + levelW, y: y - rowH }, end: { x: x + levelW, y }, thickness: 0.4, color: rgb(0.1, 0.1, 0.1) });
    page.drawLine({ start: { x: x + levelW + marksW, y: y - rowH }, end: { x: x + levelW + marksW, y }, thickness: 0.4, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(level.level, { x: x + 8, y: y - 13, size: 7.8, font: fonts.regular });
    page.drawText(level.marks, { x: x + levelW + 10, y: y - 13, size: 7.8, font: fonts.regular });
    drawAoDescription(page, level.description, x + levelW + marksW + 8, y - 13, descW - 10, fonts, 7.6, 9);
    y -= rowH;
  }
  return y;
}

function drawMathTableHeader(page: PDFPage, unit: MarkableUnit, fonts: MarkSchemeFonts) {
  const left = 34;
  const top = LANDSCAPE_HEIGHT - 42;
  const width = LANDSCAPE_WIDTH - 68;
  page.drawRectangle({ x: left, y: top, width, height: 18, color: rgb(0.68, 0.68, 0.68), borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.8 });
  page.drawText(`Paper: ${unit.paperCode.toUpperCase()}`, { x: left + 6, y: top + 5, size: 11, font: fonts.bold });
  page.drawText("Mark Scheme", { x: LANDSCAPE_WIDTH - 132, y: top + 5, size: 11, font: fonts.bold });
  const y = top - 18;
  const cols = [40, 92, 56, 350, width - 40 - 92 - 56 - 350];
  let x = left;
  page.drawRectangle({ x: left, y, width, height: 18, color: rgb(0.72, 0.72, 0.72), borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.8 });
  ["Question", "Answer", "Mark", "Mark scheme", "Additional guidance"].forEach((label, index) => {
    if (index > 0) page.drawLine({ start: { x, y }, end: { x, y: y + 18 }, thickness: 0.7, color: rgb(0.05, 0.05, 0.05) });
    page.drawText(label, { x: x + 6, y: y + 5, size: 9.5, font: fonts.bold });
    x += cols[index];
  });
}

function newMathTablePage(outputDoc: PDFDocument, unit: MarkableUnit, fonts: MarkSchemeFonts, pageNumber: number): TableLayout {
  const page = outputDoc.addPage([LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT]);
  drawMathTableHeader(page, unit, fonts);
  page.drawText(String(pageNumber), { x: LANDSCAPE_WIDTH / 2 - 4, y: 22, size: 8, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) });
  return { page, y: LANDSCAPE_HEIGHT - 86, pageNumber };
}

function extractMathAnswerText(text: string) {
  const normalized = safePdfText(text).replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b(?:Final answer|Final|Answer)\s*:?[\s-]*([^.;]+?)(?=\s+(?:M\d|A\d|B\d|C\d|P\d|Just|Must|May|Accept|Allow|Ignore|Award|Any correct|Do not|$))/i);
  if (match?.[1]) return match[1].trim();

  const firstMark = normalized.match(/\b[MPABC]\d{1,2}\b/i);
  if (!firstMark || firstMark.index === undefined || firstMark.index === 0) return "";
  return normalized
    .slice(0, firstMark.index)
    .replace(/^\s*(?:Question\s+)?0?\d+(?:\s*[.]\s*\d+)?\s*/i, "")
    .replace(/^\s*\([a-z]\)\s*/i, "")
    .trim();
}

type MathCriterion = {
  markCode: string;
  scheme: string;
  guidance: string;
};

function extractMarkCodes(text: string) {
  return Array.from(text.matchAll(/\b([MPABC]\d{1,2})\b/gi)).map((match) => match[1].toUpperCase());
}

function removeMarkCodes(text: string) {
  return text.replace(/\b[MPABC]\d{1,2}\b/gi, " ").replace(/\s+/g, " ").trim();
}

function extractMathCriteria(lines: StructuredPdfLine[] | undefined, fallbackText: string, entry: StructuredMarkSchemeEntry, fallbackMarkCode: string): MathCriterion[] {
  const criteria: MathCriterion[] = [];
  for (const line of lines ?? []) {
    const codes = extractMarkCodes(line.markText);
    if (codes.length === 0) continue;
    const scheme = removeMarkCodes(line.schemeText || line.fullText);
    const guidance = line.guidanceText.trim();
    for (const markCode of codes) criteria.push({ markCode, scheme, guidance });
  }

  if (criteria.length > 0) {
    for (const line of lines ?? []) {
      if (extractMarkCodes(line.markText).length > 0) continue;
      const scheme = line.schemeText.trim();
      const guidance = line.guidanceText.trim();
      if (!scheme && !guidance) continue;
      const previous = criteria.at(-1);
      if (!previous) continue;
      previous.scheme = [previous.scheme, scheme].filter(Boolean).join(" ").trim();
      previous.guidance = [previous.guidance, guidance].filter(Boolean).join(" ").trim();
    }
    return criteria;
  }

  const textCodes = extractMarkCodes(fallbackText);
  const fallbackGuidance = entry.guidance || fallbackText;
  if (textCodes.length === 0) {
    return [{
      markCode: fallbackMarkCode,
      scheme: fallbackGuidance,
      guidance: entry.indicativeContent,
    }];
  }
  const codeMatches = Array.from(fallbackGuidance.matchAll(/\b[MPABC]\d{1,2}\b/gi));
  return textCodes.map((markCode, index) => {
    const match = codeMatches[index];
    const nextMatch = codeMatches[index + 1];
    const start = match?.index === undefined ? 0 : match.index + match[0].length;
    const end = nextMatch?.index ?? fallbackGuidance.length;
    const scheme = removeMarkCodes(fallbackGuidance.slice(start, end));
    return {
      markCode,
      scheme: scheme || removeMarkCodes(fallbackGuidance),
      guidance: entry.indicativeContent,
    };
  });
}

function criterionHeight(criterion: MathCriterion, fonts: MarkSchemeFonts, schemeWidth: number, guidanceWidth: number) {
  const schemeLines = wrapText(criterion.scheme, fonts.bold, 8.3, schemeWidth).length;
  const guidanceLines = wrapText(criterion.guidance, fonts.regular, 8, guidanceWidth).length;
  return Math.max(1, schemeLines, guidanceLines);
}

function drawMathMarkSchemeTableRow(outputDoc: PDFDocument, layout: TableLayout | null, row: { unit: MarkableUnit; order: number; text: string; lines?: StructuredPdfLine[]; continuation?: boolean; totalRow?: boolean }, fonts: MarkSchemeFonts) {
  const left = 34;
  const width = LANDSCAPE_WIDTH - 68;
  const cols = [40, 92, 56, 350, width - 40 - 92 - 56 - 350];
  const entry = buildStructuredEntry(row.unit, row.text, row.continuation);
  const structuredAnswer = row.lines?.flatMap((line) => line.answerText ? [line.answerText] : []).join(" ") ?? "";
  const answerLines = wrapText(structuredAnswer || extractMathAnswerText(row.text), fonts.regular, 8.4, cols[1] - 12);
  const criteria = row.totalRow ? [] : extractMathCriteria(row.lines, row.text, entry, String(row.unit.parts[0]?.marks ?? row.unit.totalMarks));
  const promptLines = wrapText(entry.prompt, fonts.bold, 8.3, cols[3] - 12);
  let current = layout ?? newMathTablePage(outputDoc, row.unit, fonts, 1);
  let remainingCriteria = criteria;
  let continuation = row.continuation ?? false;

  do {
    const fixedLines = Math.max(answerLines.length, continuation ? 0 : promptLines.length, row.totalRow ? 1 : 0);
    const availableLines = Math.max(1, Math.floor((current.y - 44 - 22 - fixedLines * 10) / 10));
    let criterionLines = 0;
    let criterionCount = 0;
    for (const criterion of remainingCriteria) {
      const height = criterionHeight(criterion, fonts, cols[3] - 12, cols[4] - 12);
      if (criterionCount > 0 && criterionLines + height > availableLines) break;
      criterionLines += height;
      criterionCount += 1;
    }
    if (criterionCount === 0 && remainingCriteria.length > 0) criterionCount = 1;
    const rowCriteria = remainingCriteria.slice(0, criterionCount);
    const contentLines = Math.max(
      answerLines.length,
      (continuation ? 0 : promptLines.length) + criterionLines,
      row.totalRow ? 1 : 0,
      1,
    );
    const rowHeight = Math.max(68, 22 + contentLines * 10);
    if (current.y - rowHeight < 44 && current.y !== LANDSCAPE_HEIGHT - 86) {
      current = newMathTablePage(outputDoc, row.unit, fonts, current.pageNumber + 1);
      continue;
    }

    const y = current.y - rowHeight;
    current.page.drawRectangle({ x: left, y, width, height: rowHeight, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.7 });
    let x = left;
    for (const col of cols.slice(0, -1)) {
      x += col;
      current.page.drawLine({ start: { x, y }, end: { x, y: y + rowHeight }, thickness: 0.6, color: rgb(0.05, 0.05, 0.05) });
    }

    const partLabel = rowPartLabel(row.unit, row.totalRow);
    const questionLabel = row.totalRow
      ? "Total"
      : `${rowQuestionLabel(row.order)}${partLabel !== "-" ? ` (${partLabel})` : ""}`;
    current.page.drawText(continuation ? "" : questionLabel, { x: left + 6, y: y + rowHeight - 18, size: 9.5, font: fonts.regular });
    drawWrappedLines(current.page, answerLines, left + cols[0] + 8, y + rowHeight - 18, 8.4, fonts.regular, 11);

    const schemeY = y + rowHeight - 18;
    const schemeX = left + cols[0] + cols[1] + cols[2] + 8;
    const guidanceX = left + cols[0] + cols[1] + cols[2] + cols[3] + 8;
    if (row.totalRow) {
      current.page.drawText(formatGeneratedTotalRow(row.unit, row.order), {
        x: schemeX,
        y: schemeY,
        size: 8.8,
        font: fonts.bold,
      });
      current.page.drawText(String(row.unit.totalMarks), {
        x: left + cols[0] + cols[1] + 16,
        y: schemeY,
        size: 9.5,
        font: fonts.bold,
      });
    } else {
      let criterionY = schemeY;
      if (!continuation) {
        drawWrappedLines(current.page, promptLines, schemeX, criterionY, 8.3, fonts.bold, 10);
        criterionY -= promptLines.length * 10;
      }
      for (const criterion of rowCriteria) {
        const schemeLines = wrapText(criterion.scheme, fonts.bold, 8.3, cols[3] - 12);
        const guidanceLines = wrapText(criterion.guidance, fonts.regular, 8, cols[4] - 12);
        const height = Math.max(1, schemeLines.length, guidanceLines.length);
        current.page.drawText(criterion.markCode, {
          x: left + cols[0] + cols[1] + 14,
          y: criterionY,
          size: 9.2,
          font: fonts.bold,
        });
        for (let index = 0; index < height; index += 1) {
          if (schemeLines[index]) current.page.drawText(schemeLines[index], { x: schemeX, y: criterionY - index * 10, size: 8.3, font: fonts.bold });
          if (guidanceLines[index]) current.page.drawText(guidanceLines[index], { x: guidanceX, y: criterionY - index * 10, size: 8, font: fonts.regular });
        }
        criterionY -= height * 10;
      }
    }

    remainingCriteria = remainingCriteria.slice(rowCriteria.length);
    current.y = y - 10;
    continuation = true;
    if (remainingCriteria.length > 0) {
      current = newMathTablePage(outputDoc, row.unit, fonts, current.pageNumber + 1);
    }
  } while (remainingCriteria.length > 0);

  return current;
}

function drawOcrTableHeader(page: PDFPage, unit: MarkableUnit, fonts: MarkSchemeFonts) {
  const left = 34;
  const top = LANDSCAPE_HEIGHT - 42;
  const width = LANDSCAPE_WIDTH - 68;
  page.drawText(unit.paperCode.toUpperCase(), { x: left, y: top + 5, size: 10, font: fonts.regular });
  page.drawText("Mark Scheme", { x: LANDSCAPE_WIDTH / 2 - 34, y: top + 5, size: 10, font: fonts.regular });
  page.drawText(unit.year ? `June ${unit.year}` : "Mark Scheme", { x: LANDSCAPE_WIDTH - 104, y: top + 5, size: 10, font: fonts.regular });
  const headerY = top - 18;
  const cols = [92, 414, 48, width - 92 - 414 - 48];
  let x = left;
  page.drawRectangle({ x: left, y: headerY, width, height: 18, borderColor: rgb(0.02, 0.02, 0.02), borderWidth: 0.8 });
  ["Question", "Answer", "Mark", "Guidance"].forEach((label, index) => {
    if (index > 0) page.drawLine({ start: { x, y: headerY }, end: { x, y: headerY + 18 }, thickness: 0.7, color: rgb(0.02, 0.02, 0.02) });
    page.drawText(label, { x: x + 8, y: headerY + 5, size: 9.5, font: fonts.bold });
    x += cols[index];
  });
}

function newOcrTablePage(outputDoc: PDFDocument, unit: MarkableUnit, fonts: MarkSchemeFonts, pageNumber: number): TableLayout {
  const page = outputDoc.addPage([LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT]);
  drawOcrTableHeader(page, unit, fonts);
  page.drawText(String(pageNumber), { x: LANDSCAPE_WIDTH / 2 - 4, y: 22, size: 8, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) });
  return { page, y: LANDSCAPE_HEIGHT - 86, pageNumber };
}

function splitOcrAnswerGuidance(lines: string[]) {
  const answerLines: string[] = [];
  const guidanceLines: string[] = [];
  for (const line of lines) {
    if (/^(Accept|Allow|Ignore|Do not|Do NOT|Answers? may|Examiner|Guidance|Note|Award|Responses? must|No credit)/i.test(line.replace(/^•\s*/, ""))) guidanceLines.push(line);
    else answerLines.push(line);
  }
  return { answerLines, guidanceLines };
}

export function drawOcrMarkSchemeTableRow(outputDoc: PDFDocument, layout: TableLayout | null, row: { unit: MarkableUnit; order: number; text: string; lines?: StructuredPdfLine[]; continuation?: boolean; totalRow?: boolean }, fonts: MarkSchemeFonts) {
  const left = 34;
  const width = LANDSCAPE_WIDTH - 68;
  const cols = [92, 414, 48, width - 92 - 414 - 48];
  const entry = buildStructuredEntry(row.unit, row.text, row.continuation);
  const split = splitOcrAnswerGuidance(guidanceDisplayChunks(entry.guidance || row.text));
  const promptLines = wrapText(entry.prompt, fonts.bold, 8.2, cols[1] - 12);
  let remainingAnswer = [...promptLines, ...wrapGuidanceDisplayChunks(split.answerLines, fonts, 8, cols[1] - 12)];
  let remainingGuidance = wrapGuidanceDisplayChunks(split.guidanceLines, fonts, 8, cols[3] - 12);
  let current = layout ?? newOcrTablePage(outputDoc, row.unit, fonts, 1);
  let continuation = row.continuation ?? false;

  do {
    const maxRowLines = Math.max(1, Math.floor((current.y - 44 - 22) / 10));
    const lineCount = Math.min(maxRowLines, Math.max(1, remainingAnswer.length, remainingGuidance.length));
    const rowAnswer = remainingAnswer.slice(0, lineCount);
    const rowGuidance = remainingGuidance.slice(0, lineCount);
    const rowHeight = Math.max(56, 22 + Math.max(rowAnswer.length, rowGuidance.length) * 10);
    if (current.y - rowHeight < 44 && current.y !== LANDSCAPE_HEIGHT - 86) {
      current = newOcrTablePage(outputDoc, row.unit, fonts, current.pageNumber + 1);
      continue;
    }

    const y = current.y - rowHeight;
    current.page.drawRectangle({ x: left, y, width, height: rowHeight, borderColor: rgb(0.02, 0.02, 0.02), borderWidth: 0.7 });
    let x = left;
    for (const col of cols.slice(0, -1)) {
      x += col;
      current.page.drawLine({ start: { x, y }, end: { x, y: y + rowHeight }, thickness: 0.6, color: rgb(0.02, 0.02, 0.02) });
    }
    current.page.drawText(continuation ? "" : String(row.order), { x: left + 10, y: y + rowHeight - 18, size: 9.5, font: fonts.bold });
    current.page.drawText(continuation ? "cont." : rowPartLabel(row.unit, row.totalRow), { x: left + 48, y: y + rowHeight - 18, size: 9.5, font: fonts.bold });
    current.page.drawText(String(row.unit.totalMarks), { x: left + cols[0] + cols[1] + 16, y: y + rowHeight - 18, size: 9.5, font: fonts.bold });
    drawWrappedLines(current.page, rowAnswer, left + cols[0] + 8, y + rowHeight - 18, 8, fonts.regular, 10);
    drawAoAwareWrappedLines(current.page, rowGuidance, left + cols[0] + cols[1] + cols[2] + 8, y + rowHeight - 18, 8, fonts, cols[3] - 12, 10);
    remainingAnswer = remainingAnswer.slice(rowAnswer.length);
    remainingGuidance = remainingGuidance.slice(rowGuidance.length);
    current.y = y - 10;
    continuation = true;
    if (remainingAnswer.length > 0 || remainingGuidance.length > 0) {
      current = newOcrTablePage(outputDoc, row.unit, fonts, current.pageNumber + 1);
    }
  } while (remainingAnswer.length > 0 || remainingGuidance.length > 0);

  return current;
}

function bulletItemsThatFit(items: BulletLine[], maxHeight: number, fonts: MarkSchemeFonts, size: number, maxWidth: number, lineHeight: number) {
  let height = 0;
  let count = 0;
  for (const item of items) {
    const itemHeight = bulletItemsHeight([item], fonts, size, maxWidth, lineHeight);
    if (count > 0 && height + itemHeight > maxHeight) break;
    if (count === 0 && itemHeight > maxHeight) return 1;
    height += itemHeight;
    count += 1;
  }
  return count;
}

function splitBulletItem(item: BulletLine, maxHeight: number, fonts: MarkSchemeFonts, size: number, maxWidth: number, lineHeight: number) {
  const indent = item.indent ? 14 : 0;
  const lines = wrapText(item.text, item.bold ? fonts.bold : fonts.regular, size, maxWidth - indent - 12);
  const linesPerChunk = Math.max(1, Math.floor(maxHeight / lineHeight));
  const chunks: BulletLine[] = [];
  for (let index = 0; index < lines.length; index += linesPerChunk) {
    chunks.push({
      ...item,
      text: lines.slice(index, index + linesPerChunk).join(" "),
      bullet: index === 0 ? item.bullet : false,
    });
  }
  return chunks;
}

function drawAqaGeographyMarkSchemeTableRow(outputDoc: PDFDocument, layout: TableLayout | null, row: { unit: MarkableUnit; order: number; text: string; lines?: StructuredPdfLine[]; totalRow?: boolean }, fonts: MarkSchemeFonts) {
  const entry = buildStructuredEntry(row.unit, row.text);
  const contentW = MS_GUIDANCE_W - 18;
  const promptLines = wrapText(entry.prompt, fonts.bold, 8.8, contentW);
  const levelItems = entry.levels.length > 0 ? levelGuidanceItems(entry.guidance) : [];
  const guidanceLines = entry.levels.length > 0 ? [] : guidanceDisplayLines(entry.guidance, fonts, 8, contentW);
  const answerHeight = entry.answerLetter && entry.answerText ? 24 : 0;
  const levelsHeight = levelTableHeight(entry.levels, fonts, contentW);
  const levelItemsHeight = levelItems.length > 0 ? bulletItemsHeight(levelItems, fonts, 7.8, contentW, 9) + 8 : 0;
  const indicativeItems = indicativeContentItems(entry.indicativeContent);
  let remainingItems = indicativeItems;
  let current = layout ?? newTablePage(outputDoc, fonts, 1);
  let continuation = false;

  do {
    const rowPromptLines = continuation ? [] : promptLines;
    const rowLevelsHeight = continuation ? 0 : levelsHeight;
    const rowLevelItems = continuation ? [] : levelItems;
    const rowLevelItemsHeight = continuation ? 0 : levelItemsHeight;
    const rowGuidanceLines = continuation ? [] : guidanceLines;
    const rowAnswerHeight = continuation ? 0 : answerHeight;
    const fixedHeight = 36
      + rowPromptLines.length * 11
      + rowAnswerHeight
      + rowGuidanceLines.length * 11
      + rowLevelsHeight
      + rowLevelItemsHeight
      + (rowLevelsHeight > 0 ? 34 : 12);
    const titleHeight = remainingItems.length > 0 ? 25 : 0;
    const firstItemHeight = remainingItems.length > 0 ? bulletItemsHeight([remainingItems[0]], fonts, 7.8, contentW, 9) : 0;

    if (current.y !== MS_TOP - 22 && current.y - MS_BOTTOM < fixedHeight + titleHeight + firstItemHeight) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
      continue;
    }

    const itemCapacity = current.y - MS_BOTTOM - fixedHeight - titleHeight;
    if (remainingItems.length > 0 && itemCapacity >= 9 && itemCapacity < firstItemHeight) {
      remainingItems = [...splitBulletItem(remainingItems[0], itemCapacity, fonts, 7.8, contentW, 9), ...remainingItems.slice(1)];
      continue;
    }
    const itemCount = itemCapacity < firstItemHeight
      ? 0
      : bulletItemsThatFit(remainingItems, itemCapacity, fonts, 7.8, contentW, 9);
    const rowItems = remainingItems.slice(0, itemCount);
    const indicativeHeight = rowItems.length > 0 ? titleHeight + bulletItemsHeight(rowItems, fonts, 7.8, contentW, 9) : 0;
    const rowHeight = Math.max(58, fixedHeight + indicativeHeight);
    const y = current.y - rowHeight;
    const textX = MS_LEFT + MS_QUESTION_W + MS_PART_W + 8;

    current.page.drawRectangle({ x: MS_LEFT, y, width: MS_RIGHT - MS_LEFT, height: rowHeight, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.7 });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W, y }, end: { x: MS_LEFT + MS_QUESTION_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y }, end: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_RIGHT - MS_MARKS_W, y }, end: { x: MS_RIGHT - MS_MARKS_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawText(continuation ? "" : rowQuestionLabel(row.order), { x: MS_LEFT + 8, y: y + rowHeight - 18, size: 12, font: fonts.regular });
    current.page.drawText(continuation ? "cont." : rowPartLabel(row.unit, row.totalRow), { x: MS_LEFT + MS_QUESTION_W + 8, y: y + rowHeight - 18, size: 10, font: fonts.regular });
    current.page.drawText(String(row.unit.totalMarks), { x: MS_RIGHT - MS_MARKS_W + 20, y: y + rowHeight - 18, size: 12, font: fonts.regular });

    let textY = y + rowHeight - 18;
    textY = drawWrappedLines(current.page, rowPromptLines, textX, textY, 8.8, fonts.bold, 11);
    if (!continuation && entry.answerLetter && entry.answerText) {
      textY -= 8;
      current.page.drawText(`${entry.answerLetter}.`, { x: textX, y: textY, size: 9.4, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
      current.page.drawText(entry.answerText, { x: textX + 24, y: textY, size: 9.4, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
      textY -= 18;
    }
    if (!continuation && entry.levels.length > 0) textY = drawLevelTable(current.page, entry.levels, textX, textY - 8, contentW, fonts) - 12;
    if (rowGuidanceLines.length > 0) textY = drawAoAwareWrappedLines(current.page, rowGuidanceLines, textX, textY - 4, 8, fonts, contentW, 10);
    if (rowLevelItems.length > 0) textY = drawBulletItems(current.page, rowLevelItems, textX, textY - 8, 7.8, fonts, contentW, 9);
    if (rowItems.length > 0) {
      current.page.drawText("Indicative content", { x: textX, y: textY - 8, size: 8, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
      drawBulletItems(current.page, rowItems, textX, textY - 19, 7.8, fonts, contentW, 9);
    }

    remainingItems = remainingItems.slice(itemCount);
    current.y = y - 12;
    if (remainingItems.length > 0) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
      continuation = true;
    }
  } while (remainingItems.length > 0);

  return current;
}

function drawAqaBusinessMarkSchemeTableRow(outputDoc: PDFDocument, layout: TableLayout | null, row: { unit: MarkableUnit; order: number; text: string; lines?: StructuredPdfLine[]; totalRow?: boolean }, fonts: MarkSchemeFonts) {
  const entry = buildStructuredEntry(row.unit, row.text);
  const contentW = MS_GUIDANCE_W - 18;
  const promptLines = wrapText(entry.prompt, fonts.bold, 8.8, contentW);
  const guidanceLines = guidanceDisplayLines(entry.guidance || row.text, fonts, 8, contentW);
  const answerHeight = entry.answerLetter && entry.answerText ? 24 : 0;
  let remainingLines = guidanceLines;
  let current = layout ?? newTablePage(outputDoc, fonts, 1);
  let continuation = false;

  do {
    const rowPromptLines = continuation ? [] : promptLines;
    const rowAnswerHeight = continuation ? 0 : answerHeight;
    const fixedHeight = 36 + rowPromptLines.length * 11 + rowAnswerHeight + 12;
    const firstLineHeight = remainingLines.length > 0 ? 10 : 0;
    if (current.y !== MS_TOP - 22 && current.y - MS_BOTTOM < fixedHeight + firstLineHeight) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
      continue;
    }

    const lineCapacity = Math.max(0, Math.floor((current.y - MS_BOTTOM - fixedHeight) / 10));
    const rowLines = remainingLines.slice(0, lineCapacity);
    const rowHeight = Math.max(58, fixedHeight + rowLines.length * 10);
    const y = current.y - rowHeight;
    const textX = MS_LEFT + MS_QUESTION_W + MS_PART_W + 8;

    current.page.drawRectangle({ x: MS_LEFT, y, width: MS_RIGHT - MS_LEFT, height: rowHeight, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.7 });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W, y }, end: { x: MS_LEFT + MS_QUESTION_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y }, end: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_RIGHT - MS_MARKS_W, y }, end: { x: MS_RIGHT - MS_MARKS_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawText(continuation ? "" : rowQuestionLabel(row.order), { x: MS_LEFT + 8, y: y + rowHeight - 18, size: 12, font: fonts.regular });
    current.page.drawText(continuation ? "cont." : rowPartLabel(row.unit, row.totalRow), { x: MS_LEFT + MS_QUESTION_W + 8, y: y + rowHeight - 18, size: 10, font: fonts.regular });
    current.page.drawText(String(row.unit.totalMarks), { x: MS_RIGHT - MS_MARKS_W + 20, y: y + rowHeight - 18, size: 12, font: fonts.regular });

    let textY = y + rowHeight - 18;
    textY = drawWrappedLines(current.page, rowPromptLines, textX, textY, 8.8, fonts.bold, 11);
    if (!continuation && entry.answerLetter && entry.answerText) {
      textY -= 8;
      current.page.drawText(`${entry.answerLetter}.`, { x: textX, y: textY, size: 9.4, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
      current.page.drawText(entry.answerText, { x: textX + 24, y: textY, size: 9.4, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
      textY -= 18;
    }
    drawAoAwareWrappedLines(current.page, rowLines, textX, textY - 4, 8, fonts, contentW, 10);

    remainingLines = remainingLines.slice(rowLines.length);
    current.y = y - 12;
    if (remainingLines.length > 0) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
      continuation = true;
    }
  } while (remainingLines.length > 0);

  return current;
}

function drawMarkSchemeTableRow(outputDoc: PDFDocument, layout: TableLayout | null, row: { unit: MarkableUnit; order: number; text: string; lines?: StructuredPdfLine[]; continuation?: boolean; totalRow?: boolean }, fonts: MarkSchemeFonts) {
  const renderedRow = row.totalRow ? { ...row, text: formatGeneratedTotalRow(row.unit, row.order) } : row;
  if (row.unit.subjectSlug === "mathematics") return drawMathMarkSchemeTableRow(outputDoc, layout, renderedRow, fonts);
  if (row.unit.subjectSlug === "computer-science") return drawOcrMarkSchemeTableRow(outputDoc, layout, renderedRow, fonts);
  if (row.unit.boardCode === "aqa" && row.unit.subjectSlug === "geography" && extractIndicativeContent(cleanFallbackGuidance(renderedRow.text, row.unit))) {
    return drawAqaGeographyMarkSchemeTableRow(outputDoc, layout, renderedRow, fonts);
  }
  if (row.unit.boardCode === "aqa" && row.unit.subjectSlug === "business" && buildStructuredEntry(row.unit, renderedRow.text).levels.length === 0) {
    return drawAqaBusinessMarkSchemeTableRow(outputDoc, layout, renderedRow, fonts);
  }
  const entry = buildStructuredEntry(row.unit, renderedRow.text, row.continuation);
  if (row.continuation && row.unit.boardCode === "aqa" && row.unit.subjectSlug === "geography" && !entry.guidance && !entry.indicativeContent && entry.levels.length === 0) return layout;
  const contentW = MS_GUIDANCE_W - 18;
  const promptLines = wrapText(entry.prompt, fonts.bold, 8.8, contentW);
  const levelItems = entry.levels.length > 0 ? levelGuidanceItems(entry.guidance) : [];
  const guidanceLines = entry.levels.length > 0 ? [] : guidanceDisplayLines(entry.guidance, fonts, 8, contentW);
  const answerHeight = entry.answerLetter && entry.answerText ? 24 : 0;
  const levelsHeight = levelTableHeight(entry.levels, fonts, contentW);
  let remainingGuidance = guidanceLines;
  let remainingLevelItems = levelItems;
  let remainingIndicativeItems = indicativeContentItems(entry.indicativeContent);
  let current = layout ?? newTablePage(outputDoc, fonts, 1);
  let continuation = row.continuation ?? false;
  let hasDrawnRow = false;

  do {
    const rowPromptLines = continuation ? [] : promptLines;
    const rowAnswerHeight = continuation ? 0 : answerHeight;
    const rowLevelsHeight = continuation ? 0 : levelsHeight;
    const fixedHeight = 36
      + rowPromptLines.length * 11
      + rowAnswerHeight
      + rowLevelsHeight
      + (entry.levels.length > 0 ? 34 : 12);
    if (current.y !== MS_TOP - 22 && current.y - MS_BOTTOM < fixedHeight + 10) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
      continue;
    }

    const availableHeight = Math.max(0, current.y - MS_BOTTOM - fixedHeight);
    const guidanceCount = Math.min(remainingGuidance.length, Math.floor(availableHeight / 10));
    const rowGuidanceLines = remainingGuidance.slice(0, guidanceCount);
    let usedHeight = rowGuidanceLines.length * 10;

    const levelItemCapacity = Math.max(0, availableHeight - usedHeight);
    if (remainingLevelItems.length > 0) {
      const firstItemHeight = bulletItemsHeight([remainingLevelItems[0]], fonts, 7.8, contentW, 9);
      if (levelItemCapacity >= 9 && levelItemCapacity < firstItemHeight) {
        remainingLevelItems = [...splitBulletItem(remainingLevelItems[0], levelItemCapacity, fonts, 7.8, contentW, 9), ...remainingLevelItems.slice(1)];
        continue;
      }
    }
    const levelItemCount = bulletItemsThatFit(remainingLevelItems, levelItemCapacity, fonts, 7.8, contentW, 9);
    const rowLevelItems = remainingLevelItems.slice(0, levelItemCount);
    const levelItemsHeight = rowLevelItems.length > 0 ? bulletItemsHeight(rowLevelItems, fonts, 7.8, contentW, 9) : 0;
    usedHeight += levelItemsHeight;

    let indicativeItemCount = 0;
    const indicatorCapacity = Math.max(0, availableHeight - usedHeight - (remainingIndicativeItems.length > 0 ? 25 : 0));
    if (remainingIndicativeItems.length > 0) {
      const firstItemHeight = bulletItemsHeight([remainingIndicativeItems[0]], fonts, 7.8, contentW, 9);
      if (indicatorCapacity >= 9 && indicatorCapacity < firstItemHeight) {
        remainingIndicativeItems = [...splitBulletItem(remainingIndicativeItems[0], indicatorCapacity, fonts, 7.8, contentW, 9), ...remainingIndicativeItems.slice(1)];
        continue;
      }
      indicativeItemCount = bulletItemsThatFit(remainingIndicativeItems, indicatorCapacity, fonts, 7.8, contentW, 9);
    }
    const rowIndicativeItems = remainingIndicativeItems.slice(0, indicativeItemCount);
    const indicativeHeight = rowIndicativeItems.length > 0
      ? 25 + bulletItemsHeight(rowIndicativeItems, fonts, 7.8, contentW, 9)
      : 0;
    const rowHeight = Math.max(58, fixedHeight + usedHeight + indicativeHeight);
    const y = current.y - rowHeight;
    current.page.drawRectangle({ x: MS_LEFT, y, width: MS_RIGHT - MS_LEFT, height: rowHeight, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.7 });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W, y }, end: { x: MS_LEFT + MS_QUESTION_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y }, end: { x: MS_LEFT + MS_QUESTION_W + MS_PART_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawLine({ start: { x: MS_RIGHT - MS_MARKS_W, y }, end: { x: MS_RIGHT - MS_MARKS_W, y: y + rowHeight }, thickness: 0.5, color: rgb(0.05, 0.05, 0.05) });
    current.page.drawText(continuation ? "" : rowQuestionLabel(row.order), { x: MS_LEFT + 8, y: y + rowHeight - 18, size: 12, font: fonts.regular });
    current.page.drawText(continuation ? "cont." : rowPartLabel(row.unit, row.totalRow), { x: MS_LEFT + MS_QUESTION_W + 8, y: y + rowHeight - 18, size: 10, font: fonts.regular });
    current.page.drawText(String(row.unit.totalMarks), { x: MS_RIGHT - MS_MARKS_W + 20, y: y + rowHeight - 18, size: 12, font: fonts.regular });

    let textY = y + rowHeight - 18;
    const textX = MS_LEFT + MS_QUESTION_W + MS_PART_W + 8;
    textY = drawWrappedLines(current.page, rowPromptLines, textX, textY, 8.8, fonts.bold, 11);
    if (!continuation && entry.answerLetter && entry.answerText) {
      textY -= 8;
      current.page.drawText(`${entry.answerLetter}.`, { x: textX, y: textY, size: 9.4, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
      current.page.drawText(entry.answerText, { x: textX + 24, y: textY, size: 9.4, font: fonts.regular, color: rgb(0.05, 0.05, 0.05) });
      textY -= 18;
    }
    if (!continuation && entry.levels.length > 0) {
      textY -= 8;
      textY = drawLevelTable(current.page, entry.levels, textX, textY, contentW, fonts) - 12;
    }
    if (rowGuidanceLines.length > 0) {
      if (rowPromptLines.length > 0 || entry.answerLetter || entry.levels.length > 0) textY -= 4;
      textY = drawAoAwareWrappedLines(current.page, rowGuidanceLines, textX, textY, 8, fonts, contentW, 10);
    }
    if (rowLevelItems.length > 0) {
      textY -= 8;
      textY = drawBulletItems(current.page, rowLevelItems, textX, textY, 7.8, fonts, contentW, 9);
    }
    if (rowIndicativeItems.length > 0) {
      textY -= 8;
      current.page.drawText("Indicative content", { x: textX, y: textY, size: 8, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) });
      textY -= 11;
      drawBulletItems(current.page, rowIndicativeItems, textX, textY, 7.8, fonts, contentW, 9);
    }

    remainingGuidance = remainingGuidance.slice(rowGuidanceLines.length);
    remainingLevelItems = remainingLevelItems.slice(rowLevelItems.length);
    remainingIndicativeItems = remainingIndicativeItems.slice(rowIndicativeItems.length);
    current.y = y - 12;
    hasDrawnRow = true;
    continuation = true;
    if (remainingGuidance.length > 0 || remainingLevelItems.length > 0 || remainingIndicativeItems.length > 0) {
      current = newTablePage(outputDoc, fonts, current.pageNumber + 1);
    }
  } while (!hasDrawnRow || remainingGuidance.length > 0 || remainingLevelItems.length > 0 || remainingIndicativeItems.length > 0);

  return current;
}

function drawLabelBand(page: import("pdf-lib").PDFPage, label: string, font: import("pdf-lib").PDFFont) {
  const { width, height } = page.getSize();
  const bandHeight = 18;
  const size = 8;
  const padX = 6;
  page.drawRectangle({
    x: 0,
    y: height - bandHeight,
    width,
    height: bandHeight,
    color: rgb(0.93, 0.93, 0.95),
  });
  page.drawText(label, {
    x: padX,
    y: height - bandHeight + (bandHeight - size) / 2 + 1,
    size,
    font,
    color: rgb(0.35, 0.36, 0.4),
  });
}

function drawTextFallbackPages(outputDoc: PDFDocument, text: string, font: import("pdf-lib").PDFFont) {
  const sanitized = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  const words = sanitized.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 100) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  const pages: import("pdf-lib").PDFPage[] = [];
  for (let offset = 0; offset < Math.max(1, lines.length); offset += 46) {
    const page = outputDoc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 36, y: 36, width: 523.28, height: 769.89, borderColor: rgb(0.88, 0.88, 0.88), borderWidth: 1 });
    page.drawText("Selected mark scheme excerpt", {
      x: 56,
      y: 792,
      size: 14,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    let y = 762;
    for (const renderedLine of lines.slice(offset, offset + 46)) {
      page.drawText(renderedLine, { x: 56, y, size: 8.5, font, color: rgb(0.12, 0.12, 0.12), maxWidth: 480, lineHeight: 10 });
      y -= 13;
    }
    page.drawText("Auto-cropped from the selected question pages.", { x: 56, y: 48, size: 7, font, color: rgb(0.45, 0.45, 0.45) });
    pages.push(page);
  }
  return pages;
}
