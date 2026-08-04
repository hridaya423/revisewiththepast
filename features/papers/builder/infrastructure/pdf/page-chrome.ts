import { PDFDocument, rgb, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const BOTTOM_MARGIN = 48;
const MIN_TURN_OVER_BLANK_HEIGHT = 72;

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

export function drawGeneratedAnswerSpacePage(outputDoc: PDFDocument, questionNumber: number, marks: number) {
  const page = outputDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.72, 0.72, 0.72);

  page.drawText(`Answer space for Question ${questionNumber} (${marks} marks)`, { x: 50, y: 784, size: 12, color: black });
  for (let y = 742; y >= 72; y -= 28) {
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.6, color: grey });
  }
}
