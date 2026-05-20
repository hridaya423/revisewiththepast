import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type BoundingBox = { x0: number; y0: number; x1: number; y1: number };
type TextLine = { text: string; bbox: BoundingBox; y: number };

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
  section_code: string | null;
  section_name: string | null;
  paper_code: string;
  paper_name: string;
  context_text: string | null;
  marks: number | null;
  command_word: string | null;
  prompt_text: string;
  normalized_text: string;
  source_mode: "full_page" | "crop_or_text";
  bbox: BoundingBox | null;
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
};

type ActiveQuestionPart = {
  page_number: number;
  page_numbers: Set<number>;
  question_number: string;
  question_part_number: string | null;
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

const PARSER_VERSION = "generic-v0.1";

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
    subquestionRe: /^(\d{1,2})\s*\(((?:[a-z]|[ivx]{2,4}))\)/i,
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
    section_code: active.section_code,
    section_name: active.section_name,
    paper_code: active.paper_code,
    paper_name: active.paper_name,
    context_text: contextOnly,
    marks: extractMarks(rawCombinedText, active.question_part_number, config),
    command_word: extractCommandWord(combinedText),
    prompt_text: combinedText,
    normalized_text: cleanedNormalizedText(combinedText),
    source_mode: mode,
    bbox,
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

function isFiller(text: string, config: BoardConfig) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return config.fillerPatterns.some((pattern) => pattern.test(trimmed));
}

function isContextLine(text: string, config: BoardConfig) {
  return config.contextTerminators.some((pattern) => pattern.test(text.trim()));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const inputDirIndex = args.indexOf("--input-dir");
  const outputDirIndex = args.indexOf("--output-dir");
  const boardIndex = args.indexOf("--board");
  return {
    inputDir: inputDirIndex >= 0 ? resolve(process.cwd(), args[inputDirIndex + 1]) : resolve(process.cwd(), "data/downloads"),
    outputDir: outputDirIndex >= 0 ? resolve(process.cwd(), args[outputDirIndex + 1]) : resolve(process.cwd(), "data/extracted"),
    board: boardIndex >= 0 ? args[boardIndex + 1] : null,
  };
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
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

function extractSubquestion(text: string, line: TextLine, currentQuestionNumber: string | null, config: BoardConfig) {
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
  pageText: string,
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
  if (subjectSlug === "english-literature" && !canRelaxEnglishLiteratureTopGuard(boardCode, sectionCode, pageText) && line.bbox.y0 < 650) return null;

  const candidate = Number(match[1]);
  if (Number.isNaN(candidate)) return null;
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
  pageText: string,
) {
  const normalized = normalizeText(text);
  if (isBookletMarkerLine(normalized)) return null;

  const normalizedQuestionNumber = boardCode === "aqa"
    ? extractAqaStandaloneQuestionNumber(normalized)
    : normalized.match(/^(\d{1,2})$/)?.[1] ?? null;
  if (!normalizedQuestionNumber) return null;
  if (line.bbox.x0 > 90 || line.bbox.y0 < 120) return null;
  if (subjectSlug === "english-literature" && !canRelaxEnglishLiteratureTopGuard(boardCode, sectionCode, pageText) && line.bbox.y0 < 650) return null;

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
  const totalQuestionMatch = normalized.match(/\(total for question \d+ is (\d{1,2}) marks?\)/i);
  const matches = Array.from(normalized.matchAll(config.marksRe));
  if (matches.length === 0) {
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

function isTotalForQuestionLine(text: string, questionNumber: string) {
  const normalized = normalizeText(text);
  return new RegExp(`^\(total for question ${questionNumber} is \d{1,2} marks?\)$`, "i").test(normalized);
}

function isTotalForPaperLine(text: string) {
  return /^total for paper\s*=\s*\d+\s+marks$/i.test(normalizeText(text));
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

function canRelaxEnglishLiteratureTopGuard(boardCode: string, sectionCode: string | null, pageText: string) {
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

async function extractPaper(pdfPath: string, outputDir: string, config: BoardConfig, boardCode: string, subjectSlug: string): Promise<ExtractedPaper> {
  const sourceBytes = readFileSync(pdfPath);
  const pdf = await getDocument({
    data: new Uint8Array(sourceBytes),
    useWorkerFetch: false,
    standardFontDataUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`,
  }).promise;

  const paperCode = config.inferPaperCode(basename(pdfPath));
  const paperName = config.inferPaperName(paperCode);
  const pages: ExtractedPage[] = [];
  const questionParts: ExtractedQuestionPart[] = [];
  const assets: ExtractedAsset[] = [];
  const questionIdCounts = new Map<string, number>();
  let currentSectionCode: string | null = null;
  let currentSectionName: string | null = null;
  let currentQuestionNumber: string | null = null;
  let active: ActiveQuestionPart | null = null;

  let pendingContext: string[] = [];
  let pendingContextLines: TextLine[] = [];

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

    if (config.shouldSkipPage(pageNumber, pageText)) {
      continue;
    }

    const startActiveQuestion = (questionNumber: string, questionPartNumber: string | null, promptLine: TextLine, contextTexts: string[], choiceMeta?: { groupId: string; groupType: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; optionLabel: string | null; sharedStem: string | null }) => {
      active = {
        page_number: pageNumber,
        page_numbers: new Set([pageNumber]),
        question_number: questionNumber,
        question_part_number: questionPartNumber,
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
      };
    };

    let pendingChoiceQuestion = false;
    let pendingChoiceMeta: { type: "either_or" | "text_choice" | "cluster_choice" | "question_choice"; sharedStem: string | null } | null = null;

    for (const line of textLines) {
      const rawText = line.text;
      const detectionText = rawText.replace(/^DO NOT WRITE IN THIS AREA\s*/i, "").trim() || rawText;

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
            questionParts.push(finalizeQuestionPart(activePart, config, questionIdCounts));
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
          questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
          active = null;
        }

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
        pageText,
      );
      if (standaloneQuestionNumber) {
        if (active) {
          questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
          active = null;
        }

        currentQuestionNumber = standaloneQuestionNumber;
        pendingContext = [];
        pendingContextLines = [];
        startActiveQuestion(currentQuestionNumber, null, line, []);
        continue;
      }

      if (isBookletMarkerLine(detectionText) || isFiller(detectionText, config)) {
        continue;
      }

      const topLevelQuestion = extractTopLevelQuestion(detectionText, line, currentQuestionNumber, config);
      if (topLevelQuestion) {
        if (active) {
          questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
          active = null;
        }
        currentQuestionNumber = topLevelQuestion;
        pendingContext = [];
        pendingContextLines = [];
        if (!isQuestionHeadingOnly(detectionText, config)) {
          startActiveQuestion(currentQuestionNumber, null, line, []);
        }
        continue;
      }

      const subquestion = extractSubquestion(detectionText, line, currentQuestionNumber, config);
      if (subquestion) {
        const activePart = active as ActiveQuestionPart | null;
        if (activePart !== null && activePart.question_part_number === null && activePart.question_number === subquestion.questionNumber) {
          const stemText = cleanText([...activePart.contextTexts, ...activePart.promptLines.map((promptLine: TextLine) => promptLine.text)].join(" "));
          startActiveQuestion(
            subquestion.questionNumber,
            subquestion.partNumber,
            line,
            stemText ? [stemText] : [],
          );
        } else {
          if (activePart !== null) {
            questionParts.push(finalizeQuestionPart(activePart, config, questionIdCounts));
          }

          currentQuestionNumber = subquestion.questionNumber;

          const contextTexts = pendingContext.length > 0 ? pendingContext : [];

          startActiveQuestion(currentQuestionNumber, subquestion.partNumber, line, contextTexts);
        }

        pendingContext = [];
        pendingContextLines = [];
        continue;
      }

      const continuationSubquestion = currentQuestionNumber ? extractContinuationSubquestion(detectionText) : null;
      if (continuationSubquestion && currentQuestionNumber) {
        const activePart = active as ActiveQuestionPart | null;
        if (activePart !== null && activePart.question_part_number === null && activePart.question_number === currentQuestionNumber) {
          const stemText = cleanText([...activePart.contextTexts, ...activePart.promptLines.map((promptLine) => promptLine.text)].join(" "));
          startActiveQuestion(
            currentQuestionNumber,
            continuationSubquestion,
            line,
            stemText ? [stemText] : [],
          );
        } else {
          if (active) {
            questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
          }

          startActiveQuestion(currentQuestionNumber, continuationSubquestion, line, []);
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
        pageText,
      );
      if (topLevelQuestionStart) {
        if (active) {
          questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
        }

        currentQuestionNumber = topLevelQuestionStart;

        startActiveQuestion(currentQuestionNumber, null, line, []);

        pendingContext = [];
        pendingContextLines = [];
        continue;
      }

      if (active) {
        const activePart = active as ActiveQuestionPart;

        if (isTotalForQuestionLine(rawText, activePart.question_number)) {
          activePart.promptLines.push(line);
          activePart.page_numbers.add(pageNumber);
          activePart.assetIds.add(pageAssetId);
          questionParts.push(finalizeQuestionPart(activePart, config, questionIdCounts));
          active = null;
          pendingContext = [];
          pendingContextLines = [];
          continue;
        }

        if (isTotalForPaperLine(rawText)) {
          questionParts.push(finalizeQuestionPart(activePart, config, questionIdCounts));
          active = null;
          pendingContext = [];
          pendingContextLines = [];
          continue;
        }

        const hasMarksAlready = activePart.promptLines.some((item) => hasMarks(item.text, config));

        if (hasMarksAlready && !config.isMCOption(rawText) && !config.isAnswerSlot(rawText)) {
          if (isContextLine(rawText, config)) {
            questionParts.push(finalizeQuestionPart(activePart, config, questionIdCounts));
            active = null;
            pendingContext = [rawText];
            pendingContextLines = [line];
            continue;
          }
        }

        activePart.promptLines.push(line);
        activePart.page_numbers.add(pageNumber);
        activePart.assetIds.add(pageAssetId);
      } else {
        pendingContext.push(rawText);
        pendingContextLines.push(line);
      }
    }
  }

  if (active) {
    questionParts.push(finalizeQuestionPart(active, config, questionIdCounts));
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
  };
}

async function processDirectory(inputDir: string, outputDir: string, forcedBoard: string | null) {
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

  for (const pdfPath of pdfFiles) {
    const boardCode = forcedBoard ?? inferBoard(pdfPath);
    const subjectSlug = inferSubjectFromPath(pdfPath);
    const config = BOARD_CONFIGS[boardCode];

    if (!config) {
      console.warn(`Unknown board for ${pdfPath}, skipping`);
      continue;
    }

    const paperDirName = basename(pdfPath).replace(/\.pdf$/i, "");
    const paperOutputDir = resolve(outputDir, boardCode, subjectSlug, paperDirName);

    console.log(`Extracting [${boardCode}/${subjectSlug}] ${basename(pdfPath)}`);
    try {
      const extracted = await extractPaper(pdfPath, paperOutputDir, config, boardCode, subjectSlug);
      writeFileSync(resolve(paperOutputDir, "paper.json"), JSON.stringify(extracted, null, 2));
      console.log(`  wrote ${resolve(paperOutputDir, "paper.json")} (${extracted.question_parts.length} parts)`);
    } catch (error) {
      console.warn(`  Failed to extract ${basename(pdfPath)}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run papers:extract -- [--input-dir <path>] [--output-dir <path>] [--board <aqa|edexcel|ocr>]");
    console.log("Environment:");
    console.log("  --input-dir   Directory to scan for PDFs (default: data/downloads)");
    console.log("  --output-dir  Directory for extracted output (default: data/extracted)");
    console.log("  --board       Force board detection (aqa, edexcel, ocr)");
    return;
  }

  const { inputDir, outputDir, board } = parseArgs();
  await processDirectory(inputDir, outputDir, board);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
