import "./shims/canvas-polyfill.mjs";

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { QuestionIdentityAnchor } from "@/shared/domain/paper";
import { discoverGroupedQuestionIdentityAnchors } from "./question-identity-anchor";

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/none of these types|AbortException/i.test(message)) return;
  console.error(reason);
  process.exit(1);
});

import { extractReferencedSupportLabels, isFooterFurnitureLine, isHeaderFurnitureLine, matchSupportCaption } from "@/features/papers/builder/domain/page-text";

type BoundingBox = { x0: number; y0: number; x1: number; y1: number };
type TextLine = { text: string; bbox: BoundingBox; y: number; spans?: Array<{ text: string; bbox: BoundingBox }> };

type RegionSpan = { page_number: number; y_top: number; y_bottom: number };

type ExtractedFigure = { label: string; page_number: number; y_top: number; y_bottom: number };

type ExtractedPageLayout = {
  page_number: number;
  page_width: number;
  page_height: number;
  content_x0: number;
  content_x1: number;
  header_floor_y: number;
  footer_ceiling_y: number;
};

type ExtractedAsset = {
  asset_id: string;
  kind: "page_pdf";
  page_number: number;
  bbox: null;
  file_path: string;
  description: string;
};

type ExtractedPage = {
  page_number: number;
  section_code: string | null;
  section_name: string | null;
  text_lines: TextLine[];
  image_asset_ids: string[];
  page_text: string;
};

type ExtractedQuestionPart = {
  question_id: string;
  page_number: number;
  page_numbers: number[];
  question_number: string;
  question_part_number: string | null;
  question_path: string[];
  section_code: string | null;
  section_name: string | null;
  paper_code: string;
  paper_name: string;
  context_text: string | null;
  marks: number | null;
  source_total_marks: number | null;
  marks_validated: "validated" | "mismatch" | "unknown";
  command_word: string | null;
  prompt_text: string;
  normalized_text: string;
  source_mode: "full_page" | "crop_or_text";
  bbox: BoundingBox | null;
  identity_anchor: QuestionIdentityAnchor | null;
  region_spans: RegionSpan[] | null;
  stem_spans: RegionSpan[] | null;
  referenced_support_labels: string[];
  asset_ids: string[];
  parser_notes: string[];
  isChoiceQuestion: boolean;
  choiceGroupId: string | null;
  choiceGroupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice" | null;
  choiceOptionLabel: string | null;
  choiceOptionIndex: number | null;
  choiceSiblingQuestionIds: string[];
  sharedChoiceStem: string | null;
};

type ExtractedPaper = {
  source_file: string;
  board_code: string;
  subject_slug: string;
  paper_code: string;
  year: number | null;
  session: string | null;
  parser_version: string;
  pages: ExtractedPage[];
  question_parts: ExtractedQuestionPart[];
  assets: ExtractedAsset[];
  figures: ExtractedFigure[];
  page_layouts: ExtractedPageLayout[];
};

type ActiveQuestionPart = {
  page_number: number;
  page_numbers: Set<number>;
  question_number: string;
  question_part_number: string | null;
  question_path: string[];
  section_code: string | null;
  section_name: string | null;
  paper_code: string;
  paper_name: string;
  contextTexts: string[];
  promptLines: TextLine[];
  assetIds: Set<string>;
  choiceGroupId: string | null;
  choiceGroupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice" | null;
  choiceOptionLabel: string | null;
  sharedChoiceStem: string | null;
  start_page: number;
  start_line_top: number;
  context_lines: PageAnchoredLine[];
};

type PageAnchoredLine = { page_number: number; line: TextLine };

type PartEndBoundary = { page_number: number; y: number } | null;

type PartAnchor = {
  start_page: number;
  start_line_top: number;
  start_line_bbox: BoundingBox | null;
  context_lines: PageAnchoredLine[];
  end: PartEndBoundary;
  stems: QuestionStemAnchor[];
};

type QuestionStemAnchor = {
  question_number: string;
  start_page: number;
  start_top: number;
  context_lines: PageAnchoredLine[];
  subpart_start_page: number;
  subpart_start_top: number;
  introducedLabels: string[];
};

type BoardConfig = {
  name: string;
  subquestionRe: RegExp;
  topLevelQuestionRe: RegExp;
  marksRe: RegExp;
  hasMarksRe: RegExp;
  fillerPatterns: RegExp[];
  contextTerminators: RegExp[];
  isMCOption: (text: string) => boolean;
  isAnswerSlot: (text: string) => boolean;
  inferPaperCode: (fileName: string) => string;
  inferPaperName: (paperCode: string) => string;
  shouldSkipPage: (pageNumber: number, pageText: string) => boolean;
  detectSection: (pageText: string, currentSectionCode: string | null) => { code: string | null; name: string | null };
};

const COMMAND_WORDS = [
  "describe", "explain", "evaluate", "assess", "analyse", "analyze",
  "suggest", "state", "give", "identify", "complete", "compare",
  "justify", "calculate", "outline", "discuss", "name",
];

const PARSER_VERSION = "generic-v0.4-maths-boundaries";

const AQA_FILLER = [
  /^pmt$/i, /^ib\/g\//i, /^\*\d+\*$/, /^\d+$/, /^turn over\b/i,
  /^extra space$/i, /^end of (section|question)/i,
  /^question \d+ continues on the next page/i,
  /^turn over for (section|question)/i, /^do not write/i,
  /^answer in the spaces/i, /^shade one circle/i, /^tick /i,
  /^for examiner/i, /^question mark$/i, /^total$/i, /^mark$/i,
];

const EDEXCEL_FILLER = [
  /^p\d+[a-z]\d+[a-z]\d*$/i, /^\*p\d+[a-z]\d+[a-z]\d*\*$/i,
  /^\d+$/, /^turn over\b/i, /^do not write in this area/i,
  /^answer all questions/i, /^some questions must be answered/i,
  /^if you change your mind/i, /^total marks$/i, /^centre number/i,
  /^candidate number/i, /^candidate surname/i, /^other names/i,
  /^please check the examination/i, /^pearson edexcel/i,
  /^/i, /^f:\d/i, /^copyright/i, /^paper reference/i,
];

const OCR_FILLER = [
  /^\d+$/, /^turn over\b/i, /^do not write in the barcodes/i,
  /^please write clearly/i, /^oxford cambridge and rsa/i,
  /^ocr is an exempt charity/i, /^end of (section|question)/i,
  /^blank page/i, /^answer all the questions/i,
  /^write your answer on this page/i, /^copyright/i,
];

const AQA_CONTEXT_TERMINATORS = [
  /^figure \d+/i, /^study (either )?(figure|map|graph|diagram|photograph|poster|data)/i,
  /^question \d+/i, /^section [a-z]/i, /^the area labelled/i,
];

const EDEXCEL_CONTEXT_TERMINATORS = [
  /^figure \d+/i, /^study (either )?(figure|map|graph|diagram|photograph)/i,
  /^question \d+/i, /^section [a-z]/i,
  /^here (is|are)\b/i, /^shown (below|here|is|are)\b/i,
];

const OCR_CONTEXT_TERMINATORS = [
  /^figure \d+/i, /^study (figure|diagram|graph)/i,
  /^question \d+/i, /^section [a-z]/i,
];

const BOARD_CONFIGS: Record<string, BoardConfig> = {
  aqa: {
    name: "AQA",
    subquestionRe: /^0\s+(\d{1,2})\s*\.\s*(\d(?:\s*\d)?)\b/,
    topLevelQuestionRe: /^question\s+(\d{1,2})\b/i,
    marksRe: /\[\+?\s*(\d{1,2})\s*(?:spag\s*)?marks?\]/gi,
    hasMarksRe: /\[\+?\s*\d{1,2}\s*(?:spag\s*)?marks?\]/i,
    fillerPatterns: AQA_FILLER,
    contextTerminators: AQA_CONTEXT_TERMINATORS,
    isMCOption: (text) => /^[A-D]\s/.test(text.trim()),
    isAnswerSlot: (text) => /^(size|shape|relief|drainage|hot desert|cold environment)$|^km[23]?$|^\d{1,2}$/.test(text.trim()),
    inferPaperCode: (fileName) => {
      const lower = fileName.toLowerCase();
      if (lower.includes("paper-1") || lower.includes("paper 1")) return "paper-1";
      if (lower.includes("paper-2") || lower.includes("paper 2")) return "paper-2";
      if (lower.includes("paper-3") || lower.includes("paper 3")) return "paper-3";
      if (lower.includes("component-1") || lower.includes("component 1")) return "paper-1";
      if (lower.includes("component-2") || lower.includes("component 2")) return "paper-2";
      if (lower.includes("component-3") || lower.includes("component 3")) return "paper-3";
      const bioMatch = lower.match(/biology[-\s](\d)/);
      if (bioMatch) return `paper-${bioMatch[1]}`;
      const chemMatch = lower.match(/chemistry[-\s](\d)/);
      if (chemMatch) return `paper-${chemMatch[1]}`;
      const physMatch = lower.match(/physics[-\s](\d)/);
      if (physMatch) return `paper-${physMatch[1]}`;
      return "unknown";
    },
    inferPaperName: (paperCode) => paperCode,
    shouldSkipPage: (pageNumber, pageText) => {
      const lower = pageText.toLowerCase();
      if (pageNumber === 1) return true;
      if (lower.includes("there are no questions printed on this page")) return true;
      if (lower.includes("additional page, if required")) return true;
      if (lower.includes("copyright information")) return true;
      return false;
    },
    detectSection: (pageText, current) => {
      const sectionMatch = pageText.match(/(^|\n)\s*section\s+([a-z])\b/im);
      if (sectionMatch) return { code: sectionMatch[2].toUpperCase(), name: null };
      return { code: current, name: null };
    },
  },
  edexcel: {
    name: "Edexcel",
    subquestionRe: /^(\d{1,2})\s*\*?\s*\(((?:[a-z]|[ivx]{2,4}))\)/i,
    topLevelQuestionRe: /^question\s+(\d{1,2})\b/i,
    marksRe: /\((\d{1,2})\)/gi,
    hasMarksRe: /\(\d{1,2}\)/,
    fillerPatterns: EDEXCEL_FILLER,
    contextTerminators: EDEXCEL_CONTEXT_TERMINATORS,
    isMCOption: (text) => /^[A-D]\s/.test(text.trim()),
    isAnswerSlot: (text) => /^km[23]?$|^\d{1,2}$/.test(text.trim()),
    inferPaperCode: (fileName) => {
      const lower = fileName.toLowerCase();
      const businessComponentMatch = lower.match(/\b1bs0[-_\s]?0?([12])\b/i);
      if (businessComponentMatch) return `paper-${businessComponentMatch[1]}`;
      if (lower.includes("paper-1") || lower.includes("paper 1") || lower.includes("paper-1a") || lower.includes("paper 1a")) return "paper-1";
      if (lower.includes("paper-1b") || lower.includes("paper 1b")) return "paper-1b";
      if (lower.includes("paper-2") || lower.includes("paper 2")) return "paper-2";
      if (lower.includes("paper-3") || lower.includes("paper 3")) return "paper-3";
      if (lower.includes("component-1") || lower.includes("component 1")) return "paper-1";
      if (lower.includes("component-2") || lower.includes("component 2")) return "paper-2";
      if (lower.includes("component-3") || lower.includes("component 3")) return "paper-3";
      const bioMatch = lower.match(/biology[-\s](\d)/);
      if (bioMatch) return `paper-${bioMatch[1]}`;
      const chemMatch = lower.match(/chemistry[-\s](\d)/);
      if (chemMatch) return `paper-${chemMatch[1]}`;
      const physMatch = lower.match(/physics[-\s](\d)/);
      if (physMatch) return `paper-${physMatch[1]}`;
      return "unknown";
    },
    inferPaperName: (paperCode) => paperCode,
    shouldSkipPage: (pageNumber, pageText) => {
      const lower = pageText.toLowerCase();
      if (pageNumber === 1) return true;
      if (lower.includes("blank page")) return true;
      if (/(^|\n)copyright\b/i.test(pageText)) return true;
      if (lower.includes("pls booklet")) return true;
      if (lower.includes("do not return this booklet with the question paper")) return true;
      if (lower.includes("supported subprograms")) return true;
      return false;
    },
    detectSection: (pageText, current) => {
      const sectionMatch = pageText.match(/(^|\n)\s*section\s+([a-z])\b/im);
      if (sectionMatch) return { code: sectionMatch[2].toUpperCase(), name: null };
      return { code: current, name: null };
    },
  },
  ocr: {
    name: "OCR",
    subquestionRe: /^(\d{1,2})\s*\(((?:[a-z]|[ivx]{2,4}))\)/i,
    topLevelQuestionRe: /^question\s+(\d{1,2})\b/i,
    marksRe: /\[\s*(\d{1,2})\s*\]/gi,
    hasMarksRe: /\[\s*\d{1,2}\s*\]/,
    fillerPatterns: OCR_FILLER,
    contextTerminators: OCR_CONTEXT_TERMINATORS,
    isMCOption: (text) => /^[A-D]\s/.test(text.trim()),
    isAnswerSlot: (text) => /^\d{1,2}$/.test(text.trim()),
    inferPaperCode: (fileName) => {
      const lower = fileName.toLowerCase();
      if (lower.includes("paper-1") || lower.includes("paper 1") || lower.includes("component-1") || lower.includes("component 1")) return "paper-1";
      if (lower.includes("paper-2") || lower.includes("paper 2") || lower.includes("component-2") || lower.includes("component 2")) return "paper-2";
      return "unknown";
    },
    inferPaperName: (paperCode) => paperCode,
    shouldSkipPage: (pageNumber, pageText) => {
      const lower = pageText.toLowerCase();
      if (pageNumber === 1) return true;
      if (lower.includes("blank page")) return true;
      return false;
    },
    detectSection: (pageText, current) => {
      const sectionMatch = pageText.match(/(^|\n)\s*section\s+([a-z])\b/im);
      if (sectionMatch) return { code: sectionMatch[2].toUpperCase(), name: null };
      return { code: current, name: null };
    },
  },
};

function inferBoardFromFilename(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes("edexcel")) return "edexcel";
  if (lower.includes("ocr")) return "ocr";
  return "aqa";
}

function inferBoard(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.includes("/edexcel/") || lower.includes("\\edexcel\\")) return "edexcel";
  if (lower.includes("/ocr/") || lower.includes("\\ocr\\")) return "ocr";
  if (lower.includes("/aqa/") || lower.includes("\\aqa\\")) return "aqa";
  return inferBoardFromFilename(basename(filePath));
}

function inferSubjectFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const downloadsIdx = parts.findIndex((p) => p === "downloads");
  if (downloadsIdx >= 0 && downloadsIdx + 2 < parts.length) {
    return parts[downloadsIdx + 2];
  }
  if (downloadsIdx >= 0 && downloadsIdx + 1 < parts.length) {
    return parts[downloadsIdx + 1];
  }
  return "unknown";
}

function inferYear(fileName: string) {
  const match = fileName.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function inferSession(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.includes("june") || lower.includes("jun")) return "june";
  if (lower.includes("november") || lower.includes("nov")) return "november";
  return null;
}

function buildQuestionId(pageNumber: number, questionNumber: string, questionPartNumber: string | null) {
  return questionPartNumber
    ? `p${pageNumber}-q${questionNumber}-${questionPartNumber}`
    : `p${pageNumber}-q${questionNumber}`;
}

function allocateQuestionId(
  pageNumber: number,
  questionNumber: string,
  questionPartNumber: string | null,
  questionIdCounts: Map<string, number>,
) {
  const baseId = buildQuestionId(pageNumber, questionNumber, questionPartNumber);
  const occurrence = (questionIdCounts.get(baseId) ?? 0) + 1;
  questionIdCounts.set(baseId, occurrence);
  return occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
}

function finalizeQuestionPart(
  active: ActiveQuestionPart,
  config: BoardConfig,
  questionIdCounts: Map<string, number>,
): ExtractedQuestionPart {
  const allTexts = [...active.contextTexts, ...active.promptLines.map((l) => l.text)];
  const rawCombinedText = normalizeText(allTexts.join(" "));
  const combinedText = cleanText(rawCombinedText);
  const contextOnly = active.contextTexts.length > 0 ? cleanText(active.contextTexts.join(" ")) : null;
  const pageNumbers = Array.from(active.page_numbers).sort((a, b) => a - b);
  const bbox = mergeBBoxes(active.promptLines);
  const mode = determineSourceMode(pageNumbers, bbox);
  const questionId = allocateQuestionId(active.page_number, active.question_number, active.question_part_number, questionIdCounts);
  return {
    question_id: questionId,
    page_number: active.page_number,
    page_numbers: pageNumbers,
    question_number: active.question_number,
    question_part_number: active.question_part_number,
    question_path: active.question_path,
    section_code: active.section_code,
    section_name: active.section_name,
    paper_code: active.paper_code,
    paper_name: active.paper_name,
    context_text: contextOnly,
    marks: extractMarks(rawCombinedText, active.question_part_number, config),
    source_total_marks: null,
    marks_validated: "unknown",
    command_word: extractCommandWord(combinedText),
    prompt_text: combinedText,
    normalized_text: cleanedNormalizedText(combinedText),
    source_mode: mode,
    bbox,
    identity_anchor: null,
    region_spans: null,
    stem_spans: null,
    referenced_support_labels: extractReferencedSupportLabels(rawCombinedText),
    asset_ids: Array.from(active.assetIds).sort(),
    parser_notes: mode === "full_page" ? ["Preserve whole source page when regenerating this question part."] : [],
    isChoiceQuestion: active.choiceGroupId !== null,
    choiceGroupId: active.choiceGroupId,
    choiceGroupType: active.choiceGroupType,
    choiceOptionLabel: active.choiceOptionLabel,
    choiceOptionIndex: active.choiceOptionLabel ? "ABCDEF".indexOf(active.choiceOptionLabel.toUpperCase()) : null,
    choiceSiblingQuestionIds: [],
    sharedChoiceStem: active.sharedChoiceStem,
  };
}

function attachQuestionIdentityAnchors(questionParts: ExtractedQuestionPart[], pages: ExtractedPage[], boardCode: string, subjectSlug: string) {
  const pagesForDiscovery = pages.map((page) => ({ pageNumber: page.page_number, lines: page.text_lines }));
  const assigned = discoverGroupedQuestionIdentityAnchors({
    boardCode,
    subjectSlug,
    pages: pagesForDiscovery,
    parts: questionParts.map((part) => ({
      questionId: part.question_id,
      questionNumber: part.question_number,
      questionPartNumber: part.question_part_number,
      sectionCode: part.section_code,
      choiceGroupId: part.choiceGroupId,
      pageNumber: part.page_number,
      pageNumbers: part.page_numbers,
      identity_anchor: part.identity_anchor,
    })),
  });
  const anchors = new Map(assigned.parts.map((part) => [part.questionId, part.identity_anchor]));
  questionParts.forEach((part) => { part.identity_anchor = anchors.get(part.question_id) ?? null; });
}

function isFiller(text: string, config: BoardConfig) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return config.fillerPatterns.some((pattern) => pattern.test(trimmed));
}

function isContextLine(text: string, config: BoardConfig) {
  return config.contextTerminators.some((pattern) => pattern.test(text.trim()));
}

function isNextPartIntroLine(rawText: string): boolean {
  const text = normalizeText(rawText).replace(/^DO NOT WRITE IN THIS AREA\s*/i, "").trim();
  if (text.length < 15) return false;
  if (isHeaderFurnitureLine(text) || isFooterFurnitureLine(text)) return false;
  if (/^\(?\d{1,3}\)?$/.test(text)) return false;
  const wordCount = (text.match(/[A-Za-z]{2,}/g) ?? []).length;
  if (wordCount < 4) return false;
  return /[.?:]$/.test(text);
}

function looksLikeBusinessSetupStart(rawText: string): boolean {
  const text = normalizeText(rawText).replace(/^DO NOT WRITE IN THIS AREA\s*/i, "").trim();
  if (text.length < 20) return false;
  if (isHeaderFurnitureLine(text) || isFooterFurnitureLine(text)) return false;
  if (!/^[A-Z£0-9(]/.test(text)) return false;
  const wordCount = (text.match(/[A-Za-z]{2,}/g) ?? []).length;
  return wordCount >= 5;
}

function isBackMatterPageStart(pageText: string): boolean {
  const lower = pageText.toLowerCase();
  if (lower.includes("additional answer space")) return true;
  if (lower.includes("if additional space is required") && lower.includes("lined page")) return true;
  return false;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const inputDirIndex = args.indexOf("--input-dir");
  const outputDirIndex = args.indexOf("--output-dir");
  const boardIndex = args.indexOf("--board");
  const subjectIndex = args.indexOf("--subject");
  return {
    inputDir: inputDirIndex >= 0 ? resolve(process.cwd(), args[inputDirIndex + 1]) : resolve(process.cwd(), "data/downloads"),
    outputDir: outputDirIndex >= 0 ? resolve(process.cwd(), args[outputDirIndex + 1]) : resolve(process.cwd(), "data/extracted"),
    board: boardIndex >= 0 ? args[boardIndex + 1] : null,
    subject: subjectIndex >= 0 ? args[subjectIndex + 1] : null,
    validateRegions: args.includes("--validate-regions"),
    renderSpans: args.includes("--render-spans"),
    trimBlank: args.includes("--trim-blank"),
  };
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function inferTierDirFromPath(pdfPath: string) {
  const normalized = pdfPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/foundation/")) return "foundation";
  if (normalized.includes("/higher/")) return "higher";
  return null;
}

function cleanedNormalizedText(text: string) {
  return normalizeText(text).toLowerCase();
}

function normalizeAqaQuestionNumber(raw: string) {
  const digits = raw.replace(/\s+/g, "");
  const value = Number(digits);
  return Number.isFinite(value) ? String(value) : digits;
}

function extractAqaStandaloneQuestionNumber(text: string) {
  const normalized = normalizeText(text);
  const splitMatch = normalized.match(/^0\s*(\d{1,2})$/);
  if (splitMatch) return normalizeAqaQuestionNumber(`0${splitMatch[1]}`);

  const compactMatch = normalized.match(/^(\d{2})$/);
  if (compactMatch) return normalizeAqaQuestionNumber(compactMatch[1]);

  return null;
}

function isImplausibleQuestionNumber(boardCode: string, subjectSlug: string, questionNumber: string) {
  const parsed = Number(questionNumber);
  return boardCode === "edexcel" && subjectSlug === "combined-science" && Number.isFinite(parsed) && parsed > 12;
}

function extractSubquestion(text: string, line: TextLine, currentQuestionNumber: string | null, config: BoardConfig, boardCode: string, subjectSlug: string) {
  const normalized = normalizeText(text);
  if (config.name === "AQA") {
    if (line.bbox.x0 > 90) return null;
    if (isSelectionPanelLine(normalized)) return null;

    const parenMatch = normalized.match(/^(\d)\s*(\d)\s*\(([a-z])\)/i);
    if (parenMatch) {
      if (parenMatch[0].length === normalized.length) return null;
      const questionNumber = normalizeAqaQuestionNumber(`${parenMatch[1]}${parenMatch[2]}`);
      if (currentQuestionNumber) {
        const current = Number(currentQuestionNumber);
        const candidate = Number(questionNumber);
        if (!Number.isNaN(current) && !Number.isNaN(candidate) && candidate < current) return null;
      }
      return {
        questionNumber,
        partNumber: parenMatch[3].toLowerCase(),
      };
    }

    const aqaMatch = normalized.match(/^(\d)\s*(\d)\s*\.\s*(\d(?:\s*\d)?)\b/);
    if (!aqaMatch) return null;
    if (aqaMatch[0].length === normalized.length) return null;

    const questionNumber = normalizeAqaQuestionNumber(`${aqaMatch[1]}${aqaMatch[2]}`);
    if (currentQuestionNumber) {
      const current = Number(currentQuestionNumber);
      const candidate = Number(questionNumber);
      if (!Number.isNaN(current) && !Number.isNaN(candidate) && candidate < current) return null;
    }

    return {
      questionNumber,
      partNumber: aqaMatch[3].replace(/\s+/g, ""),
    };
  }
  const match = normalized.match(config.subquestionRe);
  if (!match) return null;
  if (match[0].length === normalized.length) return null;
  if (isImplausibleQuestionNumber(boardCode, subjectSlug, match[1])) return null;
  return {
    questionNumber: match[1],
    partNumber: match[2].replace(/\s+/g, ""),
  };
}

function extractContinuationSubquestion(text: string) {
  const match = normalizeText(text).match(/^\(\s*((?:[a-z]|[ivx]{2,4}))\s*\)/i);
  if (!match) return null;
  if (isBareQuestionMarker(text)) return null;
  return match[1].replace(/\s+/g, "");
}

function extractTopLevelQuestion(text: string, line: TextLine, currentQuestionNumber: string | null, config: BoardConfig) {
  if (isSelectionPanelLine(text) || isBookletMarkerLine(text)) return null;
  if (config.name === "AQA") {
    const normalized = normalizeText(text);
    const explicitMatch = normalized.match(/^question\s+(\d{1,2})\b/i);
    if (explicitMatch) {
      if (line.bbox.x0 > 90) return null;
      const candidate = Number(explicitMatch[1]);
      if (Number.isNaN(candidate)) return null;
      if (currentQuestionNumber) {
        const current = Number(currentQuestionNumber);
        if (!Number.isNaN(current) && candidate < current) return null;
      }
      return explicitMatch[1];
    }

    if (line.bbox.x0 > 90) return null;

    const aqaMatch = normalized.match(/^(\d)\s*(\d)\b(?!\s*\.)/);
    if (aqaMatch) {
      const remainder = normalized.slice(aqaMatch[0].length).trim();
      if (/^\(\s*[a-z]\s*\)/i.test(remainder)) return null;
      const questionNumber = normalizeAqaQuestionNumber(`${aqaMatch[1]}${aqaMatch[2]}`);
      if (currentQuestionNumber) {
        const current = Number(currentQuestionNumber);
        const candidate = Number(questionNumber);
        if (!Number.isNaN(current) && !Number.isNaN(candidate) && candidate < current) return null;
      }
      if (/[A-Za-z]/.test(remainder)) return questionNumber;
    }
    const compactMatch = normalized.match(/^(\d{2})\b(?!\s*\.)/);
    if (compactMatch) {
      const remainder = normalized.slice(compactMatch[0].length).trim();
      if (/^\(\s*[a-z]\s*\)/i.test(remainder)) return null;
      const questionNumber = normalizeAqaQuestionNumber(compactMatch[1]);
      if (currentQuestionNumber) {
        const current = Number(currentQuestionNumber);
        const candidate = Number(questionNumber);
        if (!Number.isNaN(current) && !Number.isNaN(candidate) && candidate < current) return null;
      }
      if (/[A-Za-z]/.test(remainder)) return questionNumber;
    }
    return null;
  }
  const match = normalizeText(text).match(config.topLevelQuestionRe);
  return match ? match[1] : null;
}

function extractTopLevelQuestionStart(
  text: string,
  line: TextLine,
  currentQuestionNumber: string | null,
  subjectSlug: string,
  boardCode: string,
  sectionCode: string | null,
) {
  const normalized = normalizeText(text);
  const isEdexcelMaths = boardCode === "edexcel" && subjectSlug === "mathematics";
  if (isBookletMarkerLine(normalized)) return null;
  const isTopOfPageTitle = line.bbox.y0 > 760 && /^\d{1,2}\s+[A-Z][A-Za-z0-9'’\- ]{2,40}$/.test(normalized);
  const match = subjectSlug === "english-literature"
    ? normalized.match(/^(\d{1,2})\s+(?:[“"'‘’]\s*)?(?=[A-Z])/)
    : isEdexcelMaths
      ? normalized.match(/^(\d{1,2})\s+(?=\S)/)
      : normalized.match(/^(\d{1,2})\s+(?=[A-Z])/);
  if (!match) return null;
  if (line.bbox.x0 > 90) return null;
  if (subjectSlug === "english-literature" && !canRelaxEnglishLiteratureTopGuard(boardCode, sectionCode) && line.bbox.y0 < 650) return null;

  const candidate = Number(match[1]);
  if (Number.isNaN(candidate)) return null;
  if (isImplausibleQuestionNumber(boardCode, subjectSlug, match[1])) return null;
  if (isEdexcelMaths && line.bbox.y0 < 120) return null;
  if (currentQuestionNumber) {
    const current = Number(currentQuestionNumber);
    if (isEdexcelMaths && !Number.isNaN(current) && candidate === current) return null;
    if (isEdexcelMaths && !Number.isNaN(current) && candidate > current + 2) return null;
    if (!Number.isNaN(current) && candidate < current && !isTopOfPageTitle) return null;
  }

  return match[1];
}

function extractStandaloneQuestionNumber(
  text: string,
  line: TextLine,
  currentQuestionNumber: string | null,
  subjectSlug: string,
  boardCode: string,
  sectionCode: string | null,
) {
  const normalized = normalizeText(text);
  if (isBookletMarkerLine(normalized)) return null;

  const normalizedQuestionNumber = boardCode === "aqa"
    ? extractAqaStandaloneQuestionNumber(normalized)
    : normalized.match(/^(\d{1,2})$/)?.[1] ?? null;
  if (!normalizedQuestionNumber) return null;
  if (line.bbox.x0 > 90 || line.bbox.y0 < 120) return null;
  if (subjectSlug === "english-literature" && !canRelaxEnglishLiteratureTopGuard(boardCode, sectionCode) && line.bbox.y0 < 650) return null;

  const candidate = Number(normalizedQuestionNumber);
  if (Number.isNaN(candidate)) return null;
  if (currentQuestionNumber) {
    const current = Number(currentQuestionNumber);
    if (!Number.isNaN(current) && candidate < current) return null;
  }

  return normalizedQuestionNumber;
}

function extractMarks(text: string, questionPartNumber: string | null, config: BoardConfig) {
  const normalized = normalizeText(text);
  const totalQuestionMatch = normalized.match(/\(?\s*total for question\s+(?:\d\s*){1,3}(?:\s*[a-z])?\s*(?:is|=)\s*(\d{1,3})\s+marks?\s*\)?/i);
  const matches = Array.from(normalized.matchAll(config.marksRe));
  if (matches.length === 0) {
    const romanMcItems = normalized.match(/\([ivx]{1,4}\)/gi) ?? [];
    if (romanMcItems.length > 0 && /\bA\s+.+\bB\s+.+\bC\s+.+\bD\s+/i.test(normalized)) return romanMcItems.length;
    return totalQuestionMatch ? Number(totalQuestionMatch[1]) : null;
  }

  const numericMatches = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
  if (numericMatches.length === 0) return null;

  if (questionPartNumber === null && totalQuestionMatch) {
    return Number(totalQuestionMatch[1]);
  }

  if (questionPartNumber !== null && totalQuestionMatch && numericMatches.length > 1) {
    numericMatches.pop();
  }

  if (numericMatches.length === 0 && totalQuestionMatch) {
    return Number(totalQuestionMatch[1]);
  }

  return numericMatches.reduce((sum, value) => sum + value, 0);
}

function hasMarks(text: string, config: BoardConfig) {
  return config.hasMarksRe.test(text);
}

function normalizeQuestionNumberForMarks(value: string) {
  const parsed = Number.parseInt(value.replace(/\s+/g, ""), 10);
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}

function parseSourceQuestionTotal(text: string) {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /^\(?\s*total\s+for\s+question\s+((?:\d\s*){1,3})(?:\s*[a-z])?\s*(?:is|=)\s*(\d{1,3})\s+marks?\s*\)?$/i,
  );
  if (!match) return null;
  return {
    questionNumber: normalizeQuestionNumberForMarks(match[1]),
    marks: Number(match[2]),
  };
}

function isTotalForPaperLine(text: string) {
  return /^total for paper\s*=\s*\d+\s+marks$/i.test(normalizeText(text));
}

function normalizeLanguageReadingMarks(questionParts: ExtractedQuestionPart[], pages: ExtractedPage[]) {
  const totalByQuestion = new Map<string, number>();
  for (const page of pages) {
    for (const line of page.text_lines) {
      const match = normalizeText(line.text).match(/^\(total for question (\d{1,2}) = (\d{1,2}) marks?\)$/i);
      if (match) totalByQuestion.set(match[1], Number(match[2]));
    }
  }

  for (const [questionNumber, expectedMarks] of totalByQuestion) {
    const parts = questionParts.filter((part) => part.question_number === questionNumber);
    if (parts.length === expectedMarks && parts.some((part) => part.marks === null)) {
      for (const part of parts) part.marks = 1;
    }
    const sum = parts.reduce((total, part) => total + (part.marks ?? 0), 0);
    if (parts.length === expectedMarks && sum !== expectedMarks) {
      for (const part of parts) part.marks = 1;
    }
  }
}

function extractSourceQuestionTotals(pages: ExtractedPage[]) {
  const totals = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.text_lines) {
      const total = parseSourceQuestionTotal(line.text);
      if (!total) continue;
      const values = totals.get(total.questionNumber) ?? new Set<number>();
      values.add(total.marks);
      totals.set(total.questionNumber, values);
    }
  }
  return totals;
}

function reconcileQuestionMarks(questionParts: ExtractedQuestionPart[], pages: ExtractedPage[]) {
  const totals = extractSourceQuestionTotals(pages);
  const partsByQuestion = new Map<string, ExtractedQuestionPart[]>();
  for (const part of questionParts) {
    const key = normalizeQuestionNumberForMarks(part.question_number);
    const parts = partsByQuestion.get(key) ?? [];
    parts.push(part);
    partsByQuestion.set(key, parts);
  }

  for (const [questionNumber, parts] of partsByQuestion) {
    const expectedValues = totals.get(questionNumber);
    if (!expectedValues || expectedValues.size !== 1) {
      const reason = expectedValues && expectedValues.size > 1
        ? `Source totals disagree (${Array.from(expectedValues).sort((a, b) => a - b).join(", ")}).`
        : "No source total was detected.";
      for (const part of parts) part.marks_validated = "unknown";
      if (expectedValues && expectedValues.size > 1) {
        for (const part of parts) {
          part.marks_validated = "mismatch";
          part.parser_notes.push(reason);
        }
      }
      continue;
    }

    const expected = Array.from(expectedValues)[0];

    const complete = parts.every((part) => Number.isInteger(part.marks) && (part.marks ?? 0) >= 0);
    const sum = parts.reduce((total, part) => total + (part.marks ?? 0), 0);
    const validated = complete && sum === expected;
    for (const part of parts) {
      part.source_total_marks = expected;
      part.marks_validated = validated ? "validated" : "mismatch";
      if (!validated) {
        part.parser_notes.push(`Source total is ${expected}, extracted parts sum to ${sum}.`);
      }
    }
  }
}

function extractReferencedQuestionNumber(text: string) {
  const match = normalizeText(text).match(/^use this extract to answer question\s+(\d{1,2})\b/i);
  return match ? match[1] : null;
}

function extractCommandWord(text: string) {
  const normalized = cleanedNormalizedText(text);
  const first120 = normalized.slice(0, 120);
  for (const word of COMMAND_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(first120)) {
      return word;
    }
  }
  return null;
} 

function mergeBBoxes(lines: TextLine[]) {
  if (lines.length === 0) return null;
  return {
    x0: Math.min(...lines.map((line) => line.bbox.x0)),
    y0: Math.min(...lines.map((line) => line.bbox.y0)),
    x1: Math.max(...lines.map((line) => line.bbox.x1)),
    y1: Math.max(...lines.map((line) => line.bbox.y1)),
  };
}

function determineSourceMode(pageNumbers: number[], bbox: BoundingBox | null) {
  if (pageNumbers.length > 1) return "full_page" as const;
  if (!bbox) return "full_page" as const;
  const height = bbox.y1 - bbox.y0;
  if (height > 500) return "full_page" as const;
  return "crop_or_text" as const;
}

function cleanText(text: string) {
  return normalizeText(
    text
      .replace(/\b(ib\/g\/|pmt)\b/gi, "")
      .replace(/\bIB\/[A-Z]\/((?:Jun|Nov)\d{2})\/[A-Z0-9\/]+\b/gi, "")
      .replace(/\*\d+\*/g, "")
      .replace(/\*p\d+[a-z]\d+[a-z]\d*\*/gi, "")
      .replace(/\*P[0-9A-Z]+\*/g, "")
      .replace(/\bP\d{5,}[A-Z]?\b/gi, "")
      .replace(/\bquestion \d+ continues on the next page\b/gi, "")
      .replace(/\bend of (question|section)\b/gi, "")
      .replace(/\buse this extract to answer question \d+\b/gi, "")
      .replace(/\bbegin your answer on page \d+ of the answer booklet\b/gi, "")
      .replace(/\btotal for question \d+[a-z]?(?:\s+[a-z]+)?\s*(?:=|is)\s*\d+\s*marks?\b/gi, "")
      .replace(/\btotal for section [a-z0-9, ]+\s*=\s*\d+\s*marks\b/gi, "")
      .replace(/\boverall total for section [a-z0-9, ]+\s*=\s*\d+\s*marks\b/gi, "")
      .replace(/\btotal for paper\s*=\s*\d+\s*marks\b/gi, "")
      .replace(/\bao4\s*\[\d+\s*marks?\]/gi, "")
      .replace(/©\s*\d{4}\s*Pearson Education Ltd\.?/gi, "")
      .replace(/©\s*OCR\s*\d{4}/gi, "")
      .replace(/©\s*OCR/gi, "")
      .replace(/copyright ©\s*\d{4}\s*AQA and its licensors\. all rights reserved\.?/gi, "")
      .replace(/\.{10,}/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\bturn over\b/gi, "")
      .replace(/\bextra space\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function isSelectionPanelLine(text: string) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("choose one question")) return true;
  if (normalized.includes("chosen question number")) return true;
  if (normalized.includes("indicate which question you are answering")) return true;

  const questionMatches = normalized.match(/\bquestion\s+\d{1,2}\b/g);
  return questionMatches !== null && questionMatches.length > 1;
}

function isBareQuestionMarker(text: string) {
  return /^\(\s*(?:[a-z]|[ivx]{2,4})\s*\)$/i.test(normalizeText(text));
}

function isBookletMarkerLine(text: string) {
  const normalized = normalizeText(text);
  return /^\d{1,2}\s+P\d{4,}[A-Z0-9]*\b/i.test(normalized) || /^\*?P\d{4,}[A-Z0-9]*\*?$/i.test(normalized);
}

function detectChoiceGroupPattern(text: string, subjectSlug: string): { type: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; optionLabel: string | null; sharedStem: string | null } | null {
  const normalized = normalizeText(text).toLowerCase();

  if (/^(either|or)$/i.test(normalized)) {
    return { type: "either_or", optionLabel: null, sharedStem: null };
  }

  const eitherOrMatch = normalized.match(/answer\s+(?:either|or)\s+(?:question\s+)?(\d+)\s+(?:or|and)\s+(?:question\s+)?(\d+)/i);
  if (eitherOrMatch) {
    return { type: "either_or", optionLabel: null, sharedStem: null };
  }

  if (/^answer\s+(?:either|or)\b/i.test(normalized) && /\bor\b/i.test(normalized)) {
    return { type: "either_or", optionLabel: null, sharedStem: null };
  }

  const chooseOneMatch = normalized.match(/^(?:choose|answer)\s+one\s+(?:question|text|poem|cluster|from)/i);
  if (chooseOneMatch) {
    if (/cluster/i.test(normalized)) return { type: "cluster_choice", optionLabel: null, sharedStem: null };
    if (/text|novel|play|drama|prose/i.test(normalized)) return { type: "text_choice", optionLabel: null, sharedStem: null };
    return { type: "question_choice", optionLabel: null, sharedStem: null };
  }

  if (/^section\s+[a-d]\s*:/i.test(normalized) && subjectSlug === "english-literature") {
    const textNameMatch = normalized.match(/section\s+[a-d]\s*:\s*(.+)/i);
    if (textNameMatch && /macbeth|christmas|inspector|jekyll|romeo|blood|dna|lord|animal/i.test(textNameMatch[1])) {
      return { type: "text_choice", optionLabel: null, sharedStem: null };
    }
  }

  const clusterNameMatch = normalized.match(/^(?:power and conflict|love and relationships|worlds and lives)$/i);
  if (clusterNameMatch && subjectSlug === "english-literature") {
    return { type: "cluster_choice", optionLabel: null, sharedStem: null };
  }

  return null;
}

function buildChoiceGroupId(paperCode: string, sectionCode: string | null, groupType: string, questionNumber: string): string {
  const section = sectionCode ?? "all";
  return `choice-${paperCode}-${section}-${groupType}-q${questionNumber}`;
}

function buildChoiceScopeKey(
  groupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice",
  sectionCode: string | null,
  questionNumber: string,
) {
  const section = sectionCode ?? "all";
  if (groupType === "question_choice") return `${section}:${groupType}:${questionNumber}`;
  return `${section}:${groupType}`;
}

function canRelaxEnglishLiteratureTopGuard(boardCode: string, sectionCode: string | null) {
  return boardCode === "edexcel" && sectionCode === "B";
}

function extractChoiceQuestionNumber(text: string, line: TextLine, currentQuestionNumber: string | null, boardCode: string) {
  const normalized = normalizeText(text);
  const candidateText = boardCode === "aqa"
    ? (normalized.match(/^(\d)\s*(\d)\b/) ? normalizeAqaQuestionNumber(`${normalized.match(/^(\d)\s*(\d)\b/)![1]}${normalized.match(/^(\d)\s*(\d)\b/)![2]}`) : null)
    : normalized.match(/^(\d{1,2})\b/)?.[1] ?? null;
  if (!candidateText) return null;
  if (line.bbox.x0 > 90) return null;

  const candidate = Number(candidateText);
  if (Number.isNaN(candidate)) return null;
  if (currentQuestionNumber) {
    const current = Number(currentQuestionNumber);
    if (!Number.isNaN(current) && candidate < current) return null;
  }

  return candidateText;
}

function isQuestionHeadingOnly(text: string, config: BoardConfig) {
  const normalized = normalizeText(text);
  if (/^question\s+\d{1,2}\b$/i.test(normalized)) return true;
  if (config.name === "AQA") {
    return /^(\d)\s*(\d)$/.test(normalized);
  }
  return false;
}

function groupTextItemsIntoLines(items: Array<{ str: string; transform: number[]; width: number; height: number }>): TextLine[] {
  const positioned = items
    .map((item) => ({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
      height: item.height ?? 0,
    }))
    .filter((item) => item.text && item.text.trim().length > 0)
    .filter((item) => item.x < 540)
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));

  const lines: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) < 3);
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sortedItems = line.items.sort((a, b) => a.x - b.x);
      let text = "";
      for (let i = 0; i < sortedItems.length; i += 1) {
        const item = sortedItems[i];
        const prev = sortedItems[i - 1];
        if (prev && item.x - (prev.x + prev.width) > 1.5) {
          text += " ";
        }
        text += item.text;
      }
      const xs = sortedItems.map((item) => item.x);
      const ys = sortedItems.map((item) => item.y);
      return {
        text: normalizeText(text),
        y: line.y,
        spans: sortedItems.map((item) => ({
          text: item.text,
          bbox: { x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height },
        })),
        bbox: {
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...sortedItems.map((item) => item.x + item.width)),
          y1: Math.max(...sortedItems.map((item) => item.y + item.height)),
        },
      };
    });
}

async function exportSinglePagePdf(sourceBytes: Uint8Array, sourcePdfPath: string, pageIndex: number, outputPath: string): Promise<boolean> {
  try {
    const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const target = await PDFDocument.create();
    const [page] = await target.copyPages(src, [pageIndex]);
    target.addPage(page);
    const bytes = await target.save();
    writeFileSync(outputPath, bytes);
    return true;
  } catch {
    try {
      execFileSync("qpdf", ["--empty", "--pages", sourcePdfPath, String(pageIndex + 1), "--", outputPath]);
      return true;
    } catch {
      return false;
    }
  }
}

const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;
const HEADER_EDGE_BAND = 65;
const FOOTER_EDGE_BAND = 65;
const MIN_SPAN_HEIGHT = 18;
const MIN_STEM_SPAN_HEIGHT = 14;
const MAX_BRIDGE_PAGES = 3;
const MIN_ANSWER_BRIDGE_HEIGHT = 48;
const INK_PIXEL_THRESHOLD = 245;
const BLANK_TRIM_THRESHOLD = 80;
const BLANK_KEEP_MARGIN = 28;
const INK_RENDER_SCALE = 1;

function computePageLayouts(
  pages: ExtractedPage[],
  pageDimensions: Map<number, { width: number; height: number }>,
  config: BoardConfig,
): ExtractedPageLayout[] {
  const layouts: Array<ExtractedPageLayout & { has_content: boolean }> = [];

  for (const page of pages) {
    const dims = pageDimensions.get(page.page_number) ?? { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT };

    let headerFloor = dims.height - 22;
    for (const line of page.text_lines) {
      const text = normalizeText(line.text);
      const inTopBand = line.bbox.y0 > dims.height - HEADER_EDGE_BAND;
      const isDigitOnly = /^\d{1,3}$/.test(text);
      const isEdgeFurniture = inTopBand
        && !((isDigitOnly || /^0\s*\d$/.test(text)) && line.bbox.x0 < 110)
        && (isFiller(text, config) || isBookletMarkerLine(text) || isFooterFurnitureLine(text));
      const isInstructionFurniture = line.bbox.y0 > dims.height * 0.6
        && !isDigitOnly
        && isHeaderFurnitureLine(text);
      if (isEdgeFurniture || isInstructionFurniture) {
        headerFloor = Math.min(headerFloor, line.bbox.y0 - 3);
        continue;
      }
      break;
    }

    const footerEdgeBand = config.name === "OCR" ? 95 : FOOTER_EDGE_BAND;
    let footerCeiling = 22;
    for (const line of [...page.text_lines].reverse()) {
      const text = normalizeText(line.text);
      const inBottomBand = line.bbox.y1 < footerEdgeBand;
      if (inBottomBand && (isFiller(text, config) || isBookletMarkerLine(text) || isFooterFurnitureLine(text))) {
        footerCeiling = Math.max(footerCeiling, line.bbox.y1 + 3);
        continue;
      }
      break;
    }

    if (footerCeiling >= headerFloor) {
      headerFloor = dims.height - 22;
      footerCeiling = 22;
    }

    const contentLines = page.text_lines.filter((line) => {
      const text = normalizeText(line.text);
      if (!text) return false;
      if (isFiller(text, config) || isBookletMarkerLine(text)) return false;
      if (isHeaderFurnitureLine(text)) return false;
      const isLeftQuestionNumber = /^\d{1,3}$/.test(text) && line.bbox.x0 < 120;
      if (!isLeftQuestionNumber && isFooterFurnitureLine(text)) return false;
      return line.bbox.y0 < headerFloor && line.bbox.y1 > footerCeiling;
    });

    const hasContent = contentLines.length > 0;
    const contentX0 = hasContent ? Math.max(16, Math.min(...contentLines.map((line) => line.bbox.x0))) : Number.NaN;
    const contentX1 = hasContent ? Math.min(dims.width - 16, Math.max(...contentLines.map((line) => line.bbox.x1))) : Number.NaN;

    layouts.push({
      page_number: page.page_number,
      page_width: dims.width,
      page_height: dims.height,
      content_x0: contentX0,
      content_x1: contentX1,
      header_floor_y: headerFloor,
      footer_ceiling_y: footerCeiling,
      has_content: hasContent,
    });
  }

  const x0Values = layouts.filter((layout) => layout.has_content).map((layout) => layout.content_x0).sort((a, b) => a - b);
  const x1Values = layouts.filter((layout) => layout.has_content).map((layout) => layout.content_x1).sort((a, b) => a - b);
  const medianX0 = x0Values.length > 0 ? x0Values[Math.floor(x0Values.length / 2)] : 40;
  const medianX1 = x1Values.length > 0 ? x1Values[Math.floor(x1Values.length / 2)] : DEFAULT_PAGE_WIDTH - 40;

  return layouts.map(({ has_content, ...layout }) => ({
    ...layout,
    content_x0: has_content ? Math.min(layout.content_x0, medianX0) : medianX0,
    content_x1: has_content ? Math.max(layout.content_x1, medianX1) : medianX1,
  }));
}

function propagateFigureRefsToSubparts(questionParts: ExtractedQuestionPart[]) {
  let currentQuestion: string | null = null;
  let parentFigures: string[] = [];
  for (const part of questionParts) {
    if (part.question_number !== currentQuestion) {
      currentQuestion = part.question_number;
      parentFigures = [];
    }
    const partNumber = part.question_part_number;
    const isRoman = !!partNumber && /^[ivxlcdm]+$/i.test(partNumber);
    if (partNumber && !isRoman) {
      parentFigures = part.referenced_support_labels ?? [];
    } else if (isRoman && parentFigures.length > 0) {
      part.referenced_support_labels = Array.from(
        new Set([...(part.referenced_support_labels ?? []), ...parentFigures]),
      ).sort();
    }
  }
}

function detectFigures(
  pages: ExtractedPage[],
  skippedPages: Set<number>,
  partAnchors: PartAnchor[],
  layoutByPage: Map<number, ExtractedPageLayout>,
): ExtractedFigure[] {
  const anchorRectsByPage = new Map<number, BoundingBox[]>();
  for (const anchor of partAnchors) {
    if (anchor.start_line_bbox === null) continue;
    const rects = anchorRectsByPage.get(anchor.start_page) ?? [];
    rects.push(anchor.start_line_bbox);
    anchorRectsByPage.set(anchor.start_page, rects);
  }

  const figures: ExtractedFigure[] = [];
  for (const page of pages) {
    if (skippedPages.has(page.page_number)) continue;
    const layout = layoutByPage.get(page.page_number);
    if (!layout) continue;

    const allCaptions = page.text_lines
      .map((line) => ({ line, caption: matchSupportCaption(line.text) }))
      .filter((entry): entry is { line: TextLine; caption: NonNullable<ReturnType<typeof matchSupportCaption>> } => entry.caption !== null);

    const hasRealCaption = new Set(
      allCaptions.filter((entry) => entry.caption.form !== "prose").map((entry) => entry.caption.label),
    );
    const captions = allCaptions.filter(
      (entry) => entry.caption.form !== "prose" || !hasRealCaption.has(entry.caption.label),
    );

    const blockers: BoundingBox[] = [
      ...(anchorRectsByPage.get(page.page_number) ?? []),
      ...captions.map((entry) => entry.line.bbox),
    ];

    for (const { line, caption } of captions) {
      let belowY = layout.footer_ceiling_y;
      let aboveY = layout.header_floor_y;
      for (const rect of blockers) {
        if (rect === line.bbox) continue;
        if (rect.y1 <= line.bbox.y0 + 0.5 && rect.y1 > belowY) belowY = rect.y1;
        if (rect.y0 >= line.bbox.y1 - 0.5 && rect.y0 < aboveY) aboveY = rect.y0;
      }
      const gapBelow = line.bbox.y0 - belowY;
      const gapAbove = aboveY - line.bbox.y1;

      let yTop: number;
      let yBottom: number;
      if (gapAbove > gapBelow + 8) {
        yTop = Math.min(aboveY - 2, layout.header_floor_y);
        yBottom = Math.max(line.bbox.y0 - 2, layout.footer_ceiling_y);
      } else {
        yTop = Math.min(line.bbox.y1 + 4, layout.header_floor_y);
        yBottom = Math.max(belowY + 2, layout.footer_ceiling_y);
      }
      if (yTop - yBottom < MIN_SPAN_HEIGHT) continue;

      figures.push({
        label: caption.label,
        page_number: page.page_number,
        y_top: yTop,
        y_bottom: yBottom,
      });
    }
  }

  return figures;
}

function fixSpanStraddles(
  span: { y_top: number; y_bottom: number },
  lines: TextLine[],
  anchorLineRects: BoundingBox[],
) {
  const isAnchorLine = (line: TextLine) => anchorLineRects.some((rect) => (
    Math.abs(rect.y0 - line.bbox.y0) < 0.5 && Math.abs(rect.y1 - line.bbox.y1) < 0.5
  ));

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let changed = false;
    for (const line of lines) {
      if (line.bbox.y1 - line.bbox.y0 <= 0.1) continue;
      if (line.bbox.y0 < span.y_top && line.bbox.y1 > span.y_top) {
        span.y_top = line.bbox.y1 + 1;
        changed = true;
      }
      if (line.bbox.y0 < span.y_bottom && line.bbox.y1 > span.y_bottom) {
        span.y_bottom = isAnchorLine(line) ? line.bbox.y1 + 1 : line.bbox.y0 - 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function lineOverlapsNeighbour(line: TextLine, lines: TextLine[]): boolean {
  for (const other of lines) {
    if (other === line) continue;
    if (other.bbox.y1 - other.bbox.y0 <= 0.1) continue;
    const overlap = Math.min(line.bbox.y1, other.bbox.y1) - Math.max(line.bbox.y0, other.bbox.y0);
    if (overlap > (line.bbox.y1 - line.bbox.y0) * 0.3) return true;
  }
  return false;
}

function countSpanStraddles(span: RegionSpan, lines: TextLine[], layout?: ExtractedPageLayout) {
  let straddles = 0;
  for (const line of lines) {
    if (line.bbox.y1 - line.bbox.y0 <= 0.1) continue;
    const straddlesEdge =
      (line.bbox.y0 < span.y_top && line.bbox.y1 > span.y_top) ||
      (line.bbox.y0 < span.y_bottom && line.bbox.y1 > span.y_bottom);
    if (!straddlesEdge) continue;
    if (/do not write/i.test(line.text)) continue;
    if (layout && line.bbox.x1 < layout.content_x0) continue;
    if (layout && line.bbox.x0 > layout.content_x1) continue;
    if (lineOverlapsNeighbour(line, lines)) continue;
    straddles += 1;
  }
  return straddles;
}

function spanHasRealContent(
  span: { y_top: number; y_bottom: number },
  lines: TextLine[],
  layout: ExtractedPageLayout,
): boolean {
  for (const line of lines) {
    if (line.bbox.y0 < span.y_bottom || line.bbox.y1 > span.y_top + 1) continue;
    if (line.bbox.x1 < layout.content_x0 || line.bbox.x0 > layout.content_x1) continue;
    const text = line.text.trim();
    if (text.length < 2) continue;
    if (isHeaderFurnitureLine(text) || isFooterFurnitureLine(text)) continue;
    return true;
  }
  return false;
}

function extendTopThroughScenario(
  yTop: number,
  lines: TextLine[],
  anchorRects: BoundingBox[],
  layout: ExtractedPageLayout,
): number {
  let top = yTop;
  for (let guard = 0; guard < 40; guard += 1) {
    let next = top;
    for (const line of lines) {
      const b = line.bbox;
      if (b.y0 <= top) continue; 
      if (b.y1 > layout.header_floor_y) continue;
      if (b.y0 - top > 42) continue;     
      if (b.x1 < layout.content_x0 || b.x0 > layout.content_x1) continue;
      const text = line.text.trim();
      if (text.length < 2) continue;
      if (isHeaderFurnitureLine(text) || isFooterFurnitureLine(text)) continue;
      if (/^\(total for question/i.test(text)) continue;
      if (/^\(\s*\d{1,3}\s*\)$/.test(text) || /[.…_]{6,}/.test(text)) return top;
      if (anchorRects.some((r) => Math.abs(r.y0 - b.y0) < 0.5 && Math.abs(r.y1 - b.y1) < 0.5)) continue;
      next = Math.max(next, Math.min(b.y1 + 2, layout.header_floor_y));
    }
    if (next <= top) break;
    top = next;
  }
  return top;
}

function computeStemSpans(
  stem: QuestionStemAnchor,
  layoutByPage: Map<number, ExtractedPageLayout>,
  skippedPages: Set<number>,
  linesByPage: Map<number, TextLine[]>,
  anchorRectsByPage: Map<number, BoundingBox[]>,
): RegionSpan[] | null {
  let firstPage = stem.start_page;
  for (const contextLine of stem.context_lines) {
    firstPage = Math.min(firstPage, contextLine.page_number);
  }
  const lastPage = stem.subpart_start_page;
  if (lastPage < firstPage) return null;

  const spans: RegionSpan[] = [];
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
    if (skippedPages.has(pageNumber)) continue;
    const layout = layoutByPage.get(pageNumber);
    if (!layout) continue;

    let top = pageNumber === stem.start_page ? stem.start_top : 0;
    for (const contextLine of stem.context_lines) {
      if (contextLine.page_number === pageNumber) top = Math.max(top, contextLine.line.bbox.y1);
    }
    let yTop = pageNumber === firstPage
      ? Math.min(top + 3, layout.header_floor_y)
      : layout.header_floor_y;
    yTop = extendTopThroughScenario(yTop, linesByPage.get(pageNumber) ?? [], anchorRectsByPage.get(pageNumber) ?? [], layout);
    const yBottom = pageNumber === lastPage
      ? Math.max(stem.subpart_start_top + 2, layout.footer_ceiling_y)
      : layout.footer_ceiling_y;

    const span = { page_number: pageNumber, y_top: yTop, y_bottom: yBottom };
    fixSpanStraddles(span, linesByPage.get(pageNumber) ?? [], anchorRectsByPage.get(pageNumber) ?? []);
    if (
      span.y_top - span.y_bottom >= MIN_STEM_SPAN_HEIGHT
      && spanHasRealContent(span, linesByPage.get(pageNumber) ?? [], layout)
    ) {
      spans.push(span);
    }
  }

  return spans.length > 0 ? spans : null;
}


function mergeStandaloneSourceStems(questionParts: ExtractedQuestionPart[]) {
  const removed = new Set<ExtractedQuestionPart>();
  for (let index = 1; index < questionParts.length; index += 1) {
    const question = questionParts[index];
    const source = questionParts[index - 1];
    if (removed.has(source)) continue;
    if (question.question_part_number !== null || source.question_part_number !== null) continue;
    if (question.question_number !== source.question_number) continue;
    if (!question.marks || source.marks) continue;
    if (!source.region_spans || source.region_spans.length === 0) continue;
    question.stem_spans = [...source.region_spans, ...(question.stem_spans ?? [])];
    removed.add(source);
  }
  if (removed.size > 0) {
    const kept = questionParts.filter((part) => !removed.has(part));
    questionParts.length = 0;
    questionParts.push(...kept);
  }
}

function pruneMismatchedBaseStems(
  questionParts: ExtractedQuestionPart[],
  partAnchors: PartAnchor[],
) {
  const labelsByQuestion = new Map<string, Set<string>>();
  for (const part of questionParts) {
    let set = labelsByQuestion.get(part.question_number);
    if (!set) {
      set = new Set<string>();
      labelsByQuestion.set(part.question_number, set);
    }
    for (const label of part.referenced_support_labels ?? []) set.add(label);
  }

  for (let index = 0; index < partAnchors.length; index += 1) {
    const anchor = partAnchors[index];
    if (anchor.stems.length === 0) continue;
    const part = questionParts[index];
    const partLabels = part.referenced_support_labels ?? [];
    const questionLabels = labelsByQuestion.get(part.question_number) ?? new Set<string>();
    anchor.stems = anchor.stems.filter((stem) => {
      const introduced = stem.introducedLabels;
      if (introduced.length === 0) return true;
      if (introduced.some((label) => partLabels.includes(label))) return true;
      if (introduced.some((label) => questionLabels.has(label))) return false;
      return true;
    });
  }
}

function computeRegionSpans(
  questionParts: ExtractedQuestionPart[],
  partAnchors: PartAnchor[],
  pages: ExtractedPage[],
  skippedPages: Set<number>,
  layoutByPage: Map<number, ExtractedPageLayout>,
) {
  const linesByPage = new Map<number, TextLine[]>(pages.map((page) => [page.page_number, page.text_lines]));
  const anchorRectsByPage = new Map<number, BoundingBox[]>();
  for (const anchor of partAnchors) {
    if (anchor.start_line_bbox === null) continue;
    const rects = anchorRectsByPage.get(anchor.start_page) ?? [];
    rects.push(anchor.start_line_bbox);
    anchorRectsByPage.set(anchor.start_page, rects);
  }

  for (let index = 0; index < questionParts.length; index += 1) {
    const part = questionParts[index];
    const anchor = partAnchors[index];
    if (!anchor) continue;

    const spanPageSet = new Set<number>(part.page_numbers);
    spanPageSet.add(anchor.start_page);
    for (const contextLine of anchor.context_lines) {
      spanPageSet.add(contextLine.page_number);
    }

    const lastContentPage = Math.max(...spanPageSet);
    if (anchor.end && anchor.end.page_number > lastContentPage) {
      let bridged = 0;
      for (let pageNumber = lastContentPage + 1; pageNumber <= anchor.end.page_number && bridged < MAX_BRIDGE_PAGES; pageNumber += 1) {
        if (skippedPages.has(pageNumber)) continue;
        spanPageSet.add(pageNumber);
        bridged += 1;
      }
    }

    const spanPages = Array.from(spanPageSet).sort((a, b) => a - b);
    const firstPage = spanPages[0];
    const spans: RegionSpan[] = [];

    for (const pageNumber of spanPages) {
      const layout = layoutByPage.get(pageNumber);
      if (!layout) continue;

      let yTop: number;
      if (pageNumber === firstPage) {
        let top = anchor.start_page === pageNumber ? anchor.start_line_top : 0;
        for (const contextLine of anchor.context_lines) {
          if (contextLine.page_number === pageNumber) top = Math.max(top, contextLine.line.bbox.y1);
        }
        yTop = top > 0 ? Math.min(top + 3, layout.page_height) : layout.header_floor_y;
      } else {
        yTop = layout.header_floor_y;
      }

      const yBottom = anchor.end && anchor.end.page_number === pageNumber
        ? Math.max(anchor.end.y, layout.footer_ceiling_y)
        : layout.footer_ceiling_y;

      const span = { page_number: pageNumber, y_top: yTop, y_bottom: yBottom };
      fixSpanStraddles(span, linesByPage.get(pageNumber) ?? [], anchorRectsByPage.get(pageNumber) ?? []);
      const isBridgedTerminalPage = pageNumber > lastContentPage && anchor.end?.page_number === pageNumber;
      const minHeight = isBridgedTerminalPage ? MIN_ANSWER_BRIDGE_HEIGHT : MIN_SPAN_HEIGHT;
      if (span.y_top - span.y_bottom >= minHeight) spans.push(span);
    }

    part.region_spans = spans.length > 0 ? spans : null;
    if (anchor.stems.length > 0) {
      const stemSpans: RegionSpan[] = [];
      const seen = new Set<string>();
      for (const stem of anchor.stems) {
        const computed = computeStemSpans(stem, layoutByPage, skippedPages, linesByPage, anchorRectsByPage);
        for (const span of computed ?? []) {
          const key = `${span.page_number}:${Math.round(span.y_top)}:${Math.round(span.y_bottom)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          stemSpans.push(span);
        }
      }
      part.stem_spans = stemSpans.length > 0 ? stemSpans : null;
    }
  }

  const stemRects = questionParts.flatMap((part) =>
    (part.stem_spans ?? []).map((span) => ({ span, questionNumber: part.question_number })),
  );
  for (const part of questionParts) {
    if (!part.region_spans) continue;
    const kept = part.region_spans.filter((span) => {
      const height = span.y_top - span.y_bottom;
      if (height <= 0) return false;
      for (const other of stemRects) {
        if (other.questionNumber === part.question_number) continue;
        if (other.span.page_number !== span.page_number) continue;
        const overlap = Math.min(span.y_top, other.span.y_top) - Math.max(span.y_bottom, other.span.y_bottom);
        if (overlap > height * 0.6) return false;
      }
      return true;
    });
    part.region_spans = kept.length > 0 ? kept : null;
  }
}

type InkMask = { mask: Uint8Array; height: number };

async function buildInkRowMask(
  pdf: Awaited<ReturnType<typeof getDocument>["promise"]>,
  pageNumber: number,
  layout: ExtractedPageLayout,
  createCanvas: (w: number, h: number) => { width: number; height: number; getContext: (t: "2d") => { drawImage?: unknown; getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray }; render?: unknown } },
): Promise<InkMask | null> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: INK_RENDER_SCALE });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height) as never as {
    width: number;
    height: number;
    getContext: (t: "2d") => { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } };
  };
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as never, viewport } as never).promise;
  const { data } = context.getImageData(0, 0, width, height);
  const x0 = Math.max(0, Math.floor(layout.content_x0 * INK_RENDER_SCALE) + 4);
  const x1 = Math.min(width, Math.ceil(layout.content_x1 * INK_RENDER_SCALE) - 4);
  const isInk = (i: number) => data[i] < INK_PIXEL_THRESHOLD || data[i + 1] < INK_PIXEL_THRESHOLD || data[i + 2] < INK_PIXEL_THRESHOLD;

  const colInk = new Int32Array(width);
  for (let row = 0; row < height; row += 1) {
    const base = row * width * 4;
    for (let x = x0; x < x1; x += 1) {
      if (isInk(base + x * 4)) colInk[x] += 1;
    }
  }
  const verticalRuleThreshold = height * 0.7;

  const mask = new Uint8Array(height);
  for (let row = 0; row < height; row += 1) {
    let inked = 0;
    const base = row * width * 4;
    for (let x = x0; x < x1; x += 1) {
      if (colInk[x] > verticalRuleThreshold) continue;
      if (isInk(base + x * 4)) {
        inked += 1;
        if (inked >= 2) break;
      }
    }
    mask[row] = inked >= 2 ? 1 : 0;
  }
  return { mask, height };
}

async function trimSpansToInk(
  pdf: Awaited<ReturnType<typeof getDocument>["promise"]>,
  questionParts: ExtractedQuestionPart[],
  layoutByPage: Map<number, ExtractedPageLayout>,
  pages: ExtractedPage[],
  figures: ExtractedFigure[],
) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pagesNeeded = new Set<number>();
  for (const part of questionParts) {
    for (const span of part.region_spans ?? []) pagesNeeded.add(span.page_number);
    for (const span of part.stem_spans ?? []) pagesNeeded.add(span.page_number);
  }

  const linesByPage = new Map<number, TextLine[]>(pages.map((page) => [page.page_number, page.text_lines]));
  const furnitureMaskByPage = new Map<number, Uint8Array>();
  for (const pageNumber of pagesNeeded) {
    const layout = layoutByPage.get(pageNumber);
    if (!layout) continue;
    const height = Math.ceil(layout.page_height * INK_RENDER_SCALE);
    const furniture = new Uint8Array(height);
    for (const line of linesByPage.get(pageNumber) ?? []) {
      const text = normalizeText(line.text);
      if (!text) continue;
      if (!isFooterFurnitureLine(text) && !isHeaderFurnitureLine(text) && !isBookletMarkerLine(text)) continue;
      const top = Math.max(0, Math.round((layout.page_height - line.bbox.y1) * INK_RENDER_SCALE));
      const bottom = Math.min(height - 1, Math.round((layout.page_height - line.bbox.y0) * INK_RENDER_SCALE));
      for (let row = top; row <= bottom; row += 1) furniture[row] = 1;
    }
    furnitureMaskByPage.set(pageNumber, furniture);
  }

  const maskByPage = new Map<number, InkMask>();
  for (const pageNumber of pagesNeeded) {
    const layout = layoutByPage.get(pageNumber);
    if (!layout) continue;
    try {
      const ink = await buildInkRowMask(pdf, pageNumber, layout, createCanvas as never);
      if (ink) maskByPage.set(pageNumber, ink);
    } catch {
    }
  }

  const MIN_INK_ROWS = Math.round(6 * INK_RENDER_SCALE);
  const BAND_MERGE_GAP = Math.round(45 * INK_RENDER_SCALE);
  const TRAILING_BAND_MAX = Math.round(120 * INK_RENDER_SCALE);
  const BLANK_TRIM_ROWS = BLANK_TRIM_THRESHOLD * INK_RENDER_SCALE;

  const findContentBottomRow = (ink: InkMask, topRow: number, bottomRow: number, firstInk: number): number => {
    let cursor = bottomRow;
    for (let guard = 0; guard < 8; guard += 1) {
      while (cursor > topRow && !ink.mask[cursor]) cursor -= 1;
      if (cursor <= firstInk) return Math.max(cursor, firstInk);
      const bandBottom = cursor;
      let bandTop = cursor;
      while (bandTop - 1 >= topRow) {
        let probe = bandTop - 1;
        let gap = 0;
        while (probe > topRow && !ink.mask[probe] && gap < BAND_MERGE_GAP) { probe -= 1; gap += 1; }
        if (probe >= topRow && ink.mask[probe] && (bandTop - probe) <= BAND_MERGE_GAP) bandTop = probe;
        else break;
      }
      let above = bandTop - 1;
      let gapRows = 0;
      while (above > topRow && !ink.mask[above]) { above -= 1; gapRows += 1; }
      const isThin = (bandBottom - bandTop) <= TRAILING_BAND_MAX;
      if (above > firstInk && isThin && gapRows > BLANK_TRIM_ROWS) {
        cursor = above; 
        continue;
      }
      return bandBottom;
    }
    return cursor;
  };

  const isFurnitureText = (text: string) =>
    isFooterFurnitureLine(text) || isHeaderFurnitureLine(text) || isBookletMarkerLine(text);
  const isStrongFooterFurniture = (text: string) => {
    const normalized = normalizeText(text);
    if (/^\d{1,3}$/.test(normalized)) return false;
    return isFooterFurnitureLine(normalized) || isBookletMarkerLine(normalized);
  };
  const stripTrailingFurnitureByText = (span: RegionSpan): RegionSpan => {
    const lines = (linesByPage.get(span.page_number) ?? [])
      .filter((line) => line.bbox.y0 >= span.y_bottom - 1 && line.bbox.y1 <= span.y_top + 1 && normalizeText(line.text));
    if (lines.length === 0) return span;
    const byBottom = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    let yBottom = span.y_bottom;
    let bottomHasStrong = false;
    for (const line of byBottom) {
      if (!isFurnitureText(line.text)) break;
      if (isStrongFooterFurniture(line.text)) bottomHasStrong = true;
      yBottom = Math.max(yBottom, line.bbox.y1 + 2);
    }
    if (!bottomHasStrong) yBottom = span.y_bottom;
    const byTop = [...lines].sort((a, b) => b.bbox.y1 - a.bbox.y1);
    let yTop = span.y_top;
    let topHasStrong = false;
    for (const line of byTop) {
      if (!isFurnitureText(line.text)) break;
      if (isStrongFooterFurniture(line.text)) topHasStrong = true;
      yTop = Math.min(yTop, line.bbox.y0 - 2);
    }
    if (!topHasStrong) yTop = span.y_top;
    if (yTop - yBottom < MIN_SPAN_HEIGHT) return span;
    return { page_number: span.page_number, y_top: yTop, y_bottom: yBottom };
  };

  const trimSpan = (span: RegionSpan): RegionSpan | null => {
    const ink = maskByPage.get(span.page_number);
    const layout = layoutByPage.get(span.page_number);
    if (!layout) return span;
    if (!ink) return stripTrailingFurnitureByText(span);
    const furniture = furnitureMaskByPage.get(span.page_number) ?? new Uint8Array(ink.height);
    const rowOf = (y: number) => Math.round((layout.page_height - y) * INK_RENDER_SCALE);
    const yOf = (row: number) => layout.page_height - row / INK_RENDER_SCALE;
    const topRow = Math.max(0, rowOf(span.y_top));
    const bottomRow = Math.min(ink.height - 1, rowOf(span.y_bottom));
    if (bottomRow <= topRow) return span;

    let firstInk = -1;
    let lastInk = -1;
    let inkCount = 0;
    for (let row = topRow; row <= bottomRow; row += 1) {
      if (ink.mask[row]) {
        if (firstInk < 0) firstInk = row;
        lastInk = row;
        inkCount += 1;
      }
    }
    if (inkCount < MIN_INK_ROWS) return null;

    let contentTop = firstInk;
    let strippedTopFurniture = false;
    while (contentTop < lastInk && (furniture[contentTop] || !ink.mask[contentTop])) {
      if (furniture[contentTop]) strippedTopFurniture = true;
      contentTop += 1;
    }

    let contentBottom = findContentBottomRow(ink, topRow, bottomRow, contentTop);
    let strippedBottomFurniture = false;
    while (contentBottom > contentTop && (furniture[contentBottom] || !ink.mask[contentBottom])) {
      if (furniture[contentBottom]) strippedBottomFurniture = true;
      contentBottom -= 1;
    }

    let yTop = span.y_top;
    let yBottom = span.y_bottom;
    if (strippedTopFurniture || (contentTop - topRow) / INK_RENDER_SCALE > BLANK_TRIM_THRESHOLD) {
      yTop = Math.min(span.y_top, yOf(contentTop) + BLANK_KEEP_MARGIN);
    }
    if (strippedBottomFurniture || (bottomRow - contentBottom) / INK_RENDER_SCALE > BLANK_TRIM_THRESHOLD) {
      yBottom = Math.max(span.y_bottom, yOf(contentBottom) - BLANK_KEEP_MARGIN);
    }
    const refined = stripTrailingFurnitureByText({ page_number: span.page_number, y_top: yTop, y_bottom: yBottom });
    if (refined.y_top - refined.y_bottom < MIN_SPAN_HEIGHT) return null;
    return refined;
  };

  const trimList = (spans: RegionSpan[] | null | undefined): RegionSpan[] | null => {
    if (!spans) return null;
    const trimmed = spans.map(trimSpan).filter((span): span is RegionSpan => span !== null);
    return trimmed.length > 0 ? trimmed : null;
  };

  for (const part of questionParts) {
    part.region_spans = trimList(part.region_spans);
    part.stem_spans = trimList(part.stem_spans);
  }

  for (const figure of figures) {
    const trimmed = stripTrailingFurnitureByText(figure);
    figure.y_top = trimmed.y_top;
    figure.y_bottom = trimmed.y_bottom;
  }
}

async function extractPaper(pdfPath: string, outputDir: string, config: BoardConfig, boardCode: string, subjectSlug: string, trimBlank = false): Promise<ExtractedPaper> {
  const sourceBytes = readFileSync(pdfPath);
  const pdf = await getDocument({
    data: new Uint8Array(sourceBytes),
    useWorkerFetch: false,
    standardFontDataUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`,
    wasmUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/wasm")}/`,
  } as never).promise;

  const paperCode = config.inferPaperCode(basename(pdfPath));
  const paperName = config.inferPaperName(paperCode);
  const pages: ExtractedPage[] = [];
  const questionParts: ExtractedQuestionPart[] = [];
  const partAnchors: PartAnchor[] = [];
  const assets: ExtractedAsset[] = [];
  const questionIdCounts = new Map<string, number>();
  const pageDimensions = new Map<number, { width: number; height: number }>();
  const skippedPages = new Set<number>();
  let backMatterStarted = false;
  let currentSectionCode: string | null = null;
  let currentSectionName: string | null = null;
  let currentQuestionNumber: string | null = null;
  let active: ActiveQuestionPart | null = null;
  let currentStem: QuestionStemAnchor | null = null;
  let currentStemTransient = false;
  let currentStemParentLetter: string | null = null;
  let questionBaseStem: QuestionStemAnchor | null = null;
  let sectionStems: QuestionStemAnchor[] = [];

  let pendingContext: string[] = [];
  let pendingContextLines: PageAnchoredLine[] = [];

  const pushFinalizedPart = (activePart: ActiveQuestionPart, end: PartEndBoundary) => {
    const finalized = finalizeQuestionPart(activePart, config, questionIdCounts);
    const stems: QuestionStemAnchor[] = [];
    if (activePart.question_part_number !== null) {
      if (questionBaseStem !== null && questionBaseStem.question_number === activePart.question_number) {
        stems.push(questionBaseStem);
      }
      if (
        currentStem !== null
        && currentStem.question_number === activePart.question_number
        && currentStem !== questionBaseStem
      ) {
        stems.push(currentStem);
      }
      for (const sectionStem of sectionStems) {
        if (sectionStem.question_number === activePart.question_number && !stems.includes(sectionStem)) stems.push(sectionStem);
      }
    }
    questionParts.push(finalized);
    partAnchors.push({
      start_page: activePart.start_page,
      start_line_top: activePart.start_line_top,
      start_line_bbox: activePart.promptLines[0]?.bbox ?? null,
      context_lines: activePart.context_lines,
      end,
      stems,
    });
    if (currentStem !== null && currentStem !== questionBaseStem && currentStemTransient) {
      currentStem = null;
      currentStemTransient = false;
    }
  };

  let choiceGroupSequence = 0;
  let activeChoiceGroup: {
    groupId: string;
    groupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice";
    scopeKey: string;
    optionCount: number;
    lastQuestionNumber: number | null;
    sharedStem: string | null;
  } | null = null;

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(resolve(outputDir, "assets"), { recursive: true });

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    pageDimensions.set(pageNumber, { width: viewport.width, height: viewport.height });
    const textContent = await page.getTextContent();
    const textLines = groupTextItemsIntoLines(textContent.items as Array<{ str: string; transform: number[]; width: number; height: number }>);
    const pageText = textLines.map((line) => line.text).join("\n");

    const detectedSection = config.detectSection(pageText, currentSectionCode);
    if (detectedSection.code) {
      if (detectedSection.code !== currentSectionCode) {
        activeChoiceGroup = null;
      }
      currentSectionCode = detectedSection.code;
      currentSectionName = detectedSection.name;
    }

    const pageAssetPath = resolve(outputDir, "assets", `page-${String(pageNumber).padStart(3, "0")}.pdf`);
    const splitOk = await exportSinglePagePdf(new Uint8Array(sourceBytes), pdfPath, pageIndex, pageAssetPath);
    const pageAssetId = `asset-page-${String(pageIndex).padStart(4, "0")}`;
    assets.push({
      asset_id: pageAssetId,
      kind: "page_pdf",
      page_number: pageNumber,
      bbox: null,
      file_path: splitOk ? pageAssetPath : pdfPath,
      description: splitOk
        ? "Single-page PDF source for exact reuse in generated papers."
        : "Source PDF (page splitting failed, use page_number for reference).",
    });

    pages.push({
      page_number: pageNumber,
      section_code: currentSectionCode,
      section_name: currentSectionName,
      text_lines: textLines,
      image_asset_ids: [],
      page_text: pageText,
    });

    if (backMatterStarted || isBackMatterPageStart(pageText)) {
      backMatterStarted = true;
      skippedPages.add(pageNumber);
      continue;
    }

    if (config.shouldSkipPage(pageNumber, pageText)) {
      skippedPages.add(pageNumber);
      continue;
    }

    const startActiveQuestion = (questionNumber: string, questionPartNumber: string | null, promptLine: TextLine, contextTexts: string[], choiceMeta?: { groupId: string; groupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; optionLabel: string | null; sharedStem: string | null }, anchorContextLines: PageAnchoredLine[] = [], questionPath: string[] = []) => {
      active = {
        page_number: pageNumber,
        page_numbers: new Set([pageNumber]),
        question_number: questionNumber,
        question_part_number: questionPartNumber,
        question_path: questionPath,
        section_code: currentSectionCode,
        section_name: currentSectionName,
        paper_code: paperCode,
        paper_name: paperName,
        contextTexts,
        promptLines: [promptLine],
        assetIds: new Set([pageAssetId]),
        choiceGroupId: choiceMeta?.groupId ?? null,
        choiceGroupType: choiceMeta?.groupType ?? null,
        choiceOptionLabel: choiceMeta?.optionLabel ?? null,
        sharedChoiceStem: choiceMeta?.sharedStem ?? null,
        start_page: pageNumber,
        start_line_top: promptLine.bbox.y1,
        context_lines: anchorContextLines,
      };
    };

    let pendingChoiceQuestion = false;
    let pendingChoiceMeta: { type: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; sharedStem: string | null } | null = null;

    const claimRegionStart = (anchorContextLines: PageAnchoredLine[], startLine: TextLine): { page_number: number; y: number } => {
      let claimPage = pageNumber;
      for (const contextLine of anchorContextLines) claimPage = Math.min(claimPage, contextLine.page_number);
      let top = claimPage === pageNumber ? startLine.bbox.y1 : 0;
      for (const contextLine of anchorContextLines) {
        if (contextLine.page_number === claimPage) top = Math.max(top, contextLine.line.bbox.y1);
      }
      return { page_number: claimPage, y: top + 2 };
    };

    for (const line of textLines) {
      const rawText = line.text;
      const detectionText = rawText
        .replace(/^DO NOT WRITE IN THIS AREA\s*/i, "")
        .replace(/^\*\s*(?=\(|\d)/, "")
        .trim() || rawText;

      const choicePattern = detectChoiceGroupPattern(detectionText, subjectSlug);
      if (choicePattern) {
        if (choicePattern.type === "either_or" && choicePattern.optionLabel === null) {
          pendingChoiceQuestion = true;
          pendingChoiceMeta = { type: choicePattern.type, sharedStem: choicePattern.sharedStem };
          continue;
        }
        pendingChoiceQuestion = true;
        pendingChoiceMeta = { type: choicePattern.type, sharedStem: choicePattern.sharedStem };
        continue;
      }

      const referencedQuestionNumber = extractReferencedQuestionNumber(detectionText);
      if (referencedQuestionNumber) {
        const activePart = active as ActiveQuestionPart | null;
        if (activePart !== null) {
          const currentQ = activePart.question_number;
          const current = Number(currentQ);
          const referenced = Number(referencedQuestionNumber);
          if (!Number.isNaN(current) && !Number.isNaN(referenced) && referenced > current) {
            pushFinalizedPart(activePart, { page_number: pageNumber, y: line.bbox.y1 + 2 });
            active = null;
            pendingContext = [];
            pendingContextLines = [];
            continue;
          }
        }
      }

      const extractedChoiceNumber: string | null = pendingChoiceQuestion
        ? extractChoiceQuestionNumber(detectionText, line, currentQuestionNumber, boardCode)
        : null;
      const choiceQuestionNumber: string | null = extractedChoiceNumber;
      if (choiceQuestionNumber) {
        if (active !== null) {
          pushFinalizedPart(active, claimRegionStart([], line));
          active = null;
        }
        currentStem = null;
        questionBaseStem = null;
        sectionStems = [];

        let choiceMeta: { groupId: string; groupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; optionLabel: string | null; sharedStem: string | null } | undefined;
        if (pendingChoiceMeta) {
          const groupType = pendingChoiceMeta.type;
          const scopeKey = buildChoiceScopeKey(groupType, currentSectionCode, choiceQuestionNumber);
          const choiceNumberValue = Number(choiceQuestionNumber);
          const shouldReuseGroup = activeChoiceGroup !== null
            && activeChoiceGroup.groupType === groupType
            && activeChoiceGroup.scopeKey === scopeKey
            && (
              groupType !== "either_or"
              || (activeChoiceGroup.lastQuestionNumber !== null
                && !Number.isNaN(choiceNumberValue)
                && choiceNumberValue === activeChoiceGroup.lastQuestionNumber + 1)
            );

          if (!shouldReuseGroup) {
            choiceGroupSequence += 1;
            activeChoiceGroup = {
              groupId: buildChoiceGroupId(paperCode, currentSectionCode, groupType, String(choiceGroupSequence)),
              groupType,
              scopeKey,
              optionCount: 0,
              lastQuestionNumber: null,
              sharedStem: pendingChoiceMeta.sharedStem,
            };
          }
          if (activeChoiceGroup === null) {
            throw new Error("Choice group state was not initialized");
          }
          const choiceGroup = activeChoiceGroup;
          const optionLabel = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[choiceGroup.optionCount] ?? null;
          choiceGroup.optionCount += 1;
          choiceGroup.lastQuestionNumber = Number.isNaN(choiceNumberValue) ? null : choiceNumberValue;
          choiceGroup.sharedStem = pendingChoiceMeta.sharedStem ?? choiceGroup.sharedStem;
          choiceMeta = {
            groupId: choiceGroup.groupId,
            groupType,
            optionLabel,
            sharedStem: choiceGroup.sharedStem,
          };
        }

        currentQuestionNumber = choiceQuestionNumber;
        pendingContext = [];
        pendingContextLines = [];
        startActiveQuestion(currentQuestionNumber, null, line, [], choiceMeta);
        pendingChoiceQuestion = false;
        pendingChoiceMeta = null;
        continue;
      }

      pendingChoiceQuestion = false;
      pendingChoiceMeta = null;

      const standaloneQuestionNumber = extractStandaloneQuestionNumber(
        detectionText,
        line,
        currentQuestionNumber,
        subjectSlug,
        boardCode,
        currentSectionCode,
      );
      if (standaloneQuestionNumber) {
        const standaloneContextLines = pendingContextLines;
        if (active) {
          pushFinalizedPart(active, claimRegionStart(standaloneContextLines, line));
          active = null;
        }

        currentQuestionNumber = standaloneQuestionNumber;
        currentStem = null;
        currentStemParentLetter = null;
        questionBaseStem = null;
        sectionStems = [];
        pendingContext = [];
        pendingContextLines = [];
        startActiveQuestion(currentQuestionNumber, null, line, [], undefined, standaloneContextLines);
        continue;
      }

      if (isBookletMarkerLine(detectionText) || isFiller(detectionText, config)) {
        continue;
      }

      const topLevelQuestion = extractTopLevelQuestion(detectionText, line, currentQuestionNumber, config);
      if (topLevelQuestion) {
        const topLevelContextLines = pendingContextLines;
        if (active) {
          pushFinalizedPart(active, claimRegionStart(topLevelContextLines, line));
          active = null;
        }
        currentQuestionNumber = topLevelQuestion;
        currentStem = null;
        currentStemParentLetter = null;
        questionBaseStem = null;
        sectionStems = [];
        pendingContext = [];
        pendingContextLines = [];
        if (!isQuestionHeadingOnly(detectionText, config)) {
          startActiveQuestion(currentQuestionNumber, null, line, [], undefined, topLevelContextLines);
        }
        continue;
      }

      const subquestion = extractSubquestion(detectionText, line, currentQuestionNumber, config, boardCode, subjectSlug);
      if (subquestion) {
        const activePart = active as ActiveQuestionPart | null;
        const activeIsLetteredSetupParent = activePart !== null
          && activePart.question_part_number !== null
          && /^[a-z]$/i.test(activePart.question_part_number)
          && subquestion.partNumber !== null
          && /^[ivx]+$/i.test(subquestion.partNumber)
          && !activePart.promptLines.some((promptLine) => hasMarks(promptLine.text, config));
        if (activePart !== null && activePart.question_number === subquestion.questionNumber
            && (activePart.question_part_number === null || activeIsLetteredSetupParent)) {
          const stemText = cleanText([...activePart.contextTexts, ...activePart.promptLines.map((promptLine: TextLine) => promptLine.text)].join(" "));
          currentStem = {
            question_number: subquestion.questionNumber,
            start_page: activePart.start_page,
            start_top: activePart.start_line_top,
            context_lines: activePart.context_lines,
            subpart_start_page: pageNumber,
            subpart_start_top: line.bbox.y1,
            introducedLabels: extractReferencedSupportLabels(stemText),
          };
          currentStemTransient = false;
          currentStemParentLetter = activePart.question_part_number;
          if (activePart.question_part_number === null) questionBaseStem = currentStem;
            startActiveQuestion(
              subquestion.questionNumber,
              subquestion.partNumber,
              line,
              stemText ? [stemText] : [],
              undefined,
              [],
              [...activePart.question_path, subquestion.partNumber],
            );
        } else {
          const subquestionContextLines = pendingContextLines;
          if (activePart !== null) {
            pushFinalizedPart(activePart, claimRegionStart(subquestionContextLines, line));
          }

          currentQuestionNumber = subquestion.questionNumber;

          if (currentStemParentLetter !== null && subquestion.partNumber !== null && /^[a-z]$/i.test(subquestion.partNumber)) {
            currentStem = null;
            currentStemTransient = false;
            currentStemParentLetter = null;
          }

          const contextTexts = pendingContext.length > 0 ? pendingContext : [];
          if (subquestionContextLines.length > 0) {
            const stemStartPage = Math.min(...subquestionContextLines.map((contextLine) => contextLine.page_number));
            currentStem = {
              question_number: subquestion.questionNumber,
              start_page: stemStartPage,
              start_top: Math.max(...subquestionContextLines
                .filter((contextLine) => contextLine.page_number === stemStartPage)
                .map((contextLine) => contextLine.line.bbox.y1)),
              context_lines: subquestionContextLines,
              subpart_start_page: pageNumber,
              subpart_start_top: line.bbox.y1,
              introducedLabels: extractReferencedSupportLabels(
                subquestionContextLines.map((contextLine) => contextLine.line.text).join(" "),
              ),
            };
            currentStemTransient = true;
            if (subjectSlug === "english-literature") sectionStems.push(currentStem);
          }

          startActiveQuestion(currentQuestionNumber, subquestion.partNumber, line, contextTexts, undefined, subquestionContextLines, [subquestion.partNumber]);
        }

        pendingContext = [];
        pendingContextLines = [];
        continue;
      }

      const continuationSubquestion = currentQuestionNumber ? extractContinuationSubquestion(detectionText) : null;
      if (continuationSubquestion && currentQuestionNumber) {
        const activePart = active as ActiveQuestionPart | null;
        const activeIsLetteredSetupParent = activePart !== null
          && activePart.question_part_number !== null
          && /^[a-z]$/i.test(activePart.question_part_number)
          && /^[ivx]+$/i.test(continuationSubquestion)
          && !activePart.promptLines.some((promptLine) => hasMarks(promptLine.text, config));
        if (activePart !== null && activePart.question_number === currentQuestionNumber
            && (activePart.question_part_number === null || activeIsLetteredSetupParent)) {
          const stemText = cleanText([...activePart.contextTexts, ...activePart.promptLines.map((promptLine) => promptLine.text)].join(" "));
          currentStem = {
            question_number: currentQuestionNumber,
            start_page: activePart.start_page,
            start_top: activePart.start_line_top,
            context_lines: activePart.context_lines,
            subpart_start_page: pageNumber,
            subpart_start_top: line.bbox.y1,
            introducedLabels: extractReferencedSupportLabels(stemText),
          };
          currentStemTransient = false;
          currentStemParentLetter = activePart.question_part_number;
          if (activePart.question_part_number === null) questionBaseStem = currentStem;
          startActiveQuestion(
            currentQuestionNumber,
            continuationSubquestion,
            line,
            stemText ? [stemText] : [],
            undefined,
            [],
            [...activePart.question_path, continuationSubquestion],
          );
        } else {
          const subquestionContextLines = pendingContextLines;
          if (active) {
            pushFinalizedPart(active, claimRegionStart(subquestionContextLines, line));
          }

          const continuationPath = currentStemParentLetter !== null
            && /^[ivx]+$/i.test(continuationSubquestion)
            ? [currentStemParentLetter, continuationSubquestion]
            : [continuationSubquestion];
          if (currentStemParentLetter !== null && /^[a-z]$/i.test(continuationSubquestion)) {
            currentStem = null;
            currentStemTransient = false;
            currentStemParentLetter = null;
          }

          if (subquestionContextLines.length > 0) {
            const stemStartPage = Math.min(...subquestionContextLines.map((contextLine) => contextLine.page_number));
            currentStem = {
              question_number: currentQuestionNumber,
              start_page: stemStartPage,
              start_top: Math.max(...subquestionContextLines
                .filter((contextLine) => contextLine.page_number === stemStartPage)
                .map((contextLine) => contextLine.line.bbox.y1)),
              context_lines: subquestionContextLines,
              subpart_start_page: pageNumber,
              subpart_start_top: line.bbox.y1,
              introducedLabels: extractReferencedSupportLabels(
                subquestionContextLines.map((contextLine) => contextLine.line.text).join(" "),
              ),
            };
            currentStemTransient = true;
            if (subjectSlug === "english-literature") sectionStems.push(currentStem);
          }

          const contextTexts = pendingContext.length > 0 ? pendingContext : [];
          startActiveQuestion(currentQuestionNumber, continuationSubquestion, line, contextTexts, undefined, subquestionContextLines, continuationPath);
        }

        pendingContext = [];
        pendingContextLines = [];
        continue;
      }

      const topLevelQuestionStart = extractTopLevelQuestionStart(
        detectionText,
        line,
        currentQuestionNumber,
        subjectSlug,
        boardCode,
        currentSectionCode,
      );
      if (topLevelQuestionStart) {
        const topLevelStartContextLines = pendingContextLines;
        if (active) {
          pushFinalizedPart(active, claimRegionStart(topLevelStartContextLines, line));
        }

        currentQuestionNumber = topLevelQuestionStart;
        currentStem = null;
        currentStemParentLetter = null;

        startActiveQuestion(currentQuestionNumber, null, line, [], undefined, topLevelStartContextLines);

        pendingContext = [];
        pendingContextLines = [];
        continue;
      }

      if (active) {
        const activePart = active as ActiveQuestionPart;

        const sourceTotal = parseSourceQuestionTotal(rawText);
        if (sourceTotal) {
          if (sourceTotal.questionNumber === normalizeQuestionNumberForMarks(activePart.question_number)) {
            activePart.promptLines.push(line);
            activePart.page_numbers.add(pageNumber);
            activePart.assetIds.add(pageAssetId);
          }
          pushFinalizedPart(activePart, { page_number: pageNumber, y: line.bbox.y0 - 2 });
          active = null;
          pendingContext = [];
          pendingContextLines = [];
          continue;
        }

        if (isTotalForPaperLine(rawText)) {
          pushFinalizedPart(activePart, { page_number: pageNumber, y: line.bbox.y1 + 2 });
          active = null;
          pendingContext = [];
          pendingContextLines = [];
          continue;
        }

        const hasMarksAlready = activePart.promptLines.some((item) => hasMarks(item.text, config));

        if (hasMarksAlready && !config.isMCOption(rawText) && !config.isAnswerSlot(rawText)) {
          if (
            isContextLine(rawText, config)
            || (config.name === "Edexcel" && isNextPartIntroLine(rawText))
            || (subjectSlug === "english-literature" && isNextPartIntroLine(rawText))
            || (subjectSlug === "business" && looksLikeBusinessSetupStart(rawText))
          ) {
            pushFinalizedPart(activePart, { page_number: pageNumber, y: line.bbox.y1 + 2 });
            active = null;
            pendingContext = [rawText];
            pendingContextLines = [{ page_number: pageNumber, line }];
            continue;
          }
        }

        activePart.promptLines.push(line);
        activePart.page_numbers.add(pageNumber);
        activePart.assetIds.add(pageAssetId);
      } else {
        pendingContext.push(rawText);
        pendingContextLines.push({ page_number: pageNumber, line });
      }
    }
  }

  if (active) {
    pushFinalizedPart(active, null);
  }

  const questionIdToGroupId = new Map<string, string>();
  for (const part of questionParts) {
    if (part.choiceGroupId) {
      questionIdToGroupId.set(part.question_id, part.choiceGroupId);
    }
  }
  const groupToQuestionIds = new Map<string, string[]>();
  for (const [questionId, groupId] of questionIdToGroupId.entries()) {
    const members = groupToQuestionIds.get(groupId) ?? [];
    members.push(questionId);
    groupToQuestionIds.set(groupId, members);
  }
  for (const part of questionParts) {
    if (part.choiceGroupId) {
      const siblings = groupToQuestionIds.get(part.choiceGroupId) ?? [];
      part.choiceSiblingQuestionIds = siblings.filter((id) => id !== part.question_id);

      if (subjectSlug === "english-literature" && part.choiceGroupType === "either_or") {
        if (part.section_code === "A") {
          part.choiceGroupType = "text_choice";
        } else if (part.section_code === "B") {
          part.choiceGroupType = "cluster_choice";
        }
      }
    }
  }

  const pageLayouts = computePageLayouts(pages, pageDimensions, config);
  const layoutByPage = new Map(pageLayouts.map((layout) => [layout.page_number, layout]));
  const figures = detectFigures(pages, skippedPages, partAnchors, layoutByPage);
  propagateFigureRefsToSubparts(questionParts);
  pruneMismatchedBaseStems(questionParts, partAnchors);
  computeRegionSpans(questionParts, partAnchors, pages, skippedPages, layoutByPage);
  if (trimBlank) {
    await trimSpansToInk(pdf, questionParts, layoutByPage, pages, figures);
  }
  if (subjectSlug === "english-literature") {
    mergeStandaloneSourceStems(questionParts);
  }
  if (boardCode === "edexcel" && (subjectSlug === "french" || subjectSlug === "spanish") && /reading|1fr0-3|1sp0-3/i.test(basename(pdfPath))) {
    normalizeLanguageReadingMarks(questionParts, pages);
  }
  reconcileQuestionMarks(questionParts, pages);
  attachQuestionIdentityAnchors(questionParts, pages, boardCode, subjectSlug);

  return {
    source_file: pdfPath,
    board_code: boardCode,
    subject_slug: subjectSlug,
    paper_code: paperCode,
    year: inferYear(basename(pdfPath)),
    session: inferSession(basename(pdfPath)),
    parser_version: PARSER_VERSION,
    pages,
    question_parts: questionParts,
    assets,
    figures,
    page_layouts: pageLayouts,
  };
}

function validateRegions(extracted: ExtractedPaper) {
  const linesByPage = new Map(extracted.pages.map((page) => [page.page_number, page.text_lines]));
  const layoutByPage = new Map(extracted.page_layouts.map((layout) => [layout.page_number, layout]));
  let partsWithSpans = 0;
  let straddleCount = 0;
  let totalSpanHeight = 0;
  let totalSpans = 0;

  for (const part of extracted.question_parts) {
    if (!part.region_spans || part.region_spans.length === 0) continue;
    partsWithSpans += 1;
    for (const span of part.region_spans) {
      straddleCount += countSpanStraddles(span, linesByPage.get(span.page_number) ?? [], layoutByPage.get(span.page_number));
      totalSpanHeight += span.y_top - span.y_bottom;
      totalSpans += 1;
    }
    for (const span of part.stem_spans ?? []) {
      straddleCount += countSpanStraddles(span, linesByPage.get(span.page_number) ?? [], layoutByPage.get(span.page_number));
    }
  }

  return {
    parts: extracted.question_parts.length,
    partsWithSpans,
    straddleCount,
    figureCount: extracted.figures.length,
    averageSpanHeight: totalSpans > 0 ? Math.round(totalSpanHeight / totalSpans) : 0,
  };
}

async function renderSpanOverlays(pdfPath: string, extracted: ExtractedPaper, outputDir: string) {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix;
  globalThis.ImageData ??= ImageData as unknown as typeof globalThis.ImageData;
  globalThis.Path2D ??= Path2D as unknown as typeof globalThis.Path2D;

  const scale = 1.5;
  const sourceBytes = readFileSync(pdfPath);
  const pdf = await getDocument({
    data: new Uint8Array(sourceBytes),
    useWorkerFetch: false,
    standardFontDataUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`,
    wasmUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/wasm")}/`,
  } as never).promise;

  const layoutByPage = new Map(extracted.page_layouts.map((layout) => [layout.page_number, layout]));
  const debugDir = resolve(outputDir, "debug-spans");
  mkdirSync(debugDir, { recursive: true });

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const layout = layoutByPage.get(pageNumber);
    if (!layout) continue;

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context as never, viewport } as never).promise;

    const toCanvasY = (y: number) => (layout.page_height - y) * scale;
    const drawSpan = (yTop: number, yBottom: number, color: string, label: string) => {
      const x = layout.content_x0 * scale;
      const width = (layout.content_x1 - layout.content_x0) * scale;
      const y = toCanvasY(yTop);
      const height = toCanvasY(yBottom) - toCanvasY(yTop);
      context.fillStyle = color;
      context.globalAlpha = 0.14;
      context.fillRect(x, y, width, height);
      context.globalAlpha = 1;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.strokeRect(x, y, width, height);
      context.fillStyle = color;
      context.font = "11px sans-serif";
      context.fillText(label, x + 4, y + 12);
    };

    context.strokeStyle = "#888888";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(0, toCanvasY(layout.header_floor_y));
    context.lineTo(canvas.width, toCanvasY(layout.header_floor_y));
    context.moveTo(0, toCanvasY(layout.footer_ceiling_y));
    context.lineTo(canvas.width, toCanvasY(layout.footer_ceiling_y));
    context.stroke();
    context.setLineDash([]);

    for (const part of extracted.question_parts) {
      for (const span of part.region_spans ?? []) {
        if (span.page_number !== pageNumber) continue;
        drawSpan(span.y_top, span.y_bottom, "#1d4ed8", part.question_id);
      }
      for (const span of part.stem_spans ?? []) {
        if (span.page_number !== pageNumber) continue;
        drawSpan(span.y_top, span.y_bottom, "#15803d", `${part.question_id} stem`);
      }
    }
    for (const figure of extracted.figures) {
      if (figure.page_number !== pageNumber) continue;
      drawSpan(figure.y_top, figure.y_bottom, "#c2410c", figure.label);
    }

    writeFileSync(resolve(debugDir, `page-${String(pageNumber).padStart(3, "0")}.png`), canvas.toBuffer("image/png"));
  }
}

async function processDirectory(inputDir: string, outputDir: string, forcedBoard: string | null, options: { subject: string | null; validateRegions: boolean; renderSpans: boolean; trimBlank: boolean }) {
  const pdfFiles: string[] = [];

  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf") && entry.name.toLowerCase().includes("question_paper")) {
        pdfFiles.push(fullPath);
      }
    }
  }

  scan(inputDir);
  console.log(`Found ${pdfFiles.length} question paper PDFs in ${inputDir}`);

  const aggregate = { papers: 0, parts: 0, partsWithSpans: 0, straddles: 0, figures: 0 };

  for (const pdfPath of pdfFiles) {
    const boardCode = forcedBoard ?? inferBoard(pdfPath);
    const subjectSlug = inferSubjectFromPath(pdfPath);
    const config = BOARD_CONFIGS[boardCode];

    if (!config) {
      console.warn(`Unknown board for ${pdfPath}, skipping`);
      continue;
    }
    if (options.subject && subjectSlug !== options.subject) {
      continue;
    }

    const paperDirName = basename(pdfPath).replace(/\.pdf$/i, "");
    const tierDir = inferTierDirFromPath(pdfPath);
    const paperOutputDir = tierDir
      ? resolve(outputDir, boardCode, subjectSlug, tierDir, paperDirName)
      : resolve(outputDir, boardCode, subjectSlug, paperDirName);

    console.log(`Extracting [${boardCode}/${subjectSlug}] ${basename(pdfPath)}`);
    try {
      const extracted = await extractPaper(pdfPath, paperOutputDir, config, boardCode, subjectSlug, options.trimBlank);
      writeFileSync(resolve(paperOutputDir, "paper.json"), JSON.stringify(extracted, null, 2));
      console.log(`  wrote ${resolve(paperOutputDir, "paper.json")} (${extracted.question_parts.length} parts)`);

      if (options.validateRegions) {
        const stats = validateRegions(extracted);
        aggregate.papers += 1;
        aggregate.parts += stats.parts;
        aggregate.partsWithSpans += stats.partsWithSpans;
        aggregate.straddles += stats.straddleCount;
        aggregate.figures += stats.figureCount;
        const coverage = stats.parts > 0 ? Math.round((stats.partsWithSpans / stats.parts) * 100) : 0;
        console.log(`  regions: ${stats.partsWithSpans}/${stats.parts} parts (${coverage}%), ${stats.figureCount} figures, ${stats.straddleCount} straddles, avg span ${stats.averageSpanHeight}pt`);
      }
      if (options.renderSpans) {
        await renderSpanOverlays(pdfPath, extracted, paperOutputDir);
        console.log(`  span overlays → ${resolve(paperOutputDir, "debug-spans")}`);
      }
    } catch (error) {
      console.warn(`  Failed to extract ${basename(pdfPath)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (options.validateRegions && aggregate.papers > 0) {
    const coverage = aggregate.parts > 0 ? Math.round((aggregate.partsWithSpans / aggregate.parts) * 100) : 0;
    console.log("");
    console.log(`Region validation: ${aggregate.papers} papers, ${aggregate.partsWithSpans}/${aggregate.parts} parts with spans (${coverage}%), ${aggregate.figures} figures, ${aggregate.straddles} straddles`);
    if (aggregate.straddles > 0) {
      process.exitCode = 1;
    }
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run papers:extract -- [--input-dir <path>] [--output-dir <path>] [--board <aqa|edexcel|ocr>] [--subject <slug>] [--validate-regions] [--render-spans]");
    console.log("Environment:");
    console.log("  --input-dir          Directory to scan for PDFs (default: data/downloads)");
    console.log("  --output-dir         Directory for extracted output (default: data/extracted)");
    console.log("  --board              Force board detection (aqa, edexcel, ocr)");
    console.log("  --subject            Only extract papers for this subject slug");
    console.log("  --validate-regions   Print region-span coverage/straddle stats (non-zero exit on straddles)");
    console.log("  --render-spans       Write debug PNGs with span overlays next to each paper.json");
    return;
  }

  const { inputDir, outputDir, board, subject, validateRegions: shouldValidate, renderSpans, trimBlank } = parseArgs();
  await processDirectory(inputDir, outputDir, board, { subject, validateRegions: shouldValidate, renderSpans, trimBlank });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
