import type { BoundingBox } from "@/shared/domain/paper";

import { readExtractedPaperJson } from "../extracted-store";

export type ExtractedTextLine = {
  text: string;
  y: number;
  bbox: BoundingBox;
};

export type ExtractedPaperPage = {
  page_number: number;
  page_text: string;
  text_lines: ExtractedTextLine[];
};

export type ExtractedPaper = {
  source_file: string;
  pages: ExtractedPaperPage[];
};

export const LINE_IGNORE_PATTERNS = [
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
  /^extra space$/i,
  /^end of sources$/i,
  /^section [a-z]\b.{0,40}$/i,
  /^if you change your mind about an answer/i,
  /^mark your new answer with a cross/i,
  /^some questions must be answered with a cross/i,
  /^do not write outside the/i,
  /^do not write in this area/i,
  /^write the question numbers in the left-hand margin\.?$/i,
  /^copyright information$/i,
  /^do not write in this area$/i,
  /^shaded area$/i,
  /^do not write outside the box$/i,
  /^\(?\s*total for question/i,
  /^total for section/i,
  /^total for paper/i,
  /^pmt$/i,
];

const extractedPaperCache = new Map<string, ExtractedPaper | null>();

export function loadExtractedPaper(sourceRelativePath: string) {
  if (extractedPaperCache.has(sourceRelativePath)) {
    return extractedPaperCache.get(sourceRelativePath) ?? null;
  }

  const parsed = readExtractedPaperJson<ExtractedPaper>(sourceRelativePath);
  extractedPaperCache.set(sourceRelativePath, parsed);
  return parsed;
}

export function getExtractedPage(sourceRelativePath: string, pageNumber: number) {
  const paper = loadExtractedPaper(sourceRelativePath);
  return paper?.pages.find((page) => page.page_number === pageNumber) ?? null;
}

export function isSourceFooterFurnitureLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return /\bquestion \d+ continues on the next page\b/.test(normalized)
    || /^turn over(?: for the next question)?/.test(normalized)
    || /\bturn over(?: for the next question)?\b/.test(normalized)
    || /^ib\/[gmn]\//.test(normalized)
    || /^g\/jun\d+\//.test(normalized)
    || /^jun\d+\//.test(normalized)
    || /^\*?[a-z]\d{5,}[a-z]?\*?$/i.test(normalized)
    || /^p\d{8,}[a-z0-9]*$/.test(compact);
}

export function isAnswerLine(text: string) {
  return /^[.\s]+$/.test(text.trim()) || /^[._\-\s]+$/.test(text.trim());
}

export function shouldIgnorePageLine(text: string) {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^[_\s]+$/.test(normalized)) return true;
  if (/^[.\s]+$/.test(normalized)) return true;
  return LINE_IGNORE_PATTERNS.some((pattern) => pattern.test(normalized));
}
