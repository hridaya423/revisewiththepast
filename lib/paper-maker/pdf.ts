import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { renderPdfToPngBuffers } from "@/lib/marking/pdfjs-server";
import { compareQuestionUnitsForRendering, type BoundingBox, type QuestionUnit, type SourcePageAsset } from "@/lib/paper-maker/aqa-geography";
import {
  buildUnitRenderPlan,
  isUnitRegionRenderable,
  type RegionFigure,
  type RegionCrop,
  type RegionPageLayout,
} from "@/lib/paper-maker/region-render";

type GeneratePaperPdfInput = {
  title: string;
  selectedUnits: QuestionUnit[];
  allUnits: QuestionUnit[];
  pageAssetsBySource: Map<string, SourcePageAsset[]>;
  prefaceSourcePdfs?: string[];
  figuresBySource?: Map<string, RegionFigure[]>;
  pageLayoutsBySource?: Map<string, RegionPageLayout[]>;
  regionMode?: boolean;
  coverPage: {
    boardLabel: string;
    subjectLabel: string;
    codeLabel: string;
    totalMarks: number;
    timeMinutes: number;
    paperLabels: string[];
    tierLabel?: string | null;
    questionCount?: number;
    materials?: string[];
    instructions?: string[];
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
type RenderedSnippet = PreparedSnippet & { sourcePageNumber: number };

type ShortPageItem = {
  pageWidth: number;
  pageHeight: number;
  snippets: RenderedSnippet[];
  scale: number;
  scaledHeight: number;
  questionNumber: number;
  maskSourceFurniture: boolean;
  sourceUnit: QuestionUnit;
  drawExternalQuestionNumber: boolean;
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
const SOURCE_OUTPUT_PAGE_WIDTH = 595.28;
const SOURCE_OUTPUT_PAGE_HEIGHT = 841.89;
const GENERATED_NUMBER_FONT_SIZE = 13;

const SUPPORT_CONTEXT_PATTERN = /\bfigure\b|\bstudy\b|\bmap\b|\bdiagram\b|\bgraph\b|\bphoto\b|\bresource\b|\bapparatus\b|\btable\b|\bchart\b|\bmodel\b|\bspectrum\b|\bresults\b/i;

const PAGE_SKIP_PATTERNS = [
  /there are no questions printed on this page/i,
  /do not write on this page answer in the spaces provided/i,
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

const FULL_PAGE_ANSWER_EXTENSION_BY_MARKS = [
  { maxMarks: 1, padding: 70 },
  { maxMarks: 2, padding: 105 },
  { maxMarks: 3, padding: 140 },
  { maxMarks: 6, padding: 210 },
  { maxMarks: 9, padding: 280 },
];

const extractedPaperCache = new Map<string, ExtractedPaper | null>();

function formatExamTime(timeMinutes: number) {
  const hours = Math.floor(timeMinutes / 60);
  const minutes = timeMinutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minutes`;
}

function roundedRectPath(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `Q ${width} 0 ${width} ${r}`,
    `V ${height - r}`,
    `Q ${width} ${height} ${width - r} ${height}`,
    `H ${r}`,
    `Q 0 ${height} 0 ${height - r}`,
    `V ${r}`,
    `Q 0 0 ${r} 0`,
    "Z",
  ].join(" ");
}

async function drawExamCoverPage(
  outputDoc: PDFDocument,
  coverPage: GeneratePaperPdfInput["coverPage"],
) {
  const page = outputDoc.addPage([SOURCE_OUTPUT_PAGE_WIDTH, SOURCE_OUTPUT_PAGE_HEIGHT]);
  const helv = await outputDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await outputDoc.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await outputDoc.embedFont(StandardFonts.HelveticaOblique);

  const ink = rgb(0.12, 0.13, 0.16);
  const subtle = rgb(0.44, 0.46, 0.5);
  const hairline = rgb(0.66, 0.68, 0.72);
  const cellBorder = rgb(0.2, 0.21, 0.24);
  const panelFill = rgb(0.93, 0.945, 0.96);
  const accent = rgb(0.0, 0.46, 0.42);
  const white = rgb(1, 1, 1);

  const PAGE_W = SOURCE_OUTPUT_PAGE_WIDTH;
  const LEFT = 50;
  const RIGHT = PAGE_W - 50;
  const CONTENT_W = RIGHT - LEFT;

  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    opts: { font?: PDFFont; color?: ReturnType<typeof rgb> } = {},
  ) => {
    page.drawText(value, { x, y, size, font: opts.font ?? helv, color: opts.color ?? ink });
  };

  const badgeX = LEFT;
  const badgeBottom = 762;
  const badgeSize = 38;
  const markTop = badgeBottom + badgeSize;
  const sheet = (dx: number, dy: number) => {
    page.drawSvgPath(roundedRectPath(26, 32, 3), {
      x: badgeX + 2 + dx,
      y: markTop - dy,
      color: white,
      borderColor: ink,
      borderWidth: 1.4,
    });
  };
  sheet(10, 0);
  sheet(5, 4);
  sheet(0, 8);
  for (let i = 0; i < 3; i += 1) {
    const ly = markTop - 8 - 12 - i * 5;
    page.drawLine({ start: { x: badgeX + 7, y: ly }, end: { x: badgeX + 23, y: ly }, thickness: 1, color: accent });
  }
  const brandX = badgeX + badgeSize + 14;
  text("Revise with the Past", brandX, badgeBottom + 22, 18, { font: helvBold });
  text("Exam-style practice built from real past papers", brandX, badgeBottom + 7, 9.5, { color: subtle });

  const chipW = 116;
  const chipH = 22;
  const chipX = RIGHT - chipW;
  const chipBottom = badgeBottom + 14;
  page.drawSvgPath(roundedRectPath(chipW, chipH, 11), {
    x: chipX,
    y: chipBottom + chipH,
    borderColor: ink,
    borderWidth: 1,
  });
  const chipLabel = "PRACTICE PAPER";
  const chipLabelW = helvBold.widthOfTextAtSize(chipLabel, 9);
  text(chipLabel, chipX + (chipW - chipLabelW) / 2, chipBottom + 7, 9, { font: helvBold });

  const boxTop = 742;
  const boxBottom = 590;
  const boxH = boxTop - boxBottom;
  page.drawSvgPath(roundedRectPath(CONTENT_W, boxH, 12), {
    x: LEFT,
    y: boxTop,
    borderColor: cellBorder,
    borderWidth: 1.1,
  });

  text("Please write clearly in block capitals.", LEFT + 16, boxTop - 22, 10.5);

  const drawCharCells = (startX: number, topY: number, count: number, cell = 20) => {
    for (let i = 0; i < count; i += 1) {
      page.drawRectangle({
        x: startX + i * cell,
        y: topY - cell,
        width: cell,
        height: cell,
        borderColor: cellBorder,
        borderWidth: 1,
      });
    }
  };

  const cellsTop = boxTop - 36;
  text("Centre number", LEFT + 16, cellsTop - 15, 10.5);
  drawCharCells(LEFT + 110, cellsTop, 6);
  text("Candidate number", LEFT + 270, cellsTop - 15, 10.5);
  drawCharCells(LEFT + 388, cellsTop, 4);

  const fieldRows: Array<[string, number]> = [
    ["Surname", boxTop - 84],
    ["Forename(s)", boxTop - 108],
    ["Candidate signature", boxTop - 132],
  ];
  for (const [label, y] of fieldRows) {
    text(label, LEFT + 16, y, 10.5);
    page.drawLine({ start: { x: LEFT + 130, y: y - 2 }, end: { x: RIGHT - 14, y: y - 2 }, thickness: 0.8, color: hairline });
  }
  text("I declare this is my own work.", LEFT + 130, boxTop - 146, 9, { color: subtle });

  text("GCSE", LEFT, 566, 21, { font: helv });
  text(coverPage.subjectLabel.toUpperCase(), LEFT, 532, 30, { font: helvBold });
  const paperDescriptor = [
    coverPage.tierLabel ? `${coverPage.tierLabel} Tier` : null,
    `Paper reference ${coverPage.codeLabel}`,
  ].filter(Boolean).join("    ·    ");
  text(paperDescriptor, LEFT, 514, 12, { color: ink });

  page.drawRectangle({ x: LEFT, y: 502, width: CONTENT_W, height: 2.4, color: ink });

  text("Practice paper", LEFT, 482, 13.5, { font: helvBold });
  const timeLabel = `Time allowed: ${formatExamTime(coverPage.timeMinutes)}`;
  const timeLabelW = helvBold.widthOfTextAtSize(timeLabel, 13.5);
  text(timeLabel, RIGHT - timeLabelW, 482, 13.5, { font: helvBold });

  const tableRight = RIGHT;
  const tableW = 168;
  const tableLeft = tableRight - tableW;
  const colSplit = tableLeft + tableW * 0.56;
  const tableTop = 458;
  const questionCount = Math.max(1, Math.min(coverPage.questionCount ?? 5, 18));
  const headerH = 20;
  const subHeaderH = 18;
  const totalRowH = 20;
  const bottomLimit = 250;
  const availForRows = tableTop - headerH - subHeaderH - totalRowH - bottomLimit;
  const rowH = Math.max(12, Math.min(21, availForRows / questionCount));
  const bodyH = subHeaderH + questionCount * rowH + totalRowH;
  const tableBottom = tableTop - headerH - bodyH;

  page.drawRectangle({ x: tableLeft, y: tableTop - headerH, width: tableW, height: headerH, color: panelFill, borderColor: cellBorder, borderWidth: 1 });
  const exHeader = "For Examiner's Use";
  const exHeaderW = helv.widthOfTextAtSize(exHeader, 10);
  text(exHeader, tableLeft + (tableW - exHeaderW) / 2, tableTop - headerH + 6, 10);

  page.drawRectangle({ x: tableLeft, y: tableBottom, width: tableW, height: bodyH, borderColor: cellBorder, borderWidth: 1 });
  page.drawLine({ start: { x: colSplit, y: tableBottom }, end: { x: colSplit, y: tableTop - headerH }, thickness: 1, color: cellBorder });

  const subTop = tableTop - headerH;
  page.drawLine({ start: { x: tableLeft, y: subTop - subHeaderH }, end: { x: tableRight, y: subTop - subHeaderH }, thickness: 1, color: cellBorder });
  const qLabel = "Question";
  const mLabel = "Mark";
  text(qLabel, tableLeft + (colSplit - tableLeft - helv.widthOfTextAtSize(qLabel, 9.5)) / 2, subTop - subHeaderH + 5, 9.5);
  text(mLabel, colSplit + (tableRight - colSplit - helv.widthOfTextAtSize(mLabel, 9.5)) / 2, subTop - subHeaderH + 5, 9.5);

  let rowY = subTop - subHeaderH;
  for (let q = 1; q <= questionCount; q += 1) {
    rowY -= rowH;
    page.drawLine({ start: { x: tableLeft, y: rowY }, end: { x: tableRight, y: rowY }, thickness: 0.7, color: hairline });
    const qStr = String(q);
    const numSize = Math.min(10, rowH - 4);
    text(qStr, tableLeft + (colSplit - tableLeft - helv.widthOfTextAtSize(qStr, numSize)) / 2, rowY + (rowH - numSize) / 2 + 1, numSize);
  }
  rowY -= totalRowH;
  page.drawRectangle({ x: tableLeft, y: rowY, width: tableW, height: totalRowH, color: panelFill });
  page.drawLine({ start: { x: colSplit, y: rowY }, end: { x: colSplit, y: rowY + totalRowH }, thickness: 1, color: cellBorder });
  page.drawRectangle({ x: tableLeft, y: rowY, width: tableW, height: totalRowH, borderColor: cellBorder, borderWidth: 1 });
  const totLabel = "TOTAL";
  text(totLabel, tableLeft + (colSplit - tableLeft - helvBold.widthOfTextAtSize(totLabel, 10)) / 2, rowY + 6, 10, { font: helvBold });

  const colLeftRight = tableLeft - 22;
  const bullet = (
    lines: string[],
    startY: number,
    x = LEFT,
    rightEdge = colLeftRight,
    size = 10,
    gap = 14,
  ) => {
    let y = startY;
    for (const line of lines) {
      const isBullet = line.startsWith("•");
      const indentX = isBullet ? x + 12 : x;
      const body = isBullet ? line.slice(1).trim() : line;
      if (isBullet) text("•", x, y, size);
      const maxW = rightEdge - indentX;
      const words = body.split(" ");
      let current = "";
      for (const word of words) {
        const trial = current ? `${current} ${word}` : word;
        if (helv.widthOfTextAtSize(trial, size) > maxW && current) {
          text(current, indentX, y, size);
          y -= gap;
          current = word;
        } else {
          current = trial;
        }
      }
      if (current) {
        text(current, indentX, y, size);
        y -= gap;
      }
    }
    return y;
  };

  const materialsLines = coverPage.materials ?? [
    "For this paper you must have:",
    "• a black ink or black ball-point pen",
    "• a pencil, a rubber and a ruler.",
    "You may use a calculator.",
  ];
  const instructionLines = coverPage.instructions ?? [
    "• Fill in the boxes at the top of this page.",
    "• Answer all questions in the spaces provided.",
    "• Do all rough work in this booklet.",
    "• If you need extra space, use additional paper and clearly label your answers.",
  ];

  let leftY = 462;
  text("Materials", LEFT, leftY, 12, { font: helvBold });
  leftY -= 16;
  leftY = bullet(materialsLines, leftY);

  leftY -= 8;
  text("Instructions", LEFT, leftY, 12, { font: helvBold });
  leftY -= 16;
  leftY = bullet(instructionLines, leftY);

  let infoY = Math.min(leftY, tableBottom) - 14;
  text("Information", LEFT, infoY, 12, { font: helvBold });
  infoY -= 16;
  const sourceList = coverPage.paperLabels.length > 0 ? coverPage.paperLabels.join(", ") : "real past-paper pages";
  infoY = bullet([
    "• The marks for each question are shown in brackets.",
    `• The total number of marks available for this paper is ${coverPage.totalMarks}.`,
    `• This booklet was assembled from real past-paper questions covering: ${sourceList}.`,
  ], infoY, LEFT, RIGHT);

  infoY -= 8;
  text("Advice", LEFT, infoY, 12, { font: helvBold });
  infoY -= 16;
  bullet([
    "• Read each question carefully before you start to answer it.",
    "• Keep an eye on the time and try to leave enough for checking.",
    "• Cross through any work you do not want to be marked.",
  ], infoY, LEFT, RIGHT);

  const footerRuleY = 92;
  page.drawLine({ start: { x: LEFT, y: footerRuleY }, end: { x: RIGHT, y: footerRuleY }, thickness: 0.8, color: hairline });

  const codeSeed = `${coverPage.boardLabel}${coverPage.codeLabel}` || "RWTP";
  const barAreaWidth = 264;
  const barBottom = 50;
  const barHeight = 26;
  let barX = LEFT;
  let barStep = 0;
  while (barX < LEFT + barAreaWidth) {
    const cc = (codeSeed.charCodeAt(barStep % codeSeed.length) * 31 + barStep * 17) >>> 0;
    const barW = 1 + (cc % 3) * 0.8;
    page.drawRectangle({ x: barX, y: barBottom, width: barW, height: barHeight, color: ink });
    const gapW = 1 + ((cc >> 2) % 3) * 0.8;
    barX += barW + gapW;
    barStep += 1;
  }
  text("Revise with the Past · Practice paper", LEFT, barBottom - 12, 8, { font: helvOblique, color: subtle });

  const codeLabel = `${coverPage.boardLabel} ${coverPage.codeLabel}`.trim();
  const codeSize = 24;
  const codeW = helvBold.widthOfTextAtSize(codeLabel, codeSize);
  text(codeLabel, RIGHT - codeW, barBottom + 2, codeSize, { font: helvBold });
}

function drawGeneratedAnswerSpacePage(outputDoc: PDFDocument, questionNumber: number, marks: number) {
  const page = outputDoc.addPage([SOURCE_OUTPUT_PAGE_WIDTH, SOURCE_OUTPUT_PAGE_HEIGHT]);
  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.72, 0.72, 0.72);

  page.drawText(`Answer space for Question ${questionNumber} (${marks} marks)`, { x: 50, y: 784, size: 12, color: black });
  for (let y = 742; y >= 72; y -= 28) {
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.6, color: grey });
  }
}

function getSourceQuestionNumberBox(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) return null;

  const sourceNumber = unit.questionNumber.trim().replace(/^0+/, "") || unit.questionNumber.trim();
  if (!sourceNumber) return null;
  const escaped = sourceNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsWithNumber = new RegExp(`^\\s*(?:0\\s*)?${escaped}\\b`);
  const standaloneNumber = new RegExp(`^\\s*(?:0\\s*)?${escaped}\\s*\\.?\\s*$`);
  const visibleLines = extractedPage.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top + 2
    && line.bbox.y0 >= cropBox.bottom - 2
  ));
  const promptLine = findPromptLine(extractedPage, unit.parts[0]?.promptText ?? "");
  const promptTop = promptLine?.bbox.y1 ?? null;

  const inlineLine = visibleLines
    .filter((line) => {
      const trimmed = line.text.trim();
      if (!startsWithNumber.test(trimmed)) return false;
      if (!isMathematicsUnit(unit)) return true;
      const remainder = trimmed.replace(startsWithNumber, "").trim();
      return /^(?:\([a-z]\)|[A-Za-z])/.test(remainder);
    })
    .filter((line) => line.bbox.x0 <= cropBox.left + 180)
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;

  if (inlineLine) {
    const height = Math.max(10, inlineLine.bbox.y1 - inlineLine.bbox.y0);
    const sourceMarker = inlineLine.text.match(/^\s*[\d\s.]+/)?.[0] ?? "";
    const isAqaCompoundMarker = unit.boardCode === "aqa" && /\d\s*\.\s*\d/.test(sourceMarker);
    const width = isAqaCompoundMarker ? 58 : Math.max(12, sourceMarker.replace(/\s+/g, "").length * 7 + 3);
    return {
      left: inlineLine.bbox.x0 - 3,
      right: inlineLine.bbox.x0 + width,
      bottom: inlineLine.bbox.y0 - (isAqaCompoundMarker ? 6 : 2),
      top: inlineLine.bbox.y0 + height + (isAqaCompoundMarker ? 7 : 3),
    } satisfies CropBox;
  }

  const standaloneLine = visibleLines
    .filter((line) => standaloneNumber.test(line.text.trim()))
    .filter((line) => line.bbox.x0 <= cropBox.left + 180)
    .filter((line) => line.bbox.y0 > cropBox.bottom + 80)
    .filter((line) => !promptLine || (line.bbox.y1 >= promptLine.bbox.y0 - 28 && line.bbox.y0 <= promptLine.bbox.y1 + 70))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;

  if (!standaloneLine) return null;
  return {
    left: standaloneLine.bbox.x0 - 3,
    right: standaloneLine.bbox.x1 + 10,
    bottom: standaloneLine.bbox.y0 - 3,
    top: standaloneLine.bbox.y1 + 3,
  } satisfies CropBox;
}

function getAqaCompoundMarkerLine(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  if (unit.boardCode !== "aqa") return null;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) return null;
  const sourceQuestion = (unit.parts[0]?.questionNumber ?? unit.questionNumber).replace(/^0+/, "");
  const sourcePart = (unit.parts[0]?.questionPartNumber ?? "").replace(/^0+/, "");
  return extractedPage.text_lines
    .filter((line) => line.bbox.y1 <= cropBox.top + 2 && line.bbox.y0 >= cropBox.bottom - 2)
    .filter((line) => {
      const match = line.text.trim().match(/^((?:\d\s*)+)\.\s*((?:\d\s*)+)/);
      if (!match) return false;
      const question = match[1].replace(/\s+/g, "").replace(/^0+/, "") || "0";
      const part = match[2].replace(/\s+/g, "").replace(/^0+/, "") || "0";
      return question === sourceQuestion && (!sourcePart || part === sourcePart);
    })
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;
}

function getAqaCompoundMarkerMaskRight(unit: QuestionUnit, pageNumber: number, cropBox: CropBox, markerLine: ExtractedTextLine, fallbackRight: number) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) return fallbackRight;

  const continuationLine = extractedPage.text_lines
    .filter((line) => line.bbox.y1 <= markerLine.bbox.y0 + 2 && line.bbox.y0 >= markerLine.bbox.y0 - 60)
    .filter((line) => line.bbox.y1 <= cropBox.top + 2 && line.bbox.y0 >= cropBox.bottom - 2)
    .filter((line) => line.bbox.x0 > markerLine.bbox.x0 + 50 && line.bbox.x0 < fallbackRight + 18)
    .filter((line) => !/^\[/.test(line.text.trim()))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;

  return continuationLine ? Math.min(fallbackRight, continuationLine.bbox.x0 - 4) : fallbackRight;
}

function isAqaSourceFurnitureLine(text: string, line: ExtractedTextLine, cropBox: CropBox) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (/^question \d+\b/.test(normalized)) return true;
  if (/^section [a-z]\b/.test(normalized)) return true;
  if (/^answer (?:all|two|question|either)\b/.test(normalized)) return true;
  if (/^end of question \d+\b/.test(normalized)) return true;
  if (/^turn over/.test(normalized)) return true;
  if (/^\(?\d{2}\)?$/.test(normalized)) return true;
  if (/^\*\d{2}\*$/.test(normalized)) return true;
  if (/^(?:ib\/g|g\/jun|jun\d+)/.test(normalized)) return true;
  if (/^question \d+ continues on the next page/.test(normalized)) return true;
  return /^\d+$/.test(normalized) && line.bbox.x0 <= cropBox.left + 22;
}

function drawAqaSourceFurnitureLineMasks(
  page: import("pdf-lib").PDFPage,
  unit: QuestionUnit,
  sourcePageNumber: number,
  sourceCropBox: CropBox,
  drawX: number,
  drawY: number,
  scaleX: number,
  scaleY: number,
) {
  const extractedPage = getExtractedPage(unit.sourceRelativePath, sourcePageNumber);
  if (!extractedPage) return;
  for (const line of extractedPage.text_lines) {
    if (line.bbox.y1 > sourceCropBox.top + 2 || line.bbox.y0 < sourceCropBox.bottom - 2) continue;
    if (!isAqaSourceFurnitureLine(line.text, line, sourceCropBox)) continue;
    const x = drawX + (Math.max(sourceCropBox.left, line.bbox.x0 - 4) - sourceCropBox.left) * scaleX;
    const y = drawY + (line.bbox.y0 - 4 - sourceCropBox.bottom) * scaleY;
    const width = (Math.min(sourceCropBox.right, Math.max(line.bbox.x1 + 10, line.bbox.x0 + 90)) - Math.max(sourceCropBox.left, line.bbox.x0 - 4)) * scaleX;
    const height = (line.bbox.y1 - line.bbox.y0 + 8) * scaleY;
    if (width > 0 && height > 0) page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
  }
}

function isEdexcelMathsSourceFurnitureLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return /^answer all questions\.?$/.test(normalized)
    || /^write your answers in the spaces provided\.?$/.test(normalized)
    || /^you must write down all the stages in your working\.?$/.test(normalized);
}

function drawEdexcelMathsSourceFurnitureLineMasks(
  page: import("pdf-lib").PDFPage,
  unit: QuestionUnit,
  sourcePageNumber: number,
  sourceCropBox: CropBox,
  drawX: number,
  drawY: number,
  scaleX: number,
  scaleY: number,
) {
  if (unit.boardCode !== "edexcel" || !isMathematicsUnit(unit)) return;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, sourcePageNumber);
  if (!extractedPage) return;
  for (const line of extractedPage.text_lines) {
    if (line.bbox.y1 > sourceCropBox.top + 2 || line.bbox.y0 < sourceCropBox.bottom - 2) continue;
    if (!isEdexcelMathsSourceFurnitureLine(line.text)) continue;
    const left = Math.max(sourceCropBox.left, line.bbox.x0 - 8);
    const right = Math.min(sourceCropBox.right, line.bbox.x1 + 8);
    const x = drawX + (left - sourceCropBox.left) * scaleX;
    const y = drawY + (line.bbox.y0 - 4 - sourceCropBox.bottom) * scaleY;
    const width = (right - left) * scaleX;
    const height = (line.bbox.y1 - line.bbox.y0 + 8) * scaleY;
    if (width > 0 && height > 0) page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
  }
}

function drawQuestionNumberReplacement(
  page: import("pdf-lib").PDFPage,
  unit: QuestionUnit,
  sourcePageNumber: number,
  sourceCropBox: CropBox,
  questionNumber: number,
  drawX: number,
  drawY: number,
  drawWidth: number,
  drawHeight: number,
) {
  if (unit.boardCode === "aqa") {
    const scaleX = drawWidth / Math.max(1, sourceCropBox.right - sourceCropBox.left);
    const scaleY = drawHeight / Math.max(1, sourceCropBox.top - sourceCropBox.bottom);
    let drew = false;
    const toOutput = (box: CropBox) => ({
      x: drawX + (box.left - sourceCropBox.left) * scaleX,
      y: drawY + (box.bottom - sourceCropBox.bottom) * scaleY,
      width: (box.right - box.left) * scaleX,
      height: (box.top - box.bottom) * scaleY,
    });

    drawAqaSourceFurnitureLineMasks(page, unit, sourcePageNumber, sourceCropBox, drawX, drawY, scaleX, scaleY);

    const markerLine = getAqaCompoundMarkerLine(unit, sourcePageNumber, sourceCropBox);
    if (markerLine) {
      const markerText = markerLine.text.trim().match(/^0?\s*\d+\s*\.\s*\d+(?:\s+\d+)?/)?.[0] ?? "";
      const markerDigitCount = markerText.match(/\d/g)?.length ?? 0;
      const markerWidth = markerDigitCount >= 4 ? 82 : 56;
      const markerRight = getAqaCompoundMarkerMaskRight(unit, sourcePageNumber, sourceCropBox, markerLine, markerLine.bbox.x0 + markerWidth);
      const markerBox = toOutput({
        left: markerLine.bbox.x0 - 6,
        right: markerRight,
        bottom: markerLine.bbox.y0 - 7,
        top: markerLine.bbox.y1 + 7,
      });
      page.drawRectangle({ ...markerBox, color: rgb(1, 1, 1) });
      page.drawText(`${questionNumber}.`, {
        x: markerBox.x + 10 * scaleX,
        y: markerBox.y + Math.max(1, (markerBox.height - GENERATED_NUMBER_FONT_SIZE * scaleY) / 2),
        size: GENERATED_NUMBER_FONT_SIZE * Math.min(scaleX, scaleY),
        color: rgb(0.1, 0.1, 0.1),
      });
      drew = true;
    }
    return drew;
  }

  const scaleX = drawWidth / Math.max(1, sourceCropBox.right - sourceCropBox.left);
  const scaleY = drawHeight / Math.max(1, sourceCropBox.top - sourceCropBox.bottom);
  const toOutput = (box: CropBox) => ({
    x: drawX + (box.left - sourceCropBox.left) * scaleX,
    y: drawY + (box.bottom - sourceCropBox.bottom) * scaleY,
    width: (box.right - box.left) * scaleX,
    height: (box.top - box.bottom) * scaleY,
  });
  let drew = false;

  drawEdexcelMathsSourceFurnitureLineMasks(page, unit, sourcePageNumber, sourceCropBox, drawX, drawY, scaleX, scaleY);

  if (unit.boardCode === "edexcel") {
    const sourceNumber = unit.questionNumber.trim().replace(/^0+/, "") || unit.questionNumber.trim();
    const escaped = sourceNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const totalPattern = new RegExp(`total for question\\s+${escaped}\\s+is`, "i");
    const extractedPage = getExtractedPage(unit.sourceRelativePath, sourcePageNumber);
    const totalLines = extractedPage?.text_lines.filter((line) => (
      line.bbox.y1 <= sourceCropBox.top + 2
      && line.bbox.y0 >= sourceCropBox.bottom - 2
      && totalPattern.test(line.text)
    )) ?? [];
    for (const line of totalLines) {
      const totalBox = toOutput({
        left: line.bbox.x0 - 2,
        right: line.bbox.x1 + 2,
        bottom: line.bbox.y0 - 2,
        top: line.bbox.y1 + 2,
      });
      page.drawRectangle({ ...totalBox, color: rgb(1, 1, 1) });
      page.drawText(line.text.replace(/Question\s+\d+/i, `Question ${questionNumber}`), {
        x: totalBox.x + 1,
        y: totalBox.y + Math.max(1, (totalBox.height - GENERATED_NUMBER_FONT_SIZE * scaleY) / 2),
        size: GENERATED_NUMBER_FONT_SIZE * Math.min(scaleX, scaleY),
        color: rgb(0.1, 0.1, 0.1),
      });
      drew = true;
    }
  }

  const numberBox = getSourceQuestionNumberBox(unit, sourcePageNumber, sourceCropBox);
  if (!numberBox) return drew;

  const x = drawX + (numberBox.left - sourceCropBox.left) * scaleX;
  const y = drawY + (numberBox.bottom - sourceCropBox.bottom) * scaleY;
  const width = (numberBox.right - numberBox.left) * scaleX;
  const height = (numberBox.top - numberBox.bottom) * scaleY;

  page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
  page.drawText(`${questionNumber}.`, {
    x: x + (unit.boardCode === "aqa" ? 8 : 2) * scaleX,
    y: y + Math.max(1, (height - GENERATED_NUMBER_FONT_SIZE * scaleY) / 2),
    size: GENERATED_NUMBER_FONT_SIZE * Math.min(scaleX, scaleY),
    color: rgb(0.1, 0.1, 0.1),
  });
  return true;
}

function drawSourceFurnitureMask(page: import("pdf-lib").PDFPage, unit: QuestionUnit, x: number, y: number, width: number, height: number) {
  if (unit.boardCode === "aqa") {
    page.drawRectangle({ x: x + width, y, width: 30, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: x + Math.max(0, width - 54), y, width: Math.min(20, width), height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: x + Math.max(0, width - 34), y, width: Math.min(34, width), height, color: rgb(1, 1, 1) });
    return;
  }
  if (unit.boardCode === "edexcel") {
    if (isMathematicsUnit(unit)) {
      page.drawRectangle({ x, y, width: Math.min(52, width), height, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: x + Math.max(0, width - 52), y, width: Math.min(52, width), height, color: rgb(1, 1, 1) });
      page.drawRectangle({ x, y, width, height: Math.min(76, height), color: rgb(1, 1, 1) });
      return;
    }
    page.drawRectangle({ x, y, width: Math.min(62, width), height, color: rgb(1, 1, 1) });
    if (unit.subjectSlug === "business") {
      page.drawRectangle({ x: x + Math.max(0, width - 8), y, width: Math.min(8, width), height, color: rgb(1, 1, 1) });
    } else {
      page.drawRectangle({ x: x + Math.max(0, width - 36), y, width: Math.min(36, width), height, color: rgb(1, 1, 1) });
    }
    page.drawRectangle({ x, y, width, height: Math.min(78, height), color: rgb(1, 1, 1) });
    return;
  }
  if (unit.boardCode === "edexcel" || unit.boardCode === "ocr") {
    page.drawRectangle({ x: x + Math.max(0, width - 64), y: y + Math.max(0, height - 34), width: Math.min(64, width), height: Math.min(34, height), color: rgb(1, 1, 1) });
  }
}

function shouldMaskSourceFurniture(unit: QuestionUnit) {
  return unit.boardCode === "aqa" || unit.boardCode === "edexcel";
}

function trimSourceFurnitureCropBox(unit: QuestionUnit, cropBox: CropBox, pageWidth: number) {
  if (unit.boardCode === "aqa") {
    const right = Math.min(cropBox.right, pageWidth - 8);
    return right - cropBox.left >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, right } : cropBox;
  }
  if (unit.boardCode !== "edexcel" && unit.boardCode !== "ocr") return cropBox;
  const left = cropBox.left;
  const right = Math.min(cropBox.right, pageWidth);
  return right - left >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, left, right } : cropBox;
}

function isSourceFooterFurnitureLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return /^question \d+ continues on the next page/.test(normalized)
    || /^turn over(?: for the next question)?/.test(normalized)
    || /^\*?\d{2}\*?$/.test(normalized)
    || /^ib\/[gmn]\//.test(normalized)
    || /^g\/jun\d+\//.test(normalized)
    || /^jun\d+\//.test(normalized)
    || /^\*?[a-z]\d{5,}[a-z]?\*?$/i.test(normalized);
}

function trimSourceFooterCropBox(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  if (unit.boardCode === "aqa") return cropBox;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!extractedPage) return cropBox;

  const footerLines = extractedPage.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top
    && line.bbox.y0 >= cropBox.bottom
    && line.bbox.y1 < cropBox.bottom + (cropBox.top - cropBox.bottom) * 0.35
    && isSourceFooterFurnitureLine(line.text)
  ));
  if (footerLines.length === 0) return cropBox;

  const bottom = Math.max(cropBox.bottom, Math.max(...footerLines.map((line) => line.bbox.y1)) + 12);
  return cropBox.top - bottom >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, bottom } : cropBox;
}

function trimAqaSupportFooterCropBox(unit: QuestionUnit, crop: RegionCrop, cropBox: CropBox) {
  if (unit.boardCode !== "aqa") return cropBox;
  const bottom = Math.max(cropBox.bottom, 70);
  return cropBox.top - bottom >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, bottom } : cropBox;
}

function trimEnglishLiteratureOptionBleedCropBox(unit: QuestionUnit, crop: RegionCrop, cropBox: CropBox) {
  if (!isEnglishLiteratureUnit(unit) || crop.kind !== "question") return cropBox;
  const page = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  if (!page) return cropBox;

  const optionBreak = page.text_lines
    .filter((line) => line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom)
    .filter((line) => /^or$/i.test(line.text.trim()))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;
  if (!optionBreak) return cropBox;

  const bottom = Math.max(cropBox.bottom, optionBreak.bbox.y1 + 8);
  return cropBox.top - bottom >= MIN_VISIBLE_CROP_HEIGHT ? { ...cropBox, bottom } : cropBox;
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

function isBoilerplateRegionCrop(unit: QuestionUnit, crop: RegionCrop) {
  const page = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  return Boolean(page && isBoilerplateOnlyPage(page));
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
  const escapedQuestion = part.questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directQuestionLine = relevantLines.find((line) => {
    const trimmed = line.text.trim();
    if (!new RegExp(`^(?:0\\s*)?${escapedQuestion}\\b`, "i").test(trimmed)) return false;
    const remainder = trimmed.replace(new RegExp(`^(?:0\\s*)?${escapedQuestion}\\b`, "i"), "").trim();
    return /[A-Za-z(]/.test(remainder);
  });

  if ((part.contextText || part.sourceMode === "full_page") && directQuestionLine) return directQuestionLine;

  if (part.questionPartNumber) {
    const escaped = part.questionPartNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directPartLine = relevantLines.find((line) => new RegExp(`^\(\s*${escaped}\s*\)`, "i").test(line.text.trim()));
    if (directPartLine) return directPartLine;
  }

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
      : (immediateContextTop ? immediateContextTop + 18 : startLine.bbox.y1 + 20),
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
      : Math.max(startLine.bbox.y1 + 10, highestTextY + 8);

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

function toPdfCropBox(cropBox: CropBox): CropBox {
  return {
    left: cropBox.left,
    right: cropBox.right,
    bottom: cropBox.bottom,
    top: cropBox.top,
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

function isScienceUnit(unit: QuestionUnit) {
  return ["combined-science", "biology", "chemistry", "physics"].includes(unit.subjectSlug);
}

function trimScienceRegionCropBox(unit: QuestionUnit, crop: { pageNumber: number; cropBox: CropBox; kind: string }) {
  if (!isScienceUnit(unit) || (crop.kind !== "stem" && crop.kind !== "figure" && crop.kind !== "question")) return crop.cropBox;
  const extractedPage = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  if (!extractedPage) return crop.cropBox;
  let cropBox = crop.cropBox;

  const footerLines = extractedPage.text_lines
    .filter((line) => line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom)
    .filter((line) => shouldIgnorePageLine(line.text) || /\bturn over\b|\bp\s*\d\s*\d\s*\d\s*\d\b/i.test(line.text));
  if (footerLines.length > 0) {
    const footerTop = Math.max(...footerLines.map((line) => line.bbox.y1)) + 10;
    if (footerTop < cropBox.top - MIN_VISIBLE_CROP_HEIGHT) cropBox = { ...cropBox, bottom: Math.max(cropBox.bottom, footerTop) };
  }

  if (crop.kind === "question") {
    const totalLine = extractedPage.text_lines
      .filter((line) => line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom)
      .filter((line) => /^\(?\s*total for question\b/i.test(line.text.trim()))
      .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;
    if (!totalLine) return cropBox;
    const bottom = Math.min(cropBox.top - MIN_VISIBLE_CROP_HEIGHT, totalLine.bbox.y1 + 8);
    return bottom > cropBox.bottom ? { ...cropBox, bottom } : cropBox;
  }

  const questionNumberPattern = new RegExp(`^\\s*${unit.questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const questionStartLine = extractedPage.text_lines
    .filter((line) => line.bbox.y1 <= cropBox.top && line.bbox.y0 >= cropBox.bottom)
    .filter((line) => questionNumberPattern.test(line.text.trim()))
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] ?? null;
  if (!questionStartLine) return cropBox;
  if (cropBox.top - questionStartLine.bbox.y1 < 80) return cropBox;

  return {
    ...cropBox,
    top: Math.min(cropBox.top, questionStartLine.bbox.y1 + 24),
  };
}

function isBusinessUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "business";
}

function shouldSkipBusinessRegionCrop(unit: QuestionUnit, crop: RegionCrop) {
  if (!isBusinessUnit(unit)) return false;

  const page = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  if (!page) return false;

  const visibleLines = page.text_lines.filter((line) => (
    line.bbox.y1 <= crop.cropBox.top + 2
    && line.bbox.y0 >= crop.cropBox.bottom - 2
    && line.text.trim().length > 0
  ));
  if (visibleLines.length === 0) return false;

  return visibleLines.every((line) => /^total for section\b/i.test(line.text.trim()));
}

function getVisibleMeaningfulLines(sourceRelativePath: string, pageNumber: number, cropBox: CropBox) {
  const page = getExtractedPage(sourceRelativePath, pageNumber);
  if (!page) return null;

  return page.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top + 2
    && line.bbox.y0 >= cropBox.bottom - 2
    && !shouldIgnorePageLine(line.text)
  ));
}

function getVisibleRawLines(sourceRelativePath: string, pageNumber: number, cropBox: CropBox) {
  const page = getExtractedPage(sourceRelativePath, pageNumber);
  if (!page) return null;

  return page.text_lines.filter((line) => (
    line.bbox.y1 <= cropBox.top + 2
    && line.bbox.y0 >= cropBox.bottom - 2
    && line.text.trim().length > 0
  ));
}

function isSourceFurnitureOnlyLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (shouldIgnorePageLine(text)) return true;
  if (/^\(?\s*total for (?:question|section|paper)\b/.test(normalized)) return true;
  if (/^turn over/.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^[p0-9a-z\s]{8,}$/.test(normalized) && /\d/.test(normalized)) return true;
  return false;
}

function isSourceFurnitureOnlyPage(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  const rawLines = getVisibleRawLines(unit.sourceRelativePath, pageNumber, cropBox);
  return Boolean(rawLines && (rawLines.length === 0 || rawLines.every((line) => isSourceFurnitureOnlyLine(line.text))));
}

function isBusinessFillerSourcePage(unit: QuestionUnit, pageNumber: number) {
  if (!isBusinessUnit(unit)) return false;
  const page = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!page) return false;
  const normalized = page.page_text
    .toLowerCase()
    .replace(/\.{3,}/g, " ")
    .replace(/\(?\s*total for (?:question|section|paper)[^\n]*/g, " ")
    .replace(/turn over[^\n]*/g, " ")
    .replace(/\b[p0-9a-z]\s+(?:[p0-9a-z]\s*){6,}/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\bp\s*a\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length === 0;
}

function isAnswerContinuationOnlyLine(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (/^[.\s_\-]+(?:\[?\d+\]?|\(?\d+\)?)?$/.test(normalized)) return true;
  if (/^\[?\d+\]?\s*$/.test(normalized)) return true;
  if (/^total for question\b/.test(normalized)) return true;
  if (/^question \d+ continues/.test(normalized)) return true;
  if (/^additional (?:answer )?space/.test(normalized)) return true;
  if (/^extra space for question\b/.test(normalized)) return true;
  if (/^extra space$/.test(normalized)) return true;
  if (/^end of section\b/.test(normalized)) return true;
  return false;
}

function isAnswerOnlyContinuationCrop(unit: QuestionUnit, crop: RegionCrop) {
  if (crop.kind !== "question") return false;
  const firstQuestionPage = Math.min(...unit.parts.flatMap((part) => part.regionSpans ?? []).map((span) => span.pageNumber));
  if (Number.isFinite(firstQuestionPage) && crop.pageNumber <= firstQuestionPage) return false;

  const meaningfulLines = getVisibleMeaningfulLines(unit.sourceRelativePath, crop.pageNumber, crop.cropBox);
  if (!meaningfulLines) return false;
  return meaningfulLines.length === 0 || meaningfulLines.every((line) => isAnswerContinuationOnlyLine(line.text));
}

function isGenericAdditionalAnswerPageCrop(unit: QuestionUnit, crop: RegionCrop) {
  const rawLines = getVisibleRawLines(unit.sourceRelativePath, crop.pageNumber, crop.cropBox);
  if (!rawLines) return false;
  const text = rawLines.map((line) => line.text).join(" ").toLowerCase().replace(/\s+/g, " ");
  return /additional page, if required/.test(text)
    || /write the question numbers in the left-hand margin/.test(text)
    || /extra answer space/.test(text);
}

function isGenericAdditionalAnswerPage(unit: QuestionUnit, pageNumber: number) {
  const page = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!page) return false;
  const text = page.page_text.toLowerCase().replace(/\s+/g, " ");
  if (/additional page, if required/.test(text)
    || /write the question numbers in the left-hand margin/.test(text)
    || /extra answer space/.test(text)) {
    return true;
  }
  if (unit.boardCode !== "ocr") return false;
  const meaningfulLines = page.text_lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .filter((line) => !/^ocr is (?:an exempt charity|committed)\b/i.test(line))
    .filter((line) => !/^copyright information$/i.test(line))
    .filter((line) => !/^©\s*ocr/i.test(line))
    .filter((line) => !/^h\d+/i.test(line))
    .filter((line) => !/^\(?\d+\)?$/.test(line))
    .filter((line) => !/^\[\d+\]$/.test(line));
  return meaningfulLines.length === 0 || meaningfulLines.every((line) => /^[._\-\s]+$/.test(line) || isAnswerContinuationOnlyLine(line));
}

function shouldSkipRegionAnswerContinuation(unit: QuestionUnit, crop: RegionCrop) {
  if (isGenericAdditionalAnswerPageCrop(unit, crop)) return true;
  if (isEnglishLanguageUnit(unit) && isAnswerOnlyContinuationCrop(unit, crop)) return true;
  if (isAnswerOnlyContinuationCrop(unit, crop) && crop.cropBox.top - crop.cropBox.bottom < 260) return true;
  return unit.totalMarks <= 3 && isAnswerOnlyContinuationCrop(unit, crop);
}

function isEnglishLiteratureOtherOptionPage(unit: QuestionUnit, crop: RegionCrop) {
  if (!isEnglishLiteratureUnit(unit)) return false;
  const firstPageNumber = unit.pages[0]?.pageNumber ?? crop.pageNumber;
  if (crop.pageNumber <= firstPageNumber) return false;
  const page = getExtractedPage(unit.sourceRelativePath, crop.pageNumber);
  const questionNumber = unit.parts[0]?.questionNumber;
  if (!page || !questionNumber) return false;
  const hasSelectedQuestion = new RegExp(`\\b0\\s*${questionNumber}\\b`).test(page.page_text);
  return !hasSelectedQuestion && /^or$/im.test(page.page_text);
}

function isEmptyQuestionCrop(unit: QuestionUnit, pageNumber: number, cropBox: CropBox) {
  const meaningfulLines = getVisibleMeaningfulLines(unit.sourceRelativePath, pageNumber, cropBox);
  if (!meaningfulLines) return false;
  return meaningfulLines.length === 0 || meaningfulLines.every((line) => isAnswerContinuationOnlyLine(line.text));
}

function isAnswerOnlyContinuationPage(unit: QuestionUnit, pageNumber: number) {
  const firstPageNumber = unit.pages[0]?.pageNumber ?? pageNumber;
  if (pageNumber <= firstPageNumber) return false;

  const page = getExtractedPage(unit.sourceRelativePath, pageNumber);
  if (!page) return false;

  const meaningfulLines = page.text_lines.filter((line) => !shouldIgnorePageLine(line.text));
  return meaningfulLines.length === 0 || meaningfulLines.every((line) => isAnswerContinuationOnlyLine(line.text));
}

function isGeographyUnit(unit: QuestionUnit) {
  return unit.boardCode === "aqa" && unit.subjectSlug === "geography";
}

function isMathematicsUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "mathematics";
}

function isEnglishLanguageUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "english-language";
}

function isEnglishLiteratureUnit(unit: QuestionUnit) {
  return unit.subjectSlug === "english-literature";
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
  const prependedSupportPages = new Set<number>();

  if (isEnglishLanguageUnit(unit)) {
    const questionNumbers = new Set(unit.parts.map((part) => part.questionNumber));
    if (questionNumbers.size <= 1) {
      return actualFirstPageNumber ? [actualFirstPageNumber] : (firstPageNumber ? [firstPageNumber] : []);
    }
  }

  if (isMathematicsUnit(unit) && actualFirstPageNumber) {
    const mathPageNumbers = Array.from(new Set(unit.parts.flatMap((part) => part.pageNumbers.length > 0 ? part.pageNumbers : [part.pageNumber]))).sort((a, b) => a - b);
    const firstPartPageNumber = Math.min(...unit.parts.map((part) => part.pageNumber));
    const renderablePageNumbers = mathPageNumbers.filter((pageNumber) => {
      if (Number.isFinite(firstPartPageNumber) && pageNumber < firstPartPageNumber) return false;
      const unitPage = unit.pages.find((page) => page.pageNumber === pageNumber);
      if (!unitPage?.bboxUnion) return true;
      if (unitPage.bboxUnion.y1 - unitPage.bboxUnion.y0 < 80) return false;
      const meaningfulLines = getVisibleMeaningfulLines(unit.sourceRelativePath, pageNumber, toCropBox(unitPage.bboxUnion));
      return meaningfulLines === null || meaningfulLines.length > 0;
    });
    const firstRenderablePageNumber = renderablePageNumbers[0] ?? actualFirstPageNumber;
    return renderablePageNumbers.filter((pageNumber) => pageNumber === firstRenderablePageNumber || unit.totalMarks > 5);
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
      prependedSupportPages.add(previousPageNumber);
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
        prependedSupportPages.add(previousPageNumber);
      }
    }
  }

  if (unit.boardCode === "ocr" && firstPageNumber > 1) {
    const firstPage = getExtractedPage(unit.sourceRelativePath, firstPageNumber);
    const sourceNumber = unit.questionNumber.trim().replace(/^0+/, "") || unit.questionNumber.trim();
    const escaped = sourceNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasQuestionStart = firstPage?.text_lines.some((line) => new RegExp(`^\\s*(?:0\\s*)?${escaped}\\b`).test(line.text.trim())) ?? true;
    const previousPageNumber = firstPageNumber - 1;
    if (!hasQuestionStart && !rawPageNumbers.includes(previousPageNumber)) {
      const previousPage = getExtractedPage(unit.sourceRelativePath, previousPageNumber);
      if (previousPage && !isBoilerplateOnlyPage(previousPage) && !isGenericAdditionalAnswerPage(unit, previousPageNumber) && !isAnswerOnlyContinuationPage(unit, previousPageNumber)) {
        rawPageNumbers.unshift(previousPageNumber);
        prependedSupportPages.add(previousPageNumber);
      }
    }
  }

  return rawPageNumbers.filter((pageNumber, index) => {
    const unitPage = unit.pages.find((entry) => entry.pageNumber === pageNumber);
    const isContextPage = unitPage?.parts.some((part) => part.sourceMode === "context_stem") ?? false;
    if (index === 0) return true;
    if (actualFirstPageNumber && pageNumber === actualFirstPageNumber) return true;
    if (prependedSupportPages.has(pageNumber)) return true;
    if (isContextPage) return true;

    const page = getExtractedPage(unit.sourceRelativePath, pageNumber);
    if (page && isBoilerplateOnlyPage(page)) return false;
    if (isGenericAdditionalAnswerPage(unit, pageNumber)) return false;
    if (isAnswerOnlyContinuationPage(unit, pageNumber)) return false;

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

  if (isGeographyUnit(unit) && hasSupportDependency(unit)) {
    return false;
  }

  if (isMathematicsUnit(unit)) {
    return false;
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
  try {
    await embeddedPage.embed();
  } catch (error) {
    const queued = (outputDoc as unknown as { embeddedPages: unknown[] }).embeddedPages;
    const index = queued.indexOf(embeddedPage);
    if (index >= 0) queued.splice(index, 1);
    throw error;
  }
  return {
    embeddedPage,
    width: cropBox.right - cropBox.left,
    height: cropBox.top - cropBox.bottom,
    cropBox,
  };
}

function buildShortPageItem(
  pageWidth: number,
  pageHeight: number,
  snippets: RenderedSnippet[],
  allowDownscale: boolean,
  questionNumber: number,
  maskSourceFurniture: boolean,
  sourceUnit: QuestionUnit,
  drawExternalQuestionNumber = false,
) {
  if (snippets.length === 0) {
    return null;
  }

  const externalNumberGutter = drawExternalQuestionNumber ? 52 : 0;
  const availableWidth = pageWidth - SHORT_PAGE_SIDE_MARGIN * 2 - externalNumberGutter;
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
    questionNumber,
    maskSourceFurniture,
    sourceUnit,
    drawExternalQuestionNumber,
  } satisfies ShortPageItem;
}

function drawShortPageItem(page: import("pdf-lib").PDFPage, item: ShortPageItem, cursorTop: number) {
  let snippetTop = cursorTop;
  let drewQuestionNumber = false;
  for (const snippet of item.snippets) {
    const scaledWidth = snippet.width * item.scale;
    const scaledHeight = snippet.height * item.scale;
    const snippetX = SHORT_PAGE_SIDE_MARGIN + (item.drawExternalQuestionNumber ? 52 : 0);
    page.drawPage(snippet.embeddedPage, {
      x: snippetX,
      y: snippetTop - scaledHeight,
      width: scaledWidth,
      height: scaledHeight,
    });
    if (item.maskSourceFurniture) {
      drawSourceFurnitureMask(page, item.sourceUnit, snippetX, snippetTop - scaledHeight, scaledWidth, scaledHeight);
    }
    if (!drewQuestionNumber || item.sourceUnit.boardCode === "aqa") {
      if (item.drawExternalQuestionNumber) {
        page.drawRectangle({
          x: SHORT_PAGE_SIDE_MARGIN - 6,
          y: snippetTop - 32,
          width: 52,
          height: 38,
          color: rgb(1, 1, 1),
        });
        page.drawText(`${item.questionNumber}.`, {
          x: SHORT_PAGE_SIDE_MARGIN,
          y: snippetTop - 16,
          size: GENERATED_NUMBER_FONT_SIZE,
          color: rgb(0.1, 0.1, 0.1),
        });
        drewQuestionNumber = true;
      } else {
        drewQuestionNumber = drawQuestionNumberReplacement(page, item.sourceUnit, snippet.sourcePageNumber, snippet.cropBox, item.questionNumber, snippetX, snippetTop - scaledHeight, scaledWidth, scaledHeight) || drewQuestionNumber;
      }
    }
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
    ).filter((line) =>
      !isScienceUnit(unit)
      || (hasFigureContext(unit) && SUPPORT_CONTEXT_PATTERN.test(line.text)),
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
  const isContextPage = unit.pages.find((entry) => entry.pageNumber === pageNumber)?.parts.some((part) => part.sourceMode === "context_stem") ?? false;
  if (isContextPage) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }
  if (isMathematicsUnit(unit)) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (isBusinessUnit(unit) || isEnglishLanguageUnit(unit)) {
    const textCrop = resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages, { includeFigureSupport: false });
    if (textCrop && isValidCropBox(textCrop, pageWidth, pageHeight)) {
      return textCrop;
    }
  }

  if (isScienceUnit(unit)) {
    return { left: 0, right: pageWidth, bottom: 0, top: pageHeight };
  }

  if (isFullPageSource) {
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
    if (isScienceUnit(unit)) {
      const textCrop = resolveFullPageTextCropBox(unit, pageNumber, pageWidth, pageHeight, unitStartPages);
      if (textCrop && isValidCropBox(textCrop, pageWidth, pageHeight)) {
        return textCrop;
      }
    }
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
  } catch (error) {
    throw new Error(
      `Failed to load source PDF ${pageAssetUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  sourceDocCache.set(pageAssetUrl, sourceDoc);
  return sourceDoc;
}

function isSkippableInsertFillerPage(text: string) {
  return /\bthere is no source material printed on this page\b/i.test(text.replace(/\s+/g, " "));
}

async function getSkippableInsertPageIndexes(pdfBytes: Uint8Array) {
  try {
    const rendered = await renderPdfToPngBuffers(new Uint8Array(pdfBytes), 0.25);
    const skippablePageIndexes = new Set(
      rendered.textPages
        .filter((page) => isSkippableInsertFillerPage(page.text))
        .map((page) => page.pageNumber - 1),
    );
    if (skippablePageIndexes.size >= rendered.textPages.length) return new Set<number>();
    return skippablePageIndexes;
  } catch {
    return new Set<number>();
  }
}

function drawInsertFurnitureMask(page: import("pdf-lib").PDFPage, width: number, height: number) {
  page.drawRectangle({ x: width - 48, y: height - 24, width: 48, height: 24, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width, height: 42, color: rgb(1, 1, 1) });
}

async function addPdfPagesWithRasterFallback(
  outputDoc: PDFDocument,
  pdfPathOrUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
) {
  const bytes = await fetchPdfBytes(pdfPathOrUrl, sourcePdfCache);
  const skippablePageIndexes = await getSkippableInsertPageIndexes(bytes);

  try {
    const insertDoc = await loadSourcePdfDocument(pdfPathOrUrl, sourcePdfCache, sourceDocCache);
    const pageIndexes = Array.from({ length: insertDoc.getPageCount() }, (_, index) => index)
      .filter((index) => !skippablePageIndexes.has(index));
    if (pageIndexes.length === 0) return false;
    const probeDoc = await PDFDocument.create();
    await probeDoc.copyPages(insertDoc, pageIndexes);
    await probeDoc.save();
    for (const pageIndex of pageIndexes) {
      const sourcePage = insertDoc.getPage(pageIndex);
      const { width, height } = sourcePage.getCropBox();
      const embeddedPage = await outputDoc.embedPage(sourcePage);
      const outputPage = outputDoc.addPage([width, height]);
      outputPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });
      drawInsertFurnitureMask(outputPage, width, height);
    }
    return true;
  } catch {
    const rendered = await renderPdfToPngBuffers(new Uint8Array(bytes), 1);
    for (const page of rendered.pages) {
      if (skippablePageIndexes.has(page.pageNumber - 1)) continue;
      const png = await outputDoc.embedPng(page.png);
      const outputPage = outputDoc.addPage([png.width, png.height]);
      outputPage.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
    }
    return rendered.pages.some((page) => !skippablePageIndexes.has(page.pageNumber - 1));
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

export type SourcePdfRenderabilityGateResult = {
  kept: QuestionUnit[];
  excluded: Array<{ unitKey: string; pageNumber: number; reason: string }>;
};

export async function filterUnitsBySourcePdfRenderability(
  units: QuestionUnit[],
  options: {
    pageAssetsBySource: Map<string, SourcePageAsset[]>;
    figuresBySource?: Map<string, RegionFigure[]>;
    pageLayoutsBySource?: Map<string, RegionPageLayout[]>;
    regionMode?: boolean;
  },
): Promise<SourcePdfRenderabilityGateResult> {
  const sourcePdfCache = new Map<string, Uint8Array>();
  const sourceDocCache = new Map<string, PDFDocument>();
  const layoutMapCache = new Map<string, Map<number, RegionPageLayout>>();
  const getLayoutMap = (sourceRelativePath: string) => {
    let cached = layoutMapCache.get(sourceRelativePath);
    if (!cached) {
      cached = new Map((options.pageLayoutsBySource?.get(sourceRelativePath) ?? []).map((layout) => [layout.pageNumber, layout]));
      layoutMapCache.set(sourceRelativePath, cached);
    }
    return cached;
  };

  const kept: QuestionUnit[] = [];
  const excluded: SourcePdfRenderabilityGateResult["excluded"] = [];

  for (const unit of units) {
    const layoutMap = getLayoutMap(unit.sourceRelativePath);
    const regionPlan = options.regionMode && isUnitRegionRenderable(unit, layoutMap)
      ? buildUnitRenderPlan(unit, layoutMap, options.figuresBySource?.get(unit.sourceRelativePath) ?? [])
      : [];
    const pageNumbers = Array.from(new Set(
      (regionPlan.length > 0 ? regionPlan.map((crop) => crop.pageNumber) : unit.pages.map((page) => page.pageNumber))
        .filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0),
    ));

    let failed: SourcePdfRenderabilityGateResult["excluded"][number] | null = null;
    for (const pageNumber of pageNumbers) {
      try {
        const renderable = await withSourcePdfCandidate(
          unit,
          pageNumber,
          options.pageAssetsBySource,
          sourcePdfCache,
          sourceDocCache,
          async (candidate, _sourceDoc, sourcePdfPage) => {
            const probeDoc = await PDFDocument.create();
            const pageGeometry = getVisiblePageGeometry(sourcePdfPage);
            await prepareSnippet(
              probeDoc,
              candidate.pdfUrl,
              {
                left: pageGeometry.x,
                right: pageGeometry.x + pageGeometry.width,
                bottom: pageGeometry.y,
                top: pageGeometry.y + pageGeometry.height,
              },
              sourcePdfCache,
              sourceDocCache,
              candidate.sourcePageIndex,
            );
            await probeDoc.save();
            return true;
          },
        );
        if (!renderable) {
          failed = { unitKey: unit.unitKey, pageNumber, reason: "No source PDF candidate" };
          break;
        }
      } catch (error) {
        failed = {
          unitKey: unit.unitKey,
          pageNumber,
          reason: error instanceof Error ? error.message : String(error),
        };
        break;
      }
    }

    if (failed) {
      excluded.push(failed);
    } else {
      kept.push(unit);
    }
  }

  return { kept, excluded };
}

const REGION_OUTPUT_PAGE_WIDTH = 595.28;
const REGION_OUTPUT_PAGE_HEIGHT = 841.89;

type RegionRenderFlow = {
  page: import("pdf-lib").PDFPage | null;
  cursorY: number;
};

async function renderRegionUnit(
  unit: QuestionUnit,
  outputDoc: PDFDocument,
  pageAssetsBySource: Map<string, SourcePageAsset[]>,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  layoutByPage: Map<number, RegionPageLayout>,
  figures: RegionFigure[],
  flow: RegionRenderFlow,
  questionNumber: number,
) {
  const plan = buildUnitRenderPlan(unit, layoutByPage, figures)
    .filter((crop) => !isBoilerplateRegionCrop(unit, crop))
    .filter((crop) => !shouldSkipBusinessRegionCrop(unit, crop))
    .filter((crop) => !isEnglishLiteratureOtherOptionPage(unit, crop))
    .filter((crop) => !shouldSkipRegionAnswerContinuation(unit, crop));
  if (plan.length === 0) return false;

  const sideMargin = SHORT_PAGE_SIDE_MARGIN;
  const availableWidth = REGION_OUTPUT_PAGE_WIDTH - sideMargin * 2;
  const availableFullHeight = REGION_OUTPUT_PAGE_HEIGHT - SHORT_PAGE_TOP_MARGIN - SHORT_PAGE_BOTTOM_MARGIN;
  const CENTER_MIN_GAP = 24;
  const drawXFor = (drawWidth: number) =>
    availableWidth - drawWidth > CENTER_MIN_GAP
      ? Math.max(sideMargin, (REGION_OUTPUT_PAGE_WIDTH - drawWidth) / 2)
      : sideMargin;

  type PreparedCrop = {
    embeddedPage: PreparedSnippet["embeddedPage"];
    cropBox: CropBox;
    pageNumber: number;
    kind: typeof plan[number]["kind"];
    width: number;
    height: number;
    startsUnit: boolean;
    maskSourceFurniture: boolean;
  };
  const prepared: PreparedCrop[] = [];
  for (const crop of plan) {
    const item = await withSourcePdfCandidate(
      unit,
      crop.pageNumber,
      pageAssetsBySource,
      sourcePdfCache,
      sourceDocCache,
      async (sourcePage, _sourceDoc, sourcePdfPage): Promise<PreparedCrop | null> => {
        const pageGeometry = getVisiblePageGeometry(sourcePdfPage);
        const adjustedCropBox = trimEnglishLiteratureOptionBleedCropBox(unit, crop, trimSourceFurnitureCropBox(unit, trimAqaSupportFooterCropBox(unit, crop, trimSourceFooterCropBox(unit, crop.pageNumber, trimScienceRegionCropBox(unit, crop))), pageGeometry.width));
        if (crop.kind === "question" && adjustedCropBox.top - adjustedCropBox.bottom < 90) {
          return null;
        }
        if (crop.kind === "question" && unit.totalMarks <= 3 && isEmptyQuestionCrop(unit, crop.pageNumber, adjustedCropBox)) {
          return null;
        }
        if (crop.kind === "question" && isEnglishLanguageUnit(unit) && isEmptyQuestionCrop(unit, crop.pageNumber, adjustedCropBox)) {
          return null;
        }
        const pdfCropBox = toPdfCropBox(adjustedCropBox);
        const cropWidth = adjustedCropBox.right - adjustedCropBox.left;
        const cropHeight = adjustedCropBox.top - adjustedCropBox.bottom;
        if (cropWidth <= 0 || cropHeight <= 0) return null;

        const snippet = await prepareSnippet(
          outputDoc,
          sourcePage.pdfUrl,
          pdfCropBox,
          sourcePdfCache,
          sourceDocCache,
          sourcePage.sourcePageIndex,
        );

        let scale = Math.min(1, availableWidth / cropWidth);
        if (cropHeight * scale > availableFullHeight) scale = Math.min(scale, availableFullHeight / cropHeight);
        return { embeddedPage: snippet.embeddedPage, cropBox: adjustedCropBox, pageNumber: crop.pageNumber, kind: crop.kind, width: cropWidth * scale, height: cropHeight * scale, startsUnit: prepared.length === 0, maskSourceFurniture: shouldMaskSourceFurniture(unit) };
      },
    );
    if (item) prepared.push(item);
  }

  const SHORT_LEAD_HEIGHT = availableFullHeight * 0.35;
  const isShortLead = (crop: PreparedCrop) => crop.kind === "stem" || crop.kind === "figure" || crop.height < SHORT_LEAD_HEIGHT;
  const blocks: PreparedCrop[][] = [];
  for (let index = 0; index < prepared.length; ) {
    const block: PreparedCrop[] = [];
    let accumulated = 0;
    while (
      index < prepared.length
      && isShortLead(prepared[index])
      && (block.length === 0 || accumulated <= availableFullHeight * 0.65)
    ) {
      accumulated += prepared[index].height + SHORT_PAGE_GAP;
      block.push(prepared[index]);
      index += 1;
    }
    while (
      index < prepared.length
      && block.length > 0
      && !block.some((crop) => crop.kind === "question")
    ) {
      block.push(prepared[index]);
      index += 1;
    }
    if (block.length === 0 && index < prepared.length) {
      block.push(prepared[index]);
      index += 1;
    }
    if (block.length > 0) blocks.push(block);
  }

  for (const block of blocks) {
    const gaps = SHORT_PAGE_GAP * (block.length - 1);
    const rawHeight = block.reduce((sum, crop) => sum + crop.height, 0) + gaps;
    const fitsOnePage = rawHeight <= availableFullHeight;
    const canScaleToOnePage = block.length > 1 && !fitsOnePage && rawHeight <= availableFullHeight * 1.4;

    if (fitsOnePage || canScaleToOnePage) {
      const blockScale = canScaleToOnePage ? availableFullHeight / rawHeight : 1;
      const scaledHeight = rawHeight * blockScale;
      if (!flow.page || flow.cursorY - scaledHeight < SHORT_PAGE_BOTTOM_MARGIN) {
        flow.page = outputDoc.addPage([REGION_OUTPUT_PAGE_WIDTH, REGION_OUTPUT_PAGE_HEIGHT]);
        flow.cursorY = REGION_OUTPUT_PAGE_HEIGHT - SHORT_PAGE_TOP_MARGIN;
      }
      for (const crop of block) {
        const drawHeight = crop.height * blockScale;
        const drawWidth = crop.width * blockScale;
        const drawX = drawXFor(drawWidth);
        flow.page!.drawPage(crop.embeddedPage, {
          x: drawX,
          y: flow.cursorY - drawHeight,
          width: drawWidth,
          height: drawHeight,
        });
        if (crop.maskSourceFurniture) {
          drawSourceFurnitureMask(flow.page!, unit, drawX, flow.cursorY - drawHeight, drawWidth, drawHeight);
        }
        if (crop.startsUnit || unit.boardCode === "aqa") {
          drawQuestionNumberReplacement(flow.page!, unit, crop.pageNumber, crop.cropBox, questionNumber, drawX, flow.cursorY - drawHeight, drawWidth, drawHeight);
        }
        flow.cursorY -= drawHeight + SHORT_PAGE_GAP;
      }
    } else {
      for (let i = 0; i < block.length; i += 1) {
        const crop = block[i];
        const next = block[i + 1];
        const pairHeight = next ? crop.height + SHORT_PAGE_GAP + next.height : crop.height;
        const isLead = crop.kind === "stem" || crop.kind === "figure";
        const needBreak = !flow.page || flow.cursorY - crop.height < SHORT_PAGE_BOTTOM_MARGIN;
        const pairBreak = isLead && Boolean(next) && Boolean(flow.page)
          && flow.cursorY - pairHeight < SHORT_PAGE_BOTTOM_MARGIN
          && pairHeight <= availableFullHeight;
        if (needBreak || pairBreak) {
          flow.page = outputDoc.addPage([REGION_OUTPUT_PAGE_WIDTH, REGION_OUTPUT_PAGE_HEIGHT]);
          flow.cursorY = REGION_OUTPUT_PAGE_HEIGHT - SHORT_PAGE_TOP_MARGIN;
        }
        const drawX = drawXFor(crop.width);
        flow.page!.drawPage(crop.embeddedPage, {
          x: drawX,
          y: flow.cursorY - crop.height,
          width: crop.width,
          height: crop.height,
        });
        if (crop.maskSourceFurniture) {
          drawSourceFurnitureMask(flow.page!, unit, drawX, flow.cursorY - crop.height, crop.width, crop.height);
        }
        if (crop.startsUnit || unit.boardCode === "aqa") {
          drawQuestionNumberReplacement(flow.page!, unit, crop.pageNumber, crop.cropBox, questionNumber, drawX, flow.cursorY - crop.height, crop.width, crop.height);
        }
        flow.cursorY -= crop.height + SHORT_PAGE_GAP;
      }
    }
  }

  return prepared.length > 0;
}

export async function generateStrictSourcePaperPdf({ title, selectedUnits, allUnits, pageAssetsBySource, prefaceSourcePdfs = [], coverPage, figuresBySource, pageLayoutsBySource, regionMode = false }: GeneratePaperPdfInput) {
  const outputDoc = await PDFDocument.create();
  outputDoc.setTitle(title);
  await drawExamCoverPage(outputDoc, coverPage);

  const orderedUnits = Array.from(
    new Map(selectedUnits.map((unit) => [unit.sourceQuestionKey, unit])).values(),
  ).sort(compareQuestionUnitsForRendering);
  const generatedQuestionNumberByUnitKey = new Map(orderedUnits.map((unit, index) => [unit.unitKey, index + 1]));

  const sourcePdfCache = new Map<string, Uint8Array>();
  const sourceDocCache = new Map<string, PDFDocument>();
  const prependedInsertBySource = new Set<string>();

  for (const prefacePdfPath of Array.from(new Set(prefaceSourcePdfs))) {
    try {
      await addPdfPagesWithRasterFallback(outputDoc, prefacePdfPath, sourcePdfCache, sourceDocCache);
    } catch {
      continue;
    }
  }

  const layoutMapCache = new Map<string, Map<number, RegionPageLayout>>();
  const getLayoutMap = (sourceRelativePath: string) => {
    let cached = layoutMapCache.get(sourceRelativePath);
    if (!cached) {
      cached = new Map<number, RegionPageLayout>();
      for (const layout of pageLayoutsBySource?.get(sourceRelativePath) ?? []) {
        cached.set(layout.pageNumber, layout);
      }
      layoutMapCache.set(sourceRelativePath, cached);
    }
    return cached;
  };

  const regionUnits: QuestionUnit[] = [];
  const legacyUnits: QuestionUnit[] = [];
  for (const unit of orderedUnits) {
    const layoutMap = getLayoutMap(unit.sourceRelativePath);
    const regionPlan = regionMode && unit.boardCode !== "edexcel" && !isMathematicsUnit(unit) && isUnitRegionRenderable(unit, layoutMap)
      ? buildUnitRenderPlan(unit, layoutMap, figuresBySource?.get(unit.sourceRelativePath) ?? [])
      : [];
    if (regionPlan.length > 0) {
      regionUnits.push(unit);
    } else {
      legacyUnits.push(unit);
    }
  }

  const skippedUnitKeys: string[] = [];
  const renderedUnitKeys = new Set<string>();

  if (regionUnits.length > 0) {
    const regionFlow: RegionRenderFlow = { page: null, cursorY: 0 };
    for (const unit of regionUnits) {
      try {
        const rendered = await renderRegionUnit(
          unit,
          outputDoc,
          pageAssetsBySource,
          sourcePdfCache,
          sourceDocCache,
          getLayoutMap(unit.sourceRelativePath),
          figuresBySource?.get(unit.sourceRelativePath) ?? [],
          regionFlow,
          generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1,
        );
        if (rendered) {
          if (isEnglishLiteratureUnit(unit)) {
            drawGeneratedAnswerSpacePage(outputDoc, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, unit.totalMarks);
            regionFlow.page = null;
            regionFlow.cursorY = 0;
          }
          renderedUnitKeys.add(unit.unitKey);
        } else {
          legacyUnits.push(unit);
        }
      } catch (error) {
        skippedUnitKeys.push(unit.unitKey);
        console.warn(`Skipped region unit ${unit.unitKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const unitStartPages = buildUnitStartPageMap(allUnits);
  const renderPageNumbersByUnit = new Map(
    legacyUnits.map((unit) => [unit.unitKey, determineRenderPageNumbers(unit, unitStartPages)]),
  );
  const selectedPageOccupancy = buildRenderPageOccupancyMap(legacyUnits, renderPageNumbersByUnit);
  const shortUnits = legacyUnits.filter(shouldAttemptCompactLayout);
  const standardUnits = legacyUnits.filter((unit) => !shouldAttemptCompactLayout(unit));

  if (shortUnits.length > 0) {
    let currentPage: import("pdf-lib").PDFPage | null = null;
    let currentPageWidth = 595;
    let currentPageHeight = 842;
    let cursorTop = 0;

    for (const unit of shortUnits) {
     try {
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
                const polishedSupportCrop = trimSourceFurnitureCropBox(unit, supportCrop, pageWidth);
                const polishedQuestionCrop = trimSourceFurnitureCropBox(unit, questionCrop, pageWidth);
                await prepareSnippet(probeDoc, sourcePage.pdfUrl, toPdfCropBox(polishedSupportCrop), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                await prepareSnippet(probeDoc, sourcePage.pdfUrl, toPdfCropBox(polishedQuestionCrop), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                await probeDoc.save();
                const supportSnippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, toPdfCropBox(polishedSupportCrop), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                const questionSnippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, toPdfCropBox(polishedQuestionCrop), sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                candidateItem = buildShortPageItem(targetPageWidth, targetPageHeight, [{ ...supportSnippet, sourcePageNumber: pageNumber }, { ...questionSnippet, sourcePageNumber: pageNumber }], true, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, shouldMaskSourceFurniture(unit), unit);
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
            const polishedCropBox = trimSourceFurnitureCropBox(unit, cropBox, pageWidth);
            const pdfCropBox = toPdfCropBox(polishedCropBox);
            await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            await probeDoc.save();
            const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            return buildShortPageItem(targetPageWidth, targetPageHeight, [{ ...snippet, sourcePageNumber: pageNumber }], false, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, shouldMaskSourceFurniture(unit), unit);
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
      renderedUnitKeys.add(unit.unitKey);
    } catch (error) {
      standardUnits.push(unit);
      console.warn(`Short-layout render failed for ${unit.unitKey}, retrying standard: ${error instanceof Error ? error.message : String(error)}`);
    }
    }
  }

  for (const unit of standardUnits) {
    try {
      const renderPageNumbers = renderPageNumbersByUnit.get(unit.unitKey) ?? [];
      if (renderPageNumbers.length === 0) {
        skippedUnitKeys.push(unit.unitKey);
        continue;
      }
      let renderedAnyPage = false;
      let drewQuestionBadge = false;

      if (isEnglishLanguageUnit(unit) && prefaceSourcePdfs.length === 0 && !prependedInsertBySource.has(unit.sourceRelativePath)) {
        for (const insertPdfPath of deriveDownloadedInsertPdfPaths(unit)) {
          try {
            await addPdfPagesWithRasterFallback(outputDoc, insertPdfPath, sourcePdfCache, sourceDocCache);
          } catch {
            continue;
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
            const normalizeSourcePage = unit.boardCode === "edexcel";
            const targetPageWidth = isMaths ? MATH_OUTPUT_PAGE_WIDTH : normalizeSourcePage ? SOURCE_OUTPUT_PAGE_WIDTH : pageWidth;
            const targetPageHeight = isMaths ? MATH_OUTPUT_PAGE_HEIGHT : normalizeSourcePage ? SOURCE_OUTPUT_PAGE_HEIGHT : pageHeight;
            const matchingUnitPage = unit.pages.find((entry) => entry.pageNumber === pageNumber) ?? null;
            const siblingBoxes = getSiblingBoxesForPage(unit, allUnits, pageNumber);
            const selectedBox = matchingUnitPage?.bboxUnion ? toCropBox(matchingUnitPage.bboxUnion) : null;
            const isFirstRenderPage = !drewQuestionBadge;
            const answerLayout = shouldUseAnswerLayout(unit);
            const pageOccupancyCount = getPageOccupancyCount(selectedPageOccupancy, unit.sourceRelativePath, pageNumber);
            const mathCropBox = isMaths
              ? resolveMathQuestionCropBox(unit, allUnits, pageNumber, pageWidth, pageHeight, unitStartPages)
              : null;
            const cropBox = trimSourceFurnitureCropBox(unit, trimSourceFooterCropBox(unit, pageNumber, mathCropBox ?? resolveStandardCropBox(
              unit,
              pageNumber,
              pageWidth,
              pageHeight,
              selectedBox,
              siblingBoxes,
              isFirstRenderPage,
              answerLayout,
              pageOccupancyCount,
              unitStartPages,
            )), pageWidth);

            const meaningfulLines = getVisibleMeaningfulLines(unit.sourceRelativePath, pageNumber, cropBox);
            if (isMaths && meaningfulLines && meaningfulLines.length === 0) {
              return true;
            }
            if (isBusinessUnit(unit) && meaningfulLines && meaningfulLines.length === 0) {
              return true;
            }
            if (isBusinessUnit(unit) && isSourceFurnitureOnlyPage(unit, pageNumber, cropBox)) {
              return true;
            }
            if (unit.boardCode === "ocr" && isEmptyQuestionCrop(unit, pageNumber, cropBox)) {
              return true;
            }
            if (isBusinessFillerSourcePage(unit, pageNumber)) {
              return true;
            }

            if (isFullPageCrop(cropBox, pageWidth, pageHeight)) {
              if (isMathematicsUnit(unit) || normalizeSourcePage || shouldMaskSourceFurniture(unit)) {
                const pdfCropBox = toPdfCropBox(cropBox);
                const probeDoc = await PDFDocument.create();
                await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                await probeDoc.save();
                const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
                const outputPage = outputDoc.addPage([targetPageWidth, targetPageHeight]);
                const scale = normalizeSourcePage || isMaths
                  ? Math.min(targetPageWidth / snippet.width, targetPageHeight / snippet.height)
                  : 1;
                const drawWidth = snippet.width * scale;
                const drawHeight = snippet.height * scale;
                outputPage.drawPage(snippet.embeddedPage, {
                  x: (targetPageWidth - drawWidth) / 2,
                  y: (targetPageHeight - drawHeight) / 2,
                  width: drawWidth,
                  height: drawHeight,
                });
                if (shouldMaskSourceFurniture(unit)) drawSourceFurnitureMask(outputPage, unit, 0, 0, targetPageWidth, targetPageHeight);
                if (!drewQuestionBadge || isMaths || normalizeSourcePage || unit.boardCode === "aqa") {
                  drewQuestionBadge = drawQuestionNumberReplacement(
                    outputPage,
                    unit,
                    pageNumber,
                    cropBox,
                    generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1,
                    (targetPageWidth - drawWidth) / 2,
                    (targetPageHeight - drawHeight) / 2,
                    drawWidth,
                    drawHeight,
                  ) || drewQuestionBadge;
                }
                renderedAnyPage = true;
                return true;
              }

              const probeDoc = await PDFDocument.create();
              const [probePage] = await probeDoc.copyPages(sourceDoc, [sourcePage.sourcePageIndex]);
              probeDoc.addPage(probePage);
              await probeDoc.save();
              const [copiedPage] = await outputDoc.copyPages(sourceDoc, [sourcePage.sourcePageIndex]);
              const outputPage = outputDoc.addPage(copiedPage);
              if (shouldMaskSourceFurniture(unit)) {
                drawSourceFurnitureMask(outputPage, unit, 0, 0, targetPageWidth, targetPageHeight);
              }
              if (!drewQuestionBadge || isMaths || normalizeSourcePage || unit.boardCode === "aqa") {
                const { width: outputWidth, height: outputHeight } = outputPage.getSize();
                drewQuestionBadge = drawQuestionNumberReplacement(outputPage, unit, pageNumber, cropBox, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, 0, 0, outputWidth, outputHeight) || drewQuestionBadge;
              }
              renderedAnyPage = true;
              return true;
            }

            const cropWidth = cropBox.right - cropBox.left;
            const cropHeight = cropBox.top - cropBox.bottom;
            const pdfCropBox = toPdfCropBox(cropBox);
            const probeDoc = await PDFDocument.create();
            await prepareSnippet(probeDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            await probeDoc.save();
            const snippet = await prepareSnippet(outputDoc, sourcePage.pdfUrl, pdfCropBox, sourcePdfCache, sourceDocCache, sourcePage.sourcePageIndex);
            const outputPage = outputDoc.addPage([targetPageWidth, targetPageHeight]);
            const centerSnippet = isMaths || normalizeSourcePage;
            const availableWidth = targetPageWidth - (centerSnippet ? SHORT_PAGE_SIDE_MARGIN * 2 : 0);
            const availableHeight = targetPageHeight - STANDARD_PAGE_TOP_MARGIN - SHORT_PAGE_BOTTOM_MARGIN;
            const scale = centerSnippet ? Math.min(1, availableWidth / cropWidth, availableHeight / cropHeight) : 1;
            const drawWidth = cropWidth * scale;
            const drawHeight = cropHeight * scale;
            const drawX = centerSnippet ? (targetPageWidth - drawWidth) / 2 : 0;
            const drawY = Math.max(SHORT_PAGE_BOTTOM_MARGIN, targetPageHeight - drawHeight - STANDARD_PAGE_TOP_MARGIN);
            outputPage.drawPage(snippet.embeddedPage, {
              x: drawX,
              y: drawY,
              width: drawWidth,
              height: drawHeight,
            });
            if (shouldMaskSourceFurniture(unit)) {
              const maskWidth = unit.boardCode === "edexcel" && unit.subjectSlug === "business" ? targetPageWidth : drawWidth;
              drawSourceFurnitureMask(outputPage, unit, drawX, drawY, maskWidth, drawHeight);
            }
            if (!drewQuestionBadge || isMaths || normalizeSourcePage || unit.boardCode === "aqa") {
              drewQuestionBadge = drawQuestionNumberReplacement(outputPage, unit, pageNumber, cropBox, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, drawX, drawY, drawWidth, drawHeight) || drewQuestionBadge;
            }
            renderedAnyPage = true;
            return true;
          },
        );

        if (!rendered) {
          throw new Error(`Missing page asset CDN URL for ${unit.unitKey} page ${pageNumber}`);
        }
      }
      if (renderedAnyPage) {
        if (isEnglishLiteratureUnit(unit)) {
          drawGeneratedAnswerSpacePage(outputDoc, generatedQuestionNumberByUnitKey.get(unit.unitKey) ?? 1, unit.totalMarks);
        }
        renderedUnitKeys.add(unit.unitKey);
      }
    } catch (error) {
      skippedUnitKeys.push(unit.unitKey);
      console.warn(`Skipped unit ${unit.unitKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (renderedUnitKeys.size === 0) {
    throw new Error("Paper generation produced no renderable question pages.");
  }

  const uniqueSkippedUnitKeys = Array.from(new Set(skippedUnitKeys));
  if (uniqueSkippedUnitKeys.length > 0) {
    throw new Error(`Paper generation skipped ${uniqueSkippedUnitKeys.length} selected unit(s): ${uniqueSkippedUnitKeys.slice(0, 5).join(", ")}`);
  }

  return await outputDoc.save();
}
