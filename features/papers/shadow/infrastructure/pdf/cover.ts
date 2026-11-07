import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

import type { ShadowArtifactKind, ShadowSourceIdentity } from "../../contracts/shadow-paper";
import { shadowMarkerText } from "../../domain/marker";
import type { ShadowFonts } from "./fonts";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 48;
const RIGHT = PAGE_WIDTH - 48;
const CONTENT_WIDTH = RIGHT - LEFT;

const NAVY = rgb(0.055, 0.11, 0.24);
const BLUE = rgb(0.278, 0.278, 0.847);
const MINT = rgb(0.451, 0.91, 0.765);
const RULE = rgb(0.1, 0.15, 0.3);
const MUTED = rgb(0.32, 0.36, 0.45);
const WHITE = rgb(1, 1, 1);

export type ShadowCoverModel = {
  source: ShadowSourceIdentity;
  displayCode: string;
  questionCount: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function sittingLabel(source: ShadowSourceIdentity) {
  const session = source.session === "june" ? "June" : "November";
  return `${session} ${source.year} ${source.paperTitle}`;
}

function sittingDateLabel(source: ShadowSourceIdentity) {
  const [year, month, day] = source.sittingDate.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function identityLine(source: ShadowSourceIdentity) {
  const tier = source.tier === "higher" ? "Higher" : "Foundation";
  return `${source.boardLabel} GCSE ${source.subjectLabel} ${source.specCode}/${source.componentCode} · ${tier} tier`;
}

function wrap(font: PDFFont, value: string, size: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function drawParagraph(page: PDFPage, font: PDFFont, value: string, x: number, y: number, size: number, width: number, color = NAVY, gap = size * 1.32) {
  const lines = wrap(font, value, size, width);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * gap, size, font, color }));
  return y - lines.length * gap;
}

function drawList(page: PDFPage, font: PDFFont, values: string[], x: number, y: number, width: number) {
  let cursor = y;
  for (const value of values) {
    page.drawText("•", { x, y: cursor, size: 9, font, color: NAVY });
    cursor = drawParagraph(page, font, value, x + 12, cursor, 9, width - 12, NAVY, 11.5) - 5;
  }
  return cursor;
}

function drawBrandMark(page: PDFPage, x: number, y: number) {
  page.drawSvgPath("M 1 5 L 17 1 L 22 27 L 6 31 Z", { x, y, color: NAVY });
  page.drawSvgPath("M 6 7 L 23 4 L 27 30 L 10 33 Z", { x, y, color: BLUE });
  page.drawSvgPath("M 11 19 L 15 23 L 23 12 L 25 14 L 15 27 L 9 21 Z", { x, y, color: WHITE });
}

function drawMasthead(page: PDFPage, fonts: ShadowFonts, kind: ShadowArtifactKind, displayCode: string) {
  page.drawRectangle({ x: 24, y: 821, width: PAGE_WIDTH - 56, height: 5, color: BLUE });
  page.drawRectangle({ x: PAGE_WIDTH - 32, y: 821, width: 8, height: 5, color: MINT });
  drawBrandMark(page, LEFT, 795);
  page.drawText("Revise with the Past", { x: LEFT + 34, y: 780, size: 18, font: fonts.sansBold, color: NAVY });
  const kindText = kind === "paper" ? "SHADOW PAPER" : "SHADOW MARK SCHEME";
  const codeWidth = fonts.sansBold.widthOfTextAtSize(displayCode, 9);
  const kindWidth = fonts.sans.widthOfTextAtSize(kindText, 8.2);
  page.drawText(kindText, { x: RIGHT - kindWidth, y: 773, size: 8.2, font: fonts.sans, color: NAVY });
  page.drawText(displayCode, { x: RIGHT - codeWidth, y: 786, size: 9, font: fonts.sansBold, color: NAVY });
  page.drawLine({ start: { x: LEFT, y: 748 }, end: { x: RIGHT, y: 748 }, thickness: 1, color: RULE });
}

function drawFacts(page: PDFPage, fonts: ShadowFonts, facts: Array<[string, string]>, top: number) {
  page.drawLine({ start: { x: LEFT, y: top }, end: { x: RIGHT, y: top }, thickness: 1, color: RULE });
  page.drawLine({ start: { x: LEFT, y: top - 58 }, end: { x: RIGHT, y: top - 58 }, thickness: 1, color: RULE });
  const width = CONTENT_WIDTH / facts.length;
  facts.forEach(([value, label], index) => {
    const centre = LEFT + width * index + width / 2;
    page.drawText(value, { x: centre - fonts.sansBold.widthOfTextAtSize(value, 22) / 2, y: top - 30, size: 22, font: fonts.sansBold, color: BLUE });
    page.drawText(label, { x: centre - fonts.sansBold.widthOfTextAtSize(label, 8.5) / 2, y: top - 46, size: 8.5, font: fonts.sansBold, color: NAVY });
    if (index < facts.length - 1) page.drawLine({ start: { x: LEFT + width * (index + 1), y: top - 52 }, end: { x: LEFT + width * (index + 1), y: top - 6 }, thickness: 0.8, color: RULE });
  });
}

function drawField(page: PDFPage, fonts: ShadowFonts, label: string, y: number, boxes = 0) {
  page.drawText(label, { x: LEFT, y, size: 10.5, font: fonts.sans, color: NAVY });
  if (boxes > 0) {
    for (let index = 0; index < boxes; index += 1) page.drawRectangle({ x: 170 + index * 25, y: y - 5, width: 20, height: 20, borderColor: RULE, borderWidth: 0.8 });
    return;
  }
  page.drawLine({ start: { x: 170, y: y - 3 }, end: { x: RIGHT, y: y - 3 }, thickness: 0.8, color: RULE });
}

function drawCodePanel(page: PDFPage, fonts: ShadowFonts, y: number, kind: ShadowArtifactKind, displayCode: string) {
  const height = 54;
  page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_WIDTH, height, color: rgb(0.95, 0.96, 0.99), borderColor: BLUE, borderWidth: 0.8 });
  page.drawText("VARIANT", { x: LEFT + 16, y: y - 20, size: 8, font: fonts.sansBold, color: MUTED });
  page.drawText(displayCode, { x: LEFT + 16, y: y - 40, size: 17, font: fonts.sansBold, color: NAVY });
  const note = kind === "paper"
    ? "Mark this paper only with the mark scheme that shows the same variant code. The original mark scheme does not apply."
    : "Use this scheme only for the shadow paper that shows the same variant code. The original mark scheme does not apply.";
  drawParagraph(page, fonts.sans, note, LEFT + 168, y - 21, 8.5, CONTENT_WIDTH - 184, NAVY, 11);
}

function drawFootnote(page: PDFPage, fonts: ShadowFonts, source: ShadowSourceIdentity) {
  page.drawLine({ start: { x: LEFT, y: 86 }, end: { x: RIGHT, y: 86 }, thickness: 2.4, color: BLUE });
  const disclaimer = `Independent practice material. Not produced or endorsed by ${source.boardLabel}. Every question follows the structure of the ${sittingLabel(source)} paper with new values.`;
  drawParagraph(page, fonts.sans, disclaimer, LEFT, 70, 7.5, CONTENT_WIDTH, MUTED, 10);
}

export function drawShadowPaperCover(doc: PDFDocument, fonts: ShadowFonts, model: ShadowCoverModel) {
  const { source } = model;
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawMasthead(page, fonts, "paper", model.displayCode);
  page.drawText(identityLine(source).toUpperCase(), { x: LEFT, y: 716, size: 11, font: fonts.sansBold, color: BLUE });
  page.drawText("Shadow paper", { x: LEFT, y: 676, size: 32, font: fonts.sansBold, color: NAVY });
  drawParagraph(page, fonts.sans, `Based on ${sittingLabel(source)}, first sat ${sittingDateLabel(source)}. Same questions and marks, new numbers.`, LEFT, 650, 10.5, CONTENT_WIDTH, MUTED);

  drawFacts(page, fonts, [
    [String(source.durationMinutes), "MINUTES"],
    [String(source.totalMarks), "MARKS"],
    [String(model.questionCount), model.questionCount === 1 ? "QUESTION" : "QUESTIONS"],
  ], 625);

  drawField(page, fonts, "Name", 536);
  drawField(page, fonts, "School", 503);
  drawField(page, fonts, "Candidate number", 470, 6);

  const columnTop = 425;
  const gap = 28;
  const columnWidth = (CONTENT_WIDTH - gap) / 2;
  page.drawLine({ start: { x: LEFT + columnWidth + gap / 2, y: 421 }, end: { x: LEFT + columnWidth + gap / 2, y: 248 }, thickness: 0.8, color: RULE });
  page.drawText("Instructions", { x: LEFT, y: columnTop, size: 14, font: fonts.sansBold, color: NAVY });
  drawList(page, fonts.sans, [
    "Use black ink or ball-point pen.",
    "Answer all questions in the spaces provided.",
    "You must show all your working.",
    "Diagrams are not accurately drawn, unless otherwise indicated.",
    source.calculator === "not-allowed" ? "Calculators must not be used." : "Calculators may be used.",
  ], LEFT, columnTop - 21, columnWidth);

  const informationX = LEFT + columnWidth + gap;
  page.drawText("Information", { x: informationX, y: columnTop, size: 14, font: fonts.sansBold, color: NAVY });
  drawList(page, fonts.sans, [
    `The total mark for this paper is ${source.totalMarks}.`,
    "The marks for each question are shown in brackets.",
    ...(source.equipment ? [`You may use: ${source.equipment.replace(/\.\s*$/u, "")}.`] : []),
  ], informationX, columnTop - 21, columnWidth);

  drawCodePanel(page, fonts, 228, "paper", model.displayCode);
  drawFootnote(page, fonts, source);
  const turn = "DO NOT TURN OVER UNTIL YOU ARE READY";
  page.drawText(turn, { x: LEFT + (CONTENT_WIDTH - fonts.sansBold.widthOfTextAtSize(turn, 8.5)) / 2, y: 100, size: 8.5, font: fonts.sansBold, color: NAVY });
  return page;
}

const MARK_TYPES: Array<[string, string]> = [
  ["M", "method marks for a correct method or partial method"],
  ["P", "process marks for a correct process as part of a problem-solving question"],
  ["A", "accuracy marks, awarded only after the method or process mark they depend on"],
  ["B", "unconditional accuracy marks, independent of method"],
  ["C", "communication marks for a complete, correct argument or proof"],
];

const ABBREVIATIONS: Array<[string, string]> = [
  ["cao", "correct answer only"],
  ["oe", "or equivalent"],
  ["ft", "follow through from an earlier answer"],
  ["dep", "dependent on the previous mark"],
  ["SC", "special case"],
];

export function drawShadowSchemeCover(doc: PDFDocument, fonts: ShadowFonts, model: ShadowCoverModel) {
  const { source } = model;
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawMasthead(page, fonts, "mark-scheme", model.displayCode);
  page.drawText(identityLine(source).toUpperCase(), { x: LEFT, y: 716, size: 11, font: fonts.sansBold, color: BLUE });
  page.drawText("Mark scheme", { x: LEFT, y: 676, size: 32, font: fonts.sansBold, color: NAVY });
  drawParagraph(page, fonts.sans, `Worked answers and marking guidance for this shadow of ${sittingLabel(source)}.`, LEFT, 650, 10.5, CONTENT_WIDTH, MUTED);
  drawFacts(page, fonts, [
    [String(source.totalMarks), "MARKS"],
    [String(model.questionCount), model.questionCount === 1 ? "QUESTION" : "QUESTIONS"],
  ], 625);

  drawCodePanel(page, fonts, 540, "mark-scheme", model.displayCode);

  let y = 452;
  page.drawText("General guidance", { x: LEFT, y, size: 14, font: fonts.sansBold, color: NAVY });
  y = drawList(page, fonts.sans, [
    "Mark every candidate in the same way, and award all marks a correct response earns.",
    "Award marks for a correct method that leads to a correct answer, even if it is not shown here.",
    "If no method is shown, award full marks only for a correct answer from a part that does not ask for working.",
    "Each worked solution is one valid route. Accept any equivalent correct working.",
  ], LEFT, y - 21, CONTENT_WIDTH) - 10;

  const columnWidth = (CONTENT_WIDTH - 28) / 2;
  const rows = (entries: Array<[string, string]>, x: number, top: number, heading: string) => {
    page.drawText(heading, { x, y: top, size: 11, font: fonts.sansBold, color: NAVY });
    let cursor = top - 18;
    for (const [code, text] of entries) {
      page.drawText(code, { x, y: cursor, size: 9, font: fonts.sansBold, color: BLUE });
      cursor = drawParagraph(page, fonts.sans, text, x + 30, cursor, 9, columnWidth - 30, NAVY, 11.5) - 4;
    }
  };
  rows(MARK_TYPES, LEFT, y, "Types of mark");
  rows(ABBREVIATIONS, LEFT + columnWidth + 28, y, "Abbreviations");

  drawFootnote(page, fonts, source);
  return page;
}

/** Stamps the variant marker and source identity on every non-cover page. */
export function stampShadowPage(page: PDFPage, fonts: ShadowFonts, input: { kind: ShadowArtifactKind; displayCode: string; source: ShadowSourceIdentity }) {
  const { width, height } = page.getSize();
  const y = height - 26;
  const left = `${identityLine(input.source)} · shadow of ${sittingLabel(input.source)}`;
  page.drawText(left, { x: 40, y, size: 7, font: fonts.sans, color: MUTED });
  const marker = shadowMarkerText(input.kind, input.displayCode);
  const markerWidth = fonts.sansBold.widthOfTextAtSize(marker, 7.5);
  page.drawText(marker, { x: width - 40 - markerWidth, y, size: 7.5, font: fonts.sansBold, color: NAVY });
  page.drawLine({ start: { x: 40, y: y - 6 }, end: { x: width - 40, y: y - 6 }, thickness: 0.4, color: MUTED });
}
