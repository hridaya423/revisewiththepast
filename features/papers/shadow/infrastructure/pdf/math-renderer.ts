import type { PDFFont, PDFPage } from "pdf-lib";

import type { ShadowMathNode, ShadowMathOperator } from "../../contracts/shadow-paper";
import { INK, drawText, measureText, type ShadowFonts } from "./fonts";

export const MATH_RENDERER_VERSION = "shadow-vector-math-v1";

/** A typeset maths box. Coordinates are PDF points with y increasing upwards from the baseline. */
export type MathBox = {
  width: number;
  ascent: number;
  descent: number;
  draw(page: PDFPage, x: number, baseline: number): void;
};

const relations = new Set<ShadowMathOperator>(["=", "<", ">", "≤", "≥", "≠", "∝", "≈"]);
const binaries = new Set<ShadowMathOperator>(["+", "−", "×", "÷", "±", ":"]);
const symbolOnly = new Set<ShadowMathOperator>(["−", "≤", "≥", "≠", "∝", "π", "≈"]);
const unaryContext = new Set<ShadowMathOperator>(["=", "<", ">", "≤", "≥", "≠", "∝", "≈", "+", "−", "×", "÷", "±", ":", "(", ",", "£"]);

const TEXT_ASCENT = 0.68;
const TEXT_DESCENT = 0.21;
const RULE = 0.55;

function textBox(value: string, font: PDFFont, fonts: ShadowFonts, size: number, color = INK): MathBox {
  const width = measureText(value, font, fonts.symbol, size);
  return {
    width,
    ascent: TEXT_ASCENT * size,
    descent: TEXT_DESCENT * size,
    draw: (page, x, baseline) => { drawText(page, value, { x, y: baseline, size, font, symbol: fonts.symbol, color }); },
  };
}

function spaceBox(width: number): MathBox {
  return { width, ascent: 0, descent: 0, draw: () => {} };
}

function row(boxes: MathBox[]): MathBox {
  return {
    width: boxes.reduce((sum, box) => sum + box.width, 0),
    ascent: Math.max(0, ...boxes.map((box) => box.ascent)),
    descent: Math.max(0, ...boxes.map((box) => box.descent)),
    draw: (page, x, baseline) => {
      let cursor = x;
      for (const box of boxes) {
        box.draw(page, cursor, baseline);
        cursor += box.width;
      }
    },
  };
}

function strokePath(page: PDFPage, points: Array<[number, number]>, thickness: number) {
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1]!;
    const [x2, y2] = points[index]!;
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: INK, lineCap: 1 });
  }
}

function delimiterBox(kind: "(" | ")" | "[" | "]", height: number, axis: number, size: number, fonts: ShadowFonts): MathBox {
  if (height <= 1.15 * size) return textBox(kind, fonts.roman, fonts, size);
  const width = Math.min(0.42 * size, 0.18 * size + 0.04 * height);
  const half = height / 2;
  return {
    width: width + 0.08 * size,
    ascent: axis + half,
    descent: Math.max(0, half - axis),
    draw: (page, x, baseline) => {
      const top = baseline + axis + half;
      const bottom = baseline + axis - half;
      const inner = kind === "(" || kind === "[" ? x + width : x + 0.08 * size;
      const outer = kind === "(" || kind === "[" ? x + 0.06 * size : x + width;
      if (kind === "[" || kind === "]") {
        strokePath(page, [[inner, top], [outer, top], [outer, bottom], [inner, bottom]], 0.7);
        return;
      }
      const steps = 18;
      const points: Array<[number, number]> = [];
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const y = top + (bottom - top) * t;
        const bulge = Math.sin(Math.PI * t);
        points.push([inner + (outer - inner) * bulge, y]);
      }
      strokePath(page, points, 0.75);
    },
  };
}

type Context = { fonts: ShadowFonts; size: number };

function operatorBox(operator: ShadowMathOperator, previous: ShadowMathNode | undefined, context: Context): MathBox {
  const { fonts, size } = context;
  const font = symbolOnly.has(operator) ? fonts.symbol : fonts.roman;
  const glyph = textBox(operator, font, fonts, size);
  const unary = operator === "−" && (!previous || (previous.k === "o" && unaryContext.has(previous.v)));
  if (unary || operator === "π" || operator === "°" || operator === "(" || operator === ")" || operator === "%" || operator === "£") return glyph;
  if (operator === ",") return row([glyph, spaceBox(0.3 * size)]);
  const gap = relations.has(operator) ? 0.3 * size : binaries.has(operator) ? 0.24 * size : 0;
  return row([spaceBox(gap), glyph, spaceBox(gap)]);
}

function fractionBox(numerator: MathBox, denominator: MathBox, size: number): MathBox {
  const axis = 0.26 * size;
  const pad = 0.12 * size;
  const gap = 0.16 * size;
  const width = Math.max(numerator.width, denominator.width) + 2 * pad;
  const numeratorBaseline = axis + RULE / 2 + gap + numerator.descent;
  const denominatorBaseline = axis - RULE / 2 - gap - denominator.ascent;
  return {
    width: width + 0.24 * size,
    ascent: numeratorBaseline + numerator.ascent,
    descent: Math.max(0, -(denominatorBaseline - denominator.descent)),
    draw: (page, x, baseline) => {
      const left = x + 0.12 * size;
      numerator.draw(page, left + (width - numerator.width) / 2, baseline + numeratorBaseline);
      denominator.draw(page, left + (width - denominator.width) / 2, baseline + denominatorBaseline);
      page.drawLine({ start: { x: left, y: baseline + axis }, end: { x: left + width, y: baseline + axis }, thickness: RULE, color: INK });
    },
  };
}

function radicalBox(body: MathBox, size: number): MathBox {
  const top = body.ascent + 0.16 * size;
  const bottom = -(Math.max(body.descent, 0.06 * size) + 0.06 * size);
  const radicalWidth = 0.52 * size + 0.04 * (top - bottom);
  const overhang = 0.08 * size;
  return {
    width: radicalWidth + body.width + overhang + 0.04 * size,
    ascent: top + RULE,
    descent: -bottom,
    draw: (page, x, baseline) => {
      const yTop = baseline + top;
      const yBottom = baseline + bottom;
      const tickY = yBottom + 0.42 * (top - bottom) * 0.62;
      strokePath(page, [[x + 0.02 * size, tickY], [x + 0.16 * radicalWidth, tickY + 0.08 * size]], 0.55);
      strokePath(page, [[x + 0.16 * radicalWidth, tickY + 0.08 * size], [x + 0.44 * radicalWidth, yBottom]], 1.05);
      strokePath(page, [[x + 0.44 * radicalWidth, yBottom], [x + radicalWidth, yTop], [x + radicalWidth + body.width + overhang, yTop]], 0.55);
      body.draw(page, x + radicalWidth + overhang / 2, baseline);
    },
  };
}

function superscriptBox(base: MathBox, exponent: MathBox, size: number, baseIsGroup: boolean): MathBox {
  const raise = Math.max(0.4 * size, base.ascent - (baseIsGroup ? 0.22 : 0.3) * size);
  return {
    width: base.width + 0.05 * size + exponent.width,
    ascent: Math.max(base.ascent, raise + exponent.ascent),
    descent: Math.max(base.descent, exponent.descent - raise),
    draw: (page, x, baseline) => {
      base.draw(page, x, baseline);
      exponent.draw(page, x + base.width + 0.05 * size, baseline + raise);
    },
  };
}

function stackBox(top: MathBox, bottom: MathBox, size: number): MathBox {
  const axis = 0.26 * size;
  const gap = 0.3 * size;
  const width = Math.max(top.width, bottom.width);
  const topBaseline = axis + gap / 2 + top.descent;
  const bottomBaseline = axis - gap / 2 - bottom.ascent;
  return {
    width,
    ascent: topBaseline + top.ascent,
    descent: Math.max(0, -(bottomBaseline - bottom.descent)),
    draw: (page, x, baseline) => {
      top.draw(page, x + (width - top.width) / 2, baseline + topBaseline);
      bottom.draw(page, x + (width - bottom.width) / 2, baseline + bottomBaseline);
    },
  };
}

function wrapInDelimiters(body: MathBox, open: "(" | "[", close: ")" | "]", context: Context): MathBox {
  const axis = 0.26 * context.size;
  const height = 2 * Math.max(body.ascent - axis, body.descent + axis) + 0.12 * context.size;
  const left = delimiterBox(open, height, axis, context.size, context.fonts);
  const right = delimiterBox(close, height, axis, context.size, context.fonts);
  return row([left, spaceBox(0.03 * context.size), body, spaceBox(0.03 * context.size), right]);
}

function layoutList(nodes: ShadowMathNode[], context: Context): MathBox {
  const boxes: MathBox[] = [];
  nodes.forEach((node, index) => {
    const previous = nodes[index - 1];
    if (previous?.k === "n" && node.k === "frac") boxes.push(spaceBox(0.06 * context.size));
    boxes.push(layoutNode(node, previous, context));
  });
  return row(boxes);
}

function layoutNode(node: ShadowMathNode, previous: ShadowMathNode | undefined, context: Context): MathBox {
  const { fonts, size } = context;
  switch (node.k) {
    case "n": return textBox(node.v, fonts.roman, fonts, size);
    case "v": return textBox(node.v, fonts.italic, fonts, size);
    case "t": return textBox(node.v, fonts.roman, fonts, size);
    case "o": return operatorBox(node.v, previous, context);
    case "sp": return spaceBox(0.22 * size);
    case "frac": {
      const child = { fonts, size: Math.max(7, size * 0.88) };
      return fractionBox(layoutList(node.n, child), layoutList(node.d, child), size);
    }
    case "sup": {
      const base = layoutList(node.b, context);
      const exponent = layoutList(node.e, { fonts, size: Math.max(6, size * 0.64) });
      return superscriptBox(base, exponent, size, node.b.length === 1 && node.b[0]!.k === "group");
    }
    case "sqrt": return radicalBox(layoutList(node.b, context), size);
    case "group": return wrapInDelimiters(layoutList(node.b, context), node.delim === "()" ? "(" : "[", node.delim === "()" ? ")" : "]", context);
    case "vec": {
      const child = { fonts, size };
      return wrapInDelimiters(stackBox(layoutList(node.top, child), layoutList(node.bottom, child), size), "(", ")", context);
    }
  }
}

export function layoutMath(nodes: ShadowMathNode[], fonts: ShadowFonts, size: number): MathBox {
  if (!Number.isFinite(size) || size < 5 || size > 40) throw new Error(`Unsupported maths size ${size}.`);
  const box = layoutList(nodes, { fonts, size });
  if (![box.width, box.ascent, box.descent].every(Number.isFinite)) throw new Error("Maths layout produced non-finite dimensions.");
  if (box.width > 470 || box.ascent + box.descent > 200) throw new Error("Maths expression exceeds the printable bounds.");
  return box;
}
