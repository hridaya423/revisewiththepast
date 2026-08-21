import { PDFDocument, PDFName, rgb, type PDFPage } from "pdf-lib";

import { GENERATED_PAGE } from "../../domain/generated-layout";

const BOTTOM_MARGIN = 48;
const MIN_TURN_OVER_BLANK_HEIGHT = 72;
const GENERATED_PAGE_ROLE = PDFName.of("GCSEMetaRole");

export type GeneratedPageRole = "question-content" | "answer-space";

export function setGeneratedPageRole(page: PDFPage, role: GeneratedPageRole) {
  page.node.set(GENERATED_PAGE_ROLE, PDFName.of(role));
}

export function getGeneratedPageRole(page: PDFPage): GeneratedPageRole | null {
  const value = page.node.get(GENERATED_PAGE_ROLE);
  if (!(value instanceof PDFName)) return null;
  const role = value.decodeText();
  return role === "question-content" || role === "answer-space" ? role : null;
}

export function drawTurnOverForNextQuestion(page: PDFPage, blankTop: number) {
  if (blankTop - BOTTOM_MARGIN < MIN_TURN_OVER_BLANK_HEIGHT) return;
  const { width } = page.getSize();
  const text = "TURN OVER FOR NEXT QUESTION";
  const size = 8;
  page.drawText(text, {
    x: width / 2 - text.length * size * 0.29,
    y: 24,
    size,
    color: rgb(0.25, 0.25, 0.25),
  });
}

export function drawGeneratedAnswerSpacePage(outputDoc: PDFDocument, questionNumber: number, marks: number, existingPage?: PDFPage) {
  const page = existingPage ?? outputDoc.addPage([GENERATED_PAGE.width, GENERATED_PAGE.height]);
  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.72, 0.72, 0.72);

  page.drawText(`Answer space for Question ${questionNumber} (${marks} marks)`, { x: 50, y: 784, size: 12, color: black });
  for (let y = 742; y >= 72; y -= 28) {
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.6, color: grey });
  }
}

export function addGeneratedContentPages(outputDoc: PDFDocument, count: number): PDFPage[] {
  return Array.from({ length: count }, () => {
    const page = outputDoc.addPage([GENERATED_PAGE.width, GENERATED_PAGE.height]);
    setGeneratedPageRole(page, "question-content");
    return page;
  });
}
