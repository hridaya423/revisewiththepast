import type { PDFDocument, PDFPage } from "pdf-lib";

import { GENERATED_PAGE, type PreparedQuestionFragment } from "@/features/papers/builder/domain/generated-layout";
import { criterionMarks, type ShadowAnswerSpace, type ShadowBlock, type ShadowInline, type ShadowQuestionDocument, type ShadowSolution } from "../../contracts/shadow-paper";
import { GREY, INK, LIGHT, drawText, measureText, type ShadowFonts } from "./fonts";
import { BODY_SIZE, blockGap, stack, typesetBlock, typesetParagraph, typesetSingleLine, type Laid, type StackEntry } from "./layout";

export const COLUMN_WIDTH = GENERATED_PAGE.contentWidth;
const PART_INDENT = 28;
const RIGHT_EDGE = COLUMN_WIDTH - 2;
const ANSWER_LEADER = 168;
const SPLIT_INK = 0.01;

export type TypesetFragment = {
  fragment: PreparedQuestionFragment;
  page: PDFPage;
};

type Column = { entries: StackEntry[]; firstBaseline: number; firstLineHeight: number };

function marksLabel(marks: number) {
  return `(${marks})`;
}

function rightAligned(text: string, fonts: ShadowFonts, options: { size?: number; bold?: boolean; height?: number } = {}): Laid {
  const size = options.size ?? BODY_SIZE;
  const font = options.bold ? fonts.bold : fonts.roman;
  const width = measureText(text, font, fonts.symbol, size);
  const height = options.height ?? size * 1.4;
  return {
    height,
    draw(page, x, top) {
      drawText(page, text, { x: x + RIGHT_EDGE - width, y: top - height + size * 0.32, size, font, symbol: fonts.symbol });
    },
  };
}

function dottedLine(page: PDFPage, x1: number, x2: number, y: number) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.9, color: INK, dashArray: [0.9, 2.1] });
}

function answerRow(prefix: ShadowInline[] | undefined, suffix: ShadowInline[] | undefined, fonts: ShadowFonts): Laid {
  const before = prefix?.length ? typesetSingleLine(prefix, fonts) : null;
  const after = suffix?.length ? typesetSingleLine(suffix, fonts) : null;
  const height = 26;
  return {
    height,
    draw(page, x, top) {
      const baseline = top - height + 6;
      const right = x + RIGHT_EDGE;
      const suffixWidth = after ? after.width + 4 : 0;
      const leaderEnd = right - suffixWidth;
      const leaderStart = leaderEnd - ANSWER_LEADER;
      dottedLine(page, leaderStart, leaderEnd, baseline);
      before?.draw(page, leaderStart - before.width - 4, baseline);
      after?.draw(page, leaderEnd + 4, baseline);
    },
  };
}

function answerSpace(answer: ShadowAnswerSpace, fonts: ShadowFonts, indent: number): Laid[] {
  switch (answer.kind) {
    case "none": return [];
    case "line": return [answerRow(answer.prefix, answer.suffix, fonts)];
    case "multi": return answer.lines.map((line) => answerRow(line.prefix, line.suffix, fonts));
    case "coordinate": {
      const height = 26;
      return [{
        height,
        draw(page, x, top) {
          const baseline = top - height + 6;
          const right = x + RIGHT_EDGE;
          const comma = measureText(",", fonts.roman, fonts.symbol, BODY_SIZE);
          const close = measureText(")", fonts.roman, fonts.symbol, BODY_SIZE);
          const segment = 64;
          const closeX = right - close;
          drawText(page, ")", { x: closeX, y: baseline, size: BODY_SIZE, font: fonts.roman, symbol: fonts.symbol });
          dottedLine(page, closeX - 3 - segment, closeX - 3, baseline);
          const commaX = closeX - 6 - segment - comma;
          drawText(page, ",", { x: commaX, y: baseline, size: BODY_SIZE, font: fonts.roman, symbol: fonts.symbol });
          dottedLine(page, commaX - 3 - segment, commaX - 3, baseline);
          drawText(page, "(", { x: commaX - 9 - segment - close, y: baseline, size: BODY_SIZE, font: fonts.roman, symbol: fonts.symbol });
        },
      }];
    }
    case "reason": {
      return Array.from({ length: answer.lines }, () => ({
        height: 26,
        draw(page: PDFPage, x: number, top: number) {
          dottedLine(page, x + indent, x + COLUMN_WIDTH, top - 20);
        },
      }));
    }
  }
}

function blockEntries(blocks: ShadowBlock[], fonts: ShadowFonts, width: number, indent: number, previous: ShadowBlock | undefined, options: { breakFirst?: boolean; breakBetween?: boolean } = {}): StackEntry[] {
  let last = previous;
  return blocks.map((block, index) => {
    const laid = typesetBlock(block, fonts, width);
    const entry: StackEntry = {
      item: { height: laid.height, draw: (page, x, top) => laid.draw(page, x + indent, top) },
      before: last ? Math.max(blockGap(last, block), index === 0 ? 10 : 0) : 0,
      breakBefore: index === 0 ? options.breakFirst : options.breakBetween,
    };
    last = block;
    return entry;
  });
}

function labelled(label: string, item: Laid, fonts: ShadowFonts, firstBaseline: number): Laid {
  return {
    height: item.height,
    draw(page, x, top) {
      drawText(page, label, { x, y: top - firstBaseline, size: BODY_SIZE, font: fonts.bold, symbol: fonts.symbol });
      item.draw(page, x, top);
    },
  };
}

function firstBaselineOf(block: ShadowBlock, fonts: ShadowFonts, width: number) {
  if (block.b === "p") {
    const paragraph = typesetParagraph(block.runs, fonts, width - (block.indent ?? 0) * 18);
    return { baseline: paragraph.firstBaseline, lineHeight: paragraph.firstLineHeight };
  }
  return { baseline: BODY_SIZE * 0.9, lineHeight: BODY_SIZE * 1.34 };
}

function totalFooter(question: { number: number; totalMarks: number }, fonts: ShadowFonts): Laid {
  const text = `(Total for Question ${question.number} is ${question.totalMarks} ${question.totalMarks === 1 ? "mark" : "marks"})`;
  const size = BODY_SIZE - 0.5;
  const width = measureText(text, fonts.bold, fonts.symbol, size);
  const height = 24;
  return {
    height,
    draw(page, x, top) {
      drawText(page, text, { x: x + RIGHT_EDGE - width, y: top - 13, size, font: fonts.bold, symbol: fonts.symbol });
      page.drawLine({ start: { x, y: top - height + 3 }, end: { x: x + COLUMN_WIDTH, y: top - height + 3 }, thickness: 1.1, color: INK });
    },
  };
}

export function questionColumn(question: ShadowQuestionDocument, fonts: ShadowFonts): Column {
  const entries: StackEntry[] = [];
  let previous: ShadowBlock | undefined;
  entries.push(...blockEntries(question.stem, fonts, COLUMN_WIDTH, 0, undefined, { breakBetween: false }));
  previous = question.stem.at(-1);
  const anchorBlock = question.stem[0] ?? question.parts[0]!.lead[0] ?? question.parts[0]!.prompt[0]!;
  const anchorIndent = question.stem.length === 0 && question.parts[0]!.lead.length === 0 && question.parts[0]!.label ? PART_INDENT : 0;
  const anchor = firstBaselineOf(anchorBlock, fonts, COLUMN_WIDTH - anchorIndent);

  question.parts.forEach((part) => {
    const breakHere = entries.length > 0 && part.label !== null;
    const lead = blockEntries(part.lead, fonts, COLUMN_WIDTH, 0, previous, { breakFirst: breakHere });
    entries.push(...lead);
    if (part.lead.length > 0) previous = part.lead.at(-1);
    const indent = part.label ? PART_INDENT : 0;
    const width = COLUMN_WIDTH - indent;
    const prompt = blockEntries(part.prompt, fonts, width, indent, previous, { breakFirst: breakHere && lead.length === 0 });
    if (part.label) {
      const first = prompt[0]!;
      const baseline = firstBaselineOf(part.prompt[0]!, fonts, width).baseline;
      first.item = labelled(part.label, first.item, fonts, baseline);
    }
    entries.push(...prompt);
    previous = part.prompt.at(-1);
    if (part.working > 0) entries.push({ item: { height: part.working, draw() {} }, before: 0 });
    for (const row of answerSpace(part.answer, fonts, indent)) entries.push({ item: row, before: 4 });
    entries.push({ item: rightAligned(marksLabel(part.marks), fonts, { bold: true, height: 20 }), before: 2 });
  });
  entries.push({ item: totalFooter(question, fonts), before: 2 });
  return { entries, firstBaseline: anchor.baseline, firstLineHeight: anchor.lineHeight };
}

function sansLabel(text: string, fonts: ShadowFonts, indent: number): Laid {
  const size = 8;
  return {
    height: size * 1.8,
    draw(page, x, top) {
      page.drawText(text.toUpperCase(), { x: x + indent, y: top - size * 1.3, size, font: fonts.sansBold, color: GREY });
    },
  };
}

function criterionRow(code: string, runs: ShadowInline[], fonts: ShadowFonts, indent: number, shaded: boolean): Laid {
  const codeWidth = 46;
  const width = COLUMN_WIDTH - indent - codeWidth - 8;
  const paragraph = typesetParagraph(runs, fonts, width, { size: BODY_SIZE - 1 });
  const height = paragraph.height + 8;
  return {
    height,
    draw(page, x, top) {
      if (shaded) page.drawRectangle({ x: x + indent, y: top - height, width: COLUMN_WIDTH - indent, height, color: LIGHT });
      drawText(page, code, { x: x + indent + 6, y: top - 4 - paragraph.firstBaseline, size: BODY_SIZE - 1, font: fonts.bold, symbol: fonts.symbol });
      paragraph.draw(page, x + indent + codeWidth, top - 4);
    },
  };
}

function answerHeader(label: string | null, answer: ShadowInline[], marks: number, fonts: ShadowFonts) {
  const indent = label ? PART_INDENT : 0;
  const marksText = `${marks} ${marks === 1 ? "mark" : "marks"}`;
  const marksWidth = measureText(marksText, fonts.bold, fonts.symbol, BODY_SIZE - 1);
  const paragraph = typesetParagraph([{ t: "text", v: "Answer:  ", style: "b" }, ...answer], fonts, COLUMN_WIDTH - indent - marksWidth - 16);
  const item: Laid = {
    height: paragraph.height,
    draw(page, x, top) {
      if (label) drawText(page, label, { x, y: top - paragraph.firstBaseline, size: BODY_SIZE, font: fonts.bold, symbol: fonts.symbol });
      paragraph.draw(page, x + indent, top);
      drawText(page, marksText, { x: x + RIGHT_EDGE - marksWidth, y: top - paragraph.firstBaseline, size: BODY_SIZE - 1, font: fonts.bold, symbol: fonts.symbol, color: GREY });
    },
  };
  return { item, firstBaseline: paragraph.firstBaseline, firstLineHeight: paragraph.firstLineHeight };
}

export function schemeColumn(question: ShadowQuestionDocument, solution: ShadowSolution, fonts: ShadowFonts): Column {
  const entries: StackEntry[] = [];
  let anchor = { baseline: BODY_SIZE * 0.9, lineHeight: BODY_SIZE * 1.34 };
  solution.parts.forEach((part, partIndex) => {
    const printed = question.parts.find((entry) => entry.id === part.partId);
    if (!printed) throw new Error(`Scheme part ${part.partId} has no printed question part.`);
    const label = printed.label;
    const indent = label ? PART_INDENT : 0;
    const header = answerHeader(label, part.answer, part.marks, fonts);
    if (partIndex === 0) anchor = { baseline: header.firstBaseline, lineHeight: header.firstLineHeight };
    entries.push({ item: header.item, before: partIndex === 0 ? 0 : 16, breakBefore: partIndex > 0 });

    if (part.accepted.length > 0) {
      entries.push({ item: sansLabel("Notes", fonts, indent), before: 6 });
      for (const note of part.accepted) {
        const paragraph = typesetParagraph([{ t: "text", v: "•  " }, ...note], fonts, COLUMN_WIDTH - indent - 8, { size: BODY_SIZE - 1 });
        entries.push({ item: { height: paragraph.height, draw: (page, x, top) => paragraph.draw(page, x + indent + 8, top) }, before: 1 });
      }
    }

    entries.push({ item: sansLabel("Worked solution", fonts, indent), before: 8, breakBefore: true });
    entries.push(...blockEntries(part.working, fonts, COLUMN_WIDTH - indent - 8, indent + 8, undefined, { breakBetween: true }).map((entry, index) => ({ ...entry, before: index === 0 ? 2 : entry.before })));

    entries.push({ item: sansLabel("Mark scheme", fonts, indent), before: 10, breakBefore: true });
    part.branches.forEach((branch, branchIndex) => {
      if (branch.label) {
        const heading = typesetParagraph([{ t: "text", v: branch.label, style: "b" }], fonts, COLUMN_WIDTH - indent, { size: BODY_SIZE - 1 });
        entries.push({ item: { height: heading.height, draw: (page, x, top) => heading.draw(page, x + indent, top) }, before: branchIndex === 0 ? 2 : 8, breakBefore: branchIndex > 0 });
      }
      branch.criteria.forEach((criterion, index) => {
        const runs: ShadowInline[] = [...criterion.text];
        if (criterion.followThrough) runs.push({ t: "text", v: " (ft)", style: "i" });
        entries.push({ item: criterionRow(criterion.code, runs, fonts, indent, index % 2 === 0), before: 0, breakBefore: index > 0 });
      });
      for (const partial of branch.partialCredit ?? []) {
        entries.push({ item: criterionRow(partial.code, [{ t: "text", v: "Partial credit: ", style: "i" }, ...partial.text], fonts, indent, false), before: 0, breakBefore: true });
      }
      const awarded = branch.criteria.reduce((sum, criterion) => sum + criterionMarks(criterion.code), 0);
      if (awarded !== part.marks) throw new Error(`Branch awards ${awarded} marks; part is worth ${part.marks}.`);
    });
    for (const special of part.specialCases) {
      entries.push({ item: criterionRow(special.code, special.text, fonts, indent, false), before: 2, breakBefore: true });
    }
  });
  entries.push({ item: totalFooter(question, fonts), before: 10 });
  return { entries, firstBaseline: anchor.baseline, firstLineHeight: anchor.lineHeight };
}

/** Typesets a column onto its own page sized to the content so the shared planner can place and split it. */
export function typesetFragment(input: {
  scratch: PDFDocument;
  fonts: ShadowFonts;
  column: Column;
  fragmentId: string;
  unitKey: string;
  sourcePageNumber: number;
}): TypesetFragment {
  const laid = stack(input.column.entries);
  const height = Math.ceil(laid.height + 2);
  const width = COLUMN_WIDTH;
  const page = input.scratch.addPage([width, height]);
  laid.draw(page, 0, height);
  const baseline = height - input.column.firstBaseline;
  const lineTop = Math.min(height, baseline + BODY_SIZE * 0.8);
  const lineBottom = Math.max(0, baseline - BODY_SIZE * 0.3);
  const promptBounds = { x0: 0, x1: width, y0: lineBottom, y1: lineTop };
  return {
    page,
    fragment: {
      fragmentId: input.fragmentId,
      unitKey: input.unitKey,
      sourcePageNumber: input.sourcePageNumber,
      crop: { left: 0, right: width, bottom: 0, top: height },
      identity: {
        pageNumber: input.sourcePageNumber,
        numberBounds: { x0: 0, x1: 0.5, y0: lineBottom, y1: lineTop },
        promptBaseline: baseline,
        promptBounds,
      },
      width,
      height,
      kind: "question",
      splitGaps: laid.breaks.map((offset) => ({ y: height - offset, pageInk: SPLIT_INK })),
    },
  };
}
