import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getAqaBusinessTopicTree } from "@/lib/paper-maker/aqa-business";
import { AQA_GEOGRAPHY_TOPIC_TREE, type QuestionUnit, type TopicTreeNode } from "@/lib/paper-maker/aqa-geography";
import { getAqaEnglishLanguageTopicTree } from "@/lib/paper-maker/aqa-english-language";
import { getAqaEnglishLiteratureTopicTree } from "@/lib/paper-maker/aqa-english-literature";
import { buildCombinedScienceTopicTree } from "@/lib/paper-maker/combined-science";
import { getEdexcelBusinessTopicTree } from "@/lib/paper-maker/edexcel-business";
import { getEdexcelFrenchTopicTree } from "@/lib/paper-maker/edexcel-french";
import { getEdexcelMathematicsTopicTree } from "@/lib/paper-maker/edexcel-mathematics";
import { getEdexcelSeparateScienceTopicTree } from "@/lib/paper-maker/edexcel-separate-science";
import { getOcrComputerScienceTopicTree } from "@/lib/paper-maker/ocr-computer-science";
import type { CoverExamContext, PaperMakerSubjectDefinition, PaperOption } from "@/lib/paper-maker/subjects";

export type CalculatorPolicy = "may be used" | "must not be used" | "varies by selected paper" | "not specified";

export type GeneratedCoverModel = {
  boardLabel: string;
  subjectLabel: string;
  tierLabel: string | null;
  totalMarks: number;
  timeMinutes: number;
  questionCount: number;
  topicLabels: string[];
  paperLabels: string[];
  materials: string[];
  calculatorPolicy: CalculatorPolicy;
  instructions: string[];
  revisionPaperCode: string;
};

type BuildCoverModelInput = {
  subject: PaperMakerSubjectDefinition;
  tierLabel: string | null;
  selectedUnits: QuestionUnit[];
  selectedPapers: PaperOption[];
  timeMinutes: number;
  examContext: CoverExamContext;
};

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

function cleanLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function withoutBullet(value: string) {
  return cleanLabel(value).replace(/^•\s*/, "");
}

function getTopicTree(subject: PaperMakerSubjectDefinition, selectedUnits: QuestionUnit[]): TopicTreeNode[] {
  try {
    switch (subject.key) {
      case "aqa-geography":
        return AQA_GEOGRAPHY_TOPIC_TREE;
      case "aqa-business":
        return getAqaBusinessTopicTree();
      case "aqa-english-language":
        return getAqaEnglishLanguageTopicTree();
      case "aqa-english-literature":
        return getAqaEnglishLiteratureTopicTree();
      case "edexcel-business":
        return getEdexcelBusinessTopicTree();
      case "edexcel-combined-science":
        return buildCombinedScienceTopicTree(selectedUnits);
      case "edexcel-biology":
      case "edexcel-chemistry":
      case "edexcel-physics":
        return getEdexcelSeparateScienceTopicTree(subject.subjectSlug as "biology" | "chemistry" | "physics");
      case "edexcel-french-reading":
        return getEdexcelFrenchTopicTree();
      case "edexcel-mathematics-higher":
        return getEdexcelMathematicsTopicTree();
      case "ocr-computer-science":
        return getOcrComputerScienceTopicTree();
    }
  } catch {
    return [];
  }
}

function findTopicPath(nodes: TopicTreeNode[], leafId: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    const nextPath = [...path, cleanLabel(node.label)];
    if (node.children) {
      const nested = findTopicPath(node.children, leafId, nextPath);
      if (nested) return nested;
    } else if (node.leafTopicIds.includes(leafId)) {
      return nextPath;
    }
  }
  return null;
}

function resolveTopicLabels(subject: PaperMakerSubjectDefinition, selectedUnits: QuestionUnit[]) {
  const tree = getTopicTree(subject, selectedUnits);
  const labels: string[] = [];
  const seen = new Set<string>();
  const order = new Map<string, number>();
  const recordOrder = (nodes: TopicTreeNode[]) => {
    for (const node of nodes) {
      if (node.children?.length) recordOrder(node.children);
      else if (!order.has(cleanLabel(node.label))) order.set(cleanLabel(node.label), order.size);
    }
  };
  recordOrder(tree);

  for (const unit of selectedUnits) {
    for (const leafId of unit.canonicalLeafs) {
      const path = findTopicPath(tree, leafId);
      if (!path || path.length === 0) continue;
      const label = path[path.length - 1];
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }

  return labels.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function hashCode(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().slice(0, 4).padStart(4, "0");
}

function subjectCode(subject: PaperMakerSubjectDefinition) {
  const words = subject.coverTitle.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const code = words.map((word) => word[0]).join("").toUpperCase();
  return (code || "PAPER").slice(0, 5);
}

function resolveCalculatorPolicy(selectedPapers: PaperOption[], materials: string[]): CalculatorPolicy {
  const labels = selectedPapers.map((paper) => paper.label);
  const nonCalculator = labels.some((label) => /non[\s-]*calculator/i.test(label));
  const calculator = labels.some((label) => /calculator/i.test(label) && !/non[\s-]*calculator/i.test(label));
  if (nonCalculator && calculator) return "varies by selected paper";
  if (nonCalculator) return "must not be used";
  if (calculator) return "may be used";

  const materialText = materials.join(" ");
  if (/must not use|not allowed to use/i.test(materialText)) return "must not be used";
  if (/may use a calculator/i.test(materialText)) return "may be used";
  return "not specified";
}

function resolvePaperLabels(subject: PaperMakerSubjectDefinition, selectedUnits: QuestionUnit[], selectedPapers: PaperOption[]) {
  const options = new Map(subject.paperOptions.map((paper) => [paper.code, paper.label]));
  for (const paper of selectedPapers) options.set(paper.code, paper.label);
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const code of selectedUnits.map((unit) => unit.paperCode)) {
    const label = options.get(code);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function buildGeneratedCoverModel(input: BuildCoverModelInput): GeneratedCoverModel {
  const selectedQuestionKeys = new Set(input.selectedUnits.map((unit) => unit.sourceQuestionKey));
  const paperLabels = resolvePaperLabels(input.subject, input.selectedUnits, input.selectedPapers);
  const materials = input.examContext.materials
    .map(withoutBullet)
    .filter((line) => line && !/^for this paper you must have:?$/i.test(line));
  const instructions = input.examContext.instructions.map(withoutBullet).filter(Boolean);
  const identity = [
    input.subject.key,
    input.subject.coverTitle,
    input.tierLabel ?? "",
    Math.round(input.timeMinutes),
    ...paperLabels,
    ...input.selectedUnits.map((unit) => unit.unitKey),
  ].join("|");

  return {
    boardLabel: cleanLabel(input.subject.boardLabel),
    subjectLabel: cleanLabel(input.subject.coverTitle),
    tierLabel: input.tierLabel ? cleanLabel(input.tierLabel) : null,
    totalMarks: input.selectedUnits.reduce((total, unit) => total + Math.max(0, unit.totalMarks), 0),
    timeMinutes: Math.max(1, Math.round(input.timeMinutes)),
    questionCount: selectedQuestionKeys.size,
    topicLabels: resolveTopicLabels(input.subject, input.selectedUnits),
    paperLabels,
    materials,
    calculatorPolicy: resolveCalculatorPolicy(input.selectedPapers, input.examContext.materials),
    instructions,
    revisionPaperCode: `RWTP-${subjectCode(input.subject)}-${hashCode(identity)}`,
  };
}

function wrapText(font: PDFFont, value: string, size: number, maxWidth: number, maxLines: number) {
  const words = cleanLabel(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length <= maxLines && lines.length > 0 && words.join(" ") !== lines.join(" ")) {
    let last = lines[lines.length - 1] ?? "";
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}...`;
  }
  return lines.slice(0, maxLines);
}

function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  color: ReturnType<typeof rgb>,
  lineGap = 12,
  maxLines = 4,
) {
  const lines = wrapText(font, value, size, maxWidth, maxLines);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineGap, size, font, color }));
  return y - lines.length * lineGap;
}

function drawList(
  page: PDFPage,
  font: PDFFont,
  values: string[],
  x: number,
  y: number,
  width: number,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  let cursor = y;
  for (const value of values) {
    const lines = wrapText(font, value, size, width - 12, 3);
    if (lines.length === 0) continue;
    page.drawText("•", { x, y: cursor, size, font, color });
    lines.forEach((line, index) => page.drawText(line, { x: x + 12, y: cursor - index * 11, size, font, color }));
    cursor -= lines.length * 11 + 5;
  }
  return cursor;
}

function drawField(page: PDFPage, font: PDFFont, label: string, y: number, boxes = 0) {
  page.drawText(label, { x: LEFT, y, size: 10.5, font, color: NAVY });
  if (boxes > 0) {
    for (let index = 0; index < boxes; index += 1) {
      page.drawRectangle({ x: 170 + index * 25, y: y - 5, width: 20, height: 20, borderColor: RULE, borderWidth: 0.8 });
    }
    return;
  }
  page.drawLine({ start: { x: 170, y: y - 3 }, end: { x: RIGHT, y: y - 3 }, thickness: 0.8, color: RULE });
}

function drawBrandMark(page: PDFPage, x: number, y: number, scale = 1) {
  page.drawSvgPath("M 1 5 L 17 1 L 22 27 L 6 31 Z", { x, y, scale, color: NAVY });
  page.drawSvgPath("M 6 7 L 23 4 L 27 30 L 10 33 Z", { x, y, scale, color: BLUE });
  page.drawSvgPath("M 11 19 L 15 23 L 23 12 L 25 14 L 15 27 L 9 21 Z", { x, y, scale, color: WHITE });
}

export async function drawGeneratedCoverPage(outputDoc: PDFDocument, cover: GeneratedCoverModel) {
  const page = outputDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await outputDoc.embedFont(StandardFonts.Helvetica);
  const bold = await outputDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 24, y: 821, width: PAGE_WIDTH - 56, height: 5, color: BLUE });
  page.drawRectangle({ x: PAGE_WIDTH - 32, y: 821, width: 8, height: 5, color: MINT });

  drawBrandMark(page, LEFT, 795, 1);
  page.drawText("Revise with the Past", { x: LEFT + 34, y: 780, size: 18, font: bold, color: NAVY });
  const codeWidth = bold.widthOfTextAtSize(cover.revisionPaperCode, 8.2);
  const typeWidth = regular.widthOfTextAtSize("PRACTICE PAPER", 8.2);
  page.drawText(cover.revisionPaperCode, { x: RIGHT - codeWidth, y: 786, size: 8.2, font: bold, color: NAVY });
  page.drawText("PRACTICE PAPER", { x: RIGHT - typeWidth, y: 773, size: 8.2, font: regular, color: NAVY });
  page.drawLine({ start: { x: LEFT, y: 748 }, end: { x: RIGHT, y: 748 }, thickness: 1, color: RULE });

  const identity = `${cover.boardLabel} GCSE ${cover.subjectLabel}${cover.tierLabel ? ` · ${cover.tierLabel} tier` : ""}`.toUpperCase();
  drawWrapped(page, bold, identity, LEFT, 716, 11, CONTENT_WIDTH, BLUE, 13, 1);
  page.drawText("Focused practice paper", { x: LEFT, y: 665, size: 32, font: bold, color: NAVY });

  page.drawLine({ start: { x: LEFT, y: 625 }, end: { x: RIGHT, y: 625 }, thickness: 1, color: RULE });
  page.drawLine({ start: { x: LEFT, y: 567 }, end: { x: RIGHT, y: 567 }, thickness: 1, color: RULE });
  const facts = [
    [String(cover.timeMinutes), "MINUTES"],
    [String(cover.totalMarks), "MARKS"],
    [String(cover.questionCount), "QUESTIONS"],
  ];
  const factWidth = CONTENT_WIDTH / facts.length;
  facts.forEach(([value, label], index) => {
    const center = LEFT + factWidth * index + factWidth / 2;
    const valueWidth = bold.widthOfTextAtSize(value, 22);
    const labelWidth = bold.widthOfTextAtSize(label, 8.5);
    page.drawText(value, { x: center - valueWidth / 2, y: 595, size: 22, font: bold, color: BLUE });
    page.drawText(label, { x: center - labelWidth / 2, y: 579, size: 8.5, font: bold, color: NAVY });
    if (index < facts.length - 1) page.drawLine({ start: { x: LEFT + factWidth * (index + 1), y: 573 }, end: { x: LEFT + factWidth * (index + 1), y: 619 }, thickness: 0.8, color: RULE });
  });

  drawField(page, regular, "Name", 536);
  drawField(page, regular, "School", 503);
  drawField(page, regular, "Candidate number", 470, 6);

  const columnTop = 425;
  const columnGap = 28;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  const dividerX = LEFT + columnWidth + columnGap / 2;
  page.drawLine({ start: { x: dividerX, y: 421 }, end: { x: dividerX, y: 280 }, thickness: 0.8, color: RULE });
  page.drawText("Instructions", { x: LEFT, y: columnTop, size: 14, font: bold, color: NAVY });
  drawList(page, regular, cover.instructions.slice(0, 5), LEFT, columnTop - 21, columnWidth, 9, NAVY);

  const informationX = LEFT + columnWidth + columnGap;
  page.drawText("Information", { x: informationX, y: columnTop, size: 14, font: bold, color: NAVY });
  const information = [
    `The total mark for this paper is ${cover.totalMarks}.`,
    `Calculators ${cover.calculatorPolicy}.`,
    ...cover.materials.slice(0, 2).map((material) => `Materials: ${material}`),
    "Marks are shown in brackets beside each question.",
  ];
  drawList(page, regular, information.slice(0, 5), informationX, columnTop - 21, columnWidth, 9, NAVY);

  const topicHeadingY = 252;
  page.drawText("THIS PAPER COVERS", { x: LEFT, y: topicHeadingY, size: 9, font: bold, color: NAVY });
  const topicRows = cover.topicLabels.length > 6
    ? [...cover.topicLabels.slice(0, 5), `+ ${cover.topicLabels.length - 5} additional covered topics`]
    : cover.topicLabels.length > 0
      ? cover.topicLabels
      : ["No topic labels resolved."];
  let topicY = topicHeadingY - 19;
  for (const topic of topicRows) {
    page.drawLine({ start: { x: LEFT, y: topicY - 6 }, end: { x: RIGHT, y: topicY - 6 }, thickness: 0.6, color: RULE });
    page.drawLine({ start: { x: LEFT + 3, y: topicY + 1 }, end: { x: LEFT + 7, y: topicY - 3 }, thickness: 1.4, color: BLUE });
    page.drawLine({ start: { x: LEFT + 7, y: topicY - 3 }, end: { x: LEFT + 15, y: topicY + 6 }, thickness: 1.4, color: BLUE });
    drawWrapped(page, bold, topic, LEFT + 27, topicY, 10.5, CONTENT_WIDTH - 27, NAVY, 12, 1);
    topicY -= 19;
  }

  page.drawLine({ start: { x: LEFT, y: 86 }, end: { x: RIGHT, y: 86 }, thickness: 2.4, color: BLUE });
  const turnText = "DO NOT TURN OVER UNTIL YOU ARE READY";
  const turnWidth = bold.widthOfTextAtSize(turnText, 8.5);
  page.drawText(turnText, { x: LEFT + (CONTENT_WIDTH - turnWidth) / 2, y: 67, size: 8.5, font: bold, color: NAVY });
  const footerCodeWidth = regular.widthOfTextAtSize(cover.revisionPaperCode, 8.5);
  page.drawText(cover.revisionPaperCode, { x: RIGHT - footerCodeWidth, y: 42, size: 8.5, font: regular, color: MUTED });
}
