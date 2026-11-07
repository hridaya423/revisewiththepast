import type { PDFFont, PDFPage } from "pdf-lib";

import type { ShadowBlock, ShadowInline } from "../../contracts/shadow-paper";
import { INK, drawText, measureText, type ShadowFonts } from "./fonts";
import { layoutMath, type MathBox } from "./math-renderer";
import { drawDiagram } from "./render-diagram";

export const BODY_SIZE = 11.5;
export const INDENT_STEP = 18;
export const PARAGRAPH_GAP = 7;

/**
 * A laid-out vertical item. `draw` receives the left edge and the top edge in PDF
 * coordinates (y grows upwards), so stacked items can be painted top-down.
 */
export type Laid = {
  height: number;
  draw(page: PDFPage, x: number, top: number): void;
};

export type InlineStyle = { size?: number; bold?: boolean; italic?: boolean; color?: ReturnType<typeof import("pdf-lib").rgb> };

type Atom = MathBox & { glue: false };
type Glue = { glue: true; width: number };
type Token = Atom | Glue;

function fontFor(fonts: ShadowFonts, style: "b" | "i" | undefined, base: InlineStyle): PDFFont {
  const bold = style === "b" || base.bold === true;
  const italic = style === "i" || base.italic === true;
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.roman;
}

function wordAtom(word: string, font: PDFFont, fonts: ShadowFonts, size: number, color: InlineStyle["color"]): Atom {
  return {
    glue: false,
    width: measureText(word, font, fonts.symbol, size),
    ascent: 0.68 * size,
    descent: 0.21 * size,
    draw(page, x, baseline) {
      drawText(page, word, { x, y: baseline, size, font, symbol: fonts.symbol, color: color ?? INK });
    },
  };
}

function tokenise(runs: ShadowInline[], fonts: ShadowFonts, style: InlineStyle): Token[] {
  const size = style.size ?? BODY_SIZE;
  const space = fonts.roman.widthOfTextAtSize(" ", size);
  const tokens: Token[] = [];
  for (const run of runs) {
    if (run.t === "math") {
      tokens.push({ ...layoutMath(run.m, fonts, size), glue: false });
      continue;
    }
    const font = fontFor(fonts, run.style, style);
    for (const piece of run.v.split(/(\s+)/u)) {
      if (piece === "") continue;
      if (/^\s+$/u.test(piece)) {
        tokens.push({ glue: true, width: space * Math.min(3, piece.length) });
        continue;
      }
      tokens.push(wordAtom(piece, font, fonts, size, style.color));
    }
  }
  return tokens;
}

export type InlineLine = { width: number; ascent: number; descent: number; atoms: Array<{ x: number; atom: Atom }> };

/** Greedy line breaking at glue only, so punctuation never separates from the maths it follows. */
export function breakInline(runs: ShadowInline[], fonts: ShadowFonts, width: number, style: InlineStyle = {}): InlineLine[] {
  const size = style.size ?? BODY_SIZE;
  const tokens = tokenise(runs, fonts, style);
  const words: Array<{ atoms: Atom[]; width: number; glueBefore: number }> = [];
  let pendingGlue = 0;
  let current: { atoms: Atom[]; width: number; glueBefore: number } | null = null;
  for (const token of tokens) {
    if (token.glue) {
      if (current) {
        words.push(current);
        current = null;
      }
      pendingGlue += token.width;
      continue;
    }
    if (!current) {
      current = { atoms: [], width: 0, glueBefore: pendingGlue };
      pendingGlue = 0;
    }
    current.atoms.push(token);
    current.width += token.width;
  }
  if (current) words.push(current);

  const lines: InlineLine[] = [];
  let line: InlineLine = { width: 0, ascent: 0.68 * size, descent: 0.21 * size, atoms: [] };
  for (const word of words) {
    const glue = line.atoms.length > 0 ? word.glueBefore : 0;
    if (line.atoms.length > 0 && line.width + glue + word.width > width + 0.01) {
      lines.push(line);
      line = { width: 0, ascent: 0.68 * size, descent: 0.21 * size, atoms: [] };
    }
    let x = line.width + (line.atoms.length > 0 ? word.glueBefore : 0);
    for (const atom of word.atoms) {
      line.atoms.push({ x, atom });
      line.ascent = Math.max(line.ascent, atom.ascent);
      line.descent = Math.max(line.descent, atom.descent);
      x += atom.width;
    }
    line.width = x;
  }
  if (line.atoms.length > 0) lines.push(line);
  for (const entry of lines) {
    if (entry.width > width + 0.5) throw new Error(`Text line is ${entry.width.toFixed(1)}pt wide; only ${width.toFixed(1)}pt is available.`);
  }
  return lines;
}

function lineAdvance(line: InlineLine, size: number) {
  return Math.max(size * 1.34, line.ascent + line.descent + size * 0.32);
}

export type TypesetParagraph = Laid & {
  /** Distance from the paragraph top to the first baseline. */
  firstBaseline: number;
  firstLineHeight: number;
  lineCount: number;
  widestLine: number;
};

export function typesetParagraph(runs: ShadowInline[], fonts: ShadowFonts, width: number, style: InlineStyle & { align?: "left" | "center" | "right" } = {}): TypesetParagraph {
  const size = style.size ?? BODY_SIZE;
  const lines = breakInline(runs, fonts, width, style);
  const placements: Array<{ line: InlineLine; baseline: number }> = [];
  let cursor = 0;
  lines.forEach((line, index) => {
    const advance = lineAdvance(line, size);
    const leading = (advance - line.ascent - line.descent) / 2;
    const baseline = cursor + leading + line.ascent;
    placements.push({ line, baseline });
    cursor += advance;
    if (index === lines.length - 1) cursor = Math.max(cursor, baseline + line.descent);
  });
  const first = placements[0];
  return {
    height: cursor,
    firstBaseline: first ? first.baseline : 0,
    firstLineHeight: first ? lineAdvance(first.line, size) : 0,
    lineCount: lines.length,
    widestLine: Math.max(0, ...lines.map((line) => line.width)),
    draw(page, x, top) {
      for (const { line, baseline } of placements) {
        const offset = style.align === "center" ? (width - line.width) / 2 : style.align === "right" ? width - line.width : 0;
        for (const { x: atomX, atom } of line.atoms) atom.draw(page, x + offset + atomX, top - baseline);
      }
    },
  };
}

/** A single unbreakable inline run, measured for diagram labels and table cells. */
export function typesetSingleLine(runs: ShadowInline[], fonts: ShadowFonts, style: InlineStyle = {}) {
  const lines = breakInline(runs, fonts, 10_000, style);
  const line = lines[0] ?? { width: 0, ascent: 0, descent: 0, atoms: [] };
  return {
    width: line.width,
    ascent: line.ascent,
    descent: line.descent,
    draw(page: PDFPage, x: number, baseline: number) {
      for (const { x: atomX, atom } of line.atoms) atom.draw(page, x + atomX, baseline);
    },
  };
}

const CELL_PAD_X = 6;
const CELL_PAD_Y = 5;

function typesetTable(block: Extract<ShadowBlock, { b: "table" }>, fonts: ShadowFonts, width: number): Laid {
  const columns = block.rows[0]!.length;
  const cells = block.rows.map((row) => row.map((cell, columnIndex) => {
    return typesetSingleLine(cell.length > 0 ? cell : [{ t: "text", v: " " }], fonts, { bold: block.headerColumn === true && columnIndex === 0 });
  }));
  const natural = Array.from({ length: columns }, (_, column) => Math.max(...cells.map((row) => row[column]!.width)) + CELL_PAD_X * 2);
  const widths = natural.map((value, column) => {
    if (column === 0 && block.firstColWidth) return Math.max(block.firstColWidth, value);
    if (block.colWidth) return Math.max(block.colWidth, value);
    return Math.max(value, 34);
  });
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  if (tableWidth > width + 0.5) throw new Error(`Table is ${tableWidth.toFixed(1)}pt wide; only ${width.toFixed(1)}pt is available.`);
  const rowHeights = cells.map((row) => Math.max(BODY_SIZE * 1.9, ...row.map((cell) => cell.ascent + cell.descent + CELL_PAD_Y * 2)));
  const height = rowHeights.reduce((sum, value) => sum + value, 0);
  const left = block.align === "left" ? 0 : (width - tableWidth) / 2;
  const borders = block.borders !== false;
  return {
    height,
    draw(page, x, top) {
      let rowTop = top;
      cells.forEach((row, rowIndex) => {
        const rowHeight = rowHeights[rowIndex]!;
        let cellLeft = x + left;
        row.forEach((cell, columnIndex) => {
          const cellWidth = widths[columnIndex]!;
          if (borders) {
            page.drawRectangle({ x: cellLeft, y: rowTop - rowHeight, width: cellWidth, height: rowHeight, borderColor: INK, borderWidth: 0.6 });
          }
          const baseline = rowTop - rowHeight / 2 - (cell.ascent - cell.descent) / 2;
          cell.draw(page, cellLeft + (cellWidth - cell.width) / 2, baseline);
          cellLeft += cellWidth;
        });
        rowTop -= rowHeight;
      });
    },
  };
}

/** Lays out one content block across `width` points. Blocks never scale; oversized content throws. */
export function typesetBlock(block: ShadowBlock, fonts: ShadowFonts, width: number): Laid {
  switch (block.b) {
    case "p": {
      const indent = (block.indent ?? 0) * INDENT_STEP;
      const paragraph = typesetParagraph(block.runs, fonts, width - indent);
      return { height: paragraph.height, draw: (page, x, top) => paragraph.draw(page, x + indent, top) };
    }
    case "math": {
      const indent = (block.indent ?? 0) * INDENT_STEP;
      const box = layoutMath(block.m, fonts, BODY_SIZE);
      if (box.width > width - indent) throw new Error(`Display maths is ${box.width.toFixed(1)}pt wide; only ${(width - indent).toFixed(1)}pt is available.`);
      const pad = BODY_SIZE * 0.3;
      const height = box.ascent + box.descent + pad * 2;
      return {
        height,
        draw(page, x, top) {
          const left = block.align === "left" ? x + indent : x + indent + (width - indent - box.width) / 2;
          box.draw(page, left, top - pad - box.ascent);
        },
      };
    }
    case "table": return typesetTable(block, fonts, width);
    case "figure": {
      const { diagram } = block;
      if (diagram.w > width + 0.5) throw new Error(`Figure is ${diagram.w.toFixed(1)}pt wide; only ${width.toFixed(1)}pt is available.`);
      return {
        height: diagram.h,
        draw(page, x, top) {
          const left = block.align === "left" ? x : x + (width - diagram.w) / 2;
          drawDiagram(page, diagram, left, top, fonts);
        },
      };
    }
    case "gap": return { height: block.h, draw() {} };
  }
}

export type StackEntry = {
  item: Laid;
  /** Space above this entry. */
  before: number;
  /** A page break may fall immediately above this entry. */
  breakBefore?: boolean;
};

export type Stack = {
  height: number;
  /** Offsets from the top at which a break is allowed, measured to the top of the entry. */
  breaks: number[];
  draw(page: PDFPage, x: number, top: number): void;
};

export function stack(entries: StackEntry[]): Stack {
  let cursor = 0;
  const placed: Array<{ item: Laid; offset: number }> = [];
  const breaks: number[] = [];
  entries.forEach((entry, index) => {
    const before = index === 0 ? 0 : entry.before;
    if (entry.breakBefore && index > 0) breaks.push(cursor + before / 2);
    cursor += before;
    placed.push({ item: entry.item, offset: cursor });
    cursor += entry.item.height;
  });
  return {
    height: cursor,
    breaks,
    draw(page, x, top) {
      for (const { item, offset } of placed) item.draw(page, x, top - offset);
    },
  };
}

/** Wraps blocks with paragraph spacing, used for stems, prompts and worked solutions. */
export function typesetBlocks(blocks: ShadowBlock[], fonts: ShadowFonts, width: number): Laid[] {
  return blocks.map((block) => typesetBlock(block, fonts, width));
}

export function blockGap(previous: ShadowBlock | undefined, next: ShadowBlock) {
  if (!previous) return 0;
  if (next.b === "gap" || previous.b === "gap") return 0;
  if (next.b === "figure" || previous.b === "figure" || next.b === "table" || previous.b === "table") return PARAGRAPH_GAP + 4;
  return PARAGRAPH_GAP;
}
