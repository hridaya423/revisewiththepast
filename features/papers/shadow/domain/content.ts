import type {
  ShadowAnswerSpace,
  ShadowBlock,
  ShadowDiagram,
  ShadowInline,
  ShadowMathNode,
  ShadowMathOperator,
} from "../contracts/shadow-paper";
import { Rational, formatDecimal, isTerminatingDecimal } from "./rational";

export type MathInput = ShadowMathNode | MathInput[] | string | number | Rational;

const operatorMap: Record<string, ShadowMathOperator> = {
  "+": "+", "-": "−", "−": "−", "×": "×", "*": "×", "÷": "÷", "=": "=", ":": ":", "<": "<", ">": ">",
  "≤": "≤", "≥": "≥", "±": "±", ",": ",", "π": "π", "°": "°", "(": "(", ")": ")", "%": "%", "£": "£", "∝": "∝", "≠": "≠", "≈": "≈",
};

/**
 * Converts a compact maths string into typed nodes: digit runs become numerals,
 * letters become italic variables, and known symbols become operators. Unknown
 * characters throw, so template text can never smuggle markup into the renderer.
 */
export function parseMath(source: string): ShadowMathNode[] {
  const nodes: ShadowMathNode[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === " ") { index += 1; continue; }
    const numeral = /^\d+(?:\.\d+)?/u.exec(source.slice(index));
    if (numeral) { nodes.push({ k: "n", v: numeral[0] }); index += numeral[0].length; continue; }
    if (/[A-Za-z]/u.test(char)) { nodes.push({ k: "v", v: char }); index += 1; continue; }
    const operator = operatorMap[char];
    if (!operator) throw new Error(`Unsupported maths character "${char}" in "${source}".`);
    nodes.push({ k: "o", v: operator });
    index += 1;
  }
  return nodes;
}

export function rationalNodes(value: Rational, options: { mixed?: boolean } = {}): ShadowMathNode[] {
  const sign: ShadowMathNode[] = value.sign() < 0 ? [{ k: "o", v: "−" }] : [];
  const magnitude = value.abs();
  if (magnitude.isInteger()) return [...sign, { k: "n", v: magnitude.n.toString() }];
  if (options.mixed && magnitude.n > magnitude.d) {
    const whole = magnitude.n / magnitude.d;
    const remainder = magnitude.n % magnitude.d;
    return [...sign, { k: "n", v: whole.toString() }, { k: "frac", n: [{ k: "n", v: remainder.toString() }], d: [{ k: "n", v: magnitude.d.toString() }] }];
  }
  return [...sign, { k: "frac", n: [{ k: "n", v: magnitude.n.toString() }], d: [{ k: "n", v: magnitude.d.toString() }] }];
}

export function decimalNodes(value: Rational, places?: number): ShadowMathNode[] {
  const text = formatDecimal(value, places);
  return text.startsWith("-") ? [{ k: "o", v: "−" }, { k: "n", v: text.slice(1) }] : [{ k: "n", v: text }];
}

export function M(...inputs: MathInput[]): ShadowMathNode[] {
  const out: ShadowMathNode[] = [];
  for (const input of inputs) {
    if (typeof input === "string") out.push(...parseMath(input));
    else if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Cannot typeset a non-finite number.");
      out.push(...parseMath(input < 0 ? `-${String(-input)}` : String(input)));
    } else if (input instanceof Rational) out.push(...(isTerminatingDecimal(input) && !input.isInteger() ? decimalNodes(input) : rationalNodes(input)));
    else if (Array.isArray(input)) out.push(...M(...input));
    else out.push(input);
  }
  return out;
}

export const frac = (numerator: MathInput, denominator: MathInput): ShadowMathNode => ({ k: "frac", n: M(numerator), d: M(denominator) });
export const sup = (base: MathInput, exponent: MathInput): ShadowMathNode => ({ k: "sup", b: M(base), e: M(exponent) });
export const sqrt = (body: MathInput): ShadowMathNode => ({ k: "sqrt", b: M(body) });
export const paren = (body: MathInput, delim: "()" | "[]" = "()"): ShadowMathNode => ({ k: "group", b: M(body), delim });
export const vec = (top: MathInput, bottom: MathInput): ShadowMathNode => ({ k: "vec", top: M(top), bottom: M(bottom) });
export const upright = (text: string): ShadowMathNode => ({ k: "t", v: text });
export const space: ShadowMathNode = { k: "sp" };
export const unit = (name: string): ShadowMathNode[] => [space, upright(name)];
export const fn = (name: string): ShadowMathNode[] => [upright(name), space];
export const fracR = (value: Rational) => rationalNodes(value);
export const mixedR = (value: Rational) => rationalNodes(value, { mixed: true });

export const text = (value: string): ShadowInline => ({ t: "text", v: value });
export const bold = (value: string): ShadowInline => ({ t: "text", v: value, style: "b" });
export const italic = (value: string): ShadowInline => ({ t: "text", v: value, style: "i" });
export const math = (...inputs: MathInput[]): ShadowInline => ({ t: "math", m: M(...inputs) });

type RunInput = ShadowInline | string;
const toRuns = (runs: RunInput[]): ShadowInline[] => runs.map((run) => (typeof run === "string" ? text(run) : run));

export const p = (...runs: RunInput[]): ShadowBlock => ({ b: "p", runs: toRuns(runs) });
export const pIndent = (indent: number, ...runs: RunInput[]): ShadowBlock => ({ b: "p", runs: toRuns(runs), indent });
export const display = (...inputs: MathInput[]): ShadowBlock => ({ b: "math", m: M(...inputs), align: "center" });
export const displayLeft = (indent: number, ...inputs: MathInput[]): ShadowBlock => ({ b: "math", m: M(...inputs), align: "left", indent });
export const gap = (height: number): ShadowBlock => ({ b: "gap", h: height });
export const figure = (diagram: ShadowDiagram): ShadowBlock => ({ b: "figure", diagram, align: "center" });
export const cell = (...runs: RunInput[]): ShadowInline[] => toRuns(runs);
export const table = (rows: ShadowInline[][][], options: Omit<Extract<ShadowBlock, { b: "table" }>, "b" | "rows"> = {}): ShadowBlock => ({ b: "table", rows, ...options });

export const answerLine = (prefix?: RunInput[], suffix?: RunInput[]): ShadowAnswerSpace => ({
  kind: "line",
  ...(prefix ? { prefix: toRuns(prefix) } : {}),
  ...(suffix ? { suffix: toRuns(suffix) } : {}),
});
export const answerLines = (...lines: Array<{ prefix?: RunInput[]; suffix?: RunInput[] }>): ShadowAnswerSpace => ({
  kind: "multi",
  lines: lines.map((line) => ({
    ...(line.prefix ? { prefix: toRuns(line.prefix) } : {}),
    ...(line.suffix ? { suffix: toRuns(line.suffix) } : {}),
  })),
});

const operatorText: Partial<Record<ShadowMathOperator, string>> = { "−": "-" };

export function mathPlainText(nodes: ShadowMathNode[]): string {
  return nodes.map((node) => {
    switch (node.k) {
      case "n":
      case "v":
      case "t": return node.v;
      case "o": return operatorText[node.v] ?? node.v;
      case "frac": return `(${mathPlainText(node.n)})/(${mathPlainText(node.d)})`;
      case "sup": return `${mathPlainText(node.b)}^(${mathPlainText(node.e)})`;
      case "sqrt": return `sqrt(${mathPlainText(node.b)})`;
      case "group": return `${node.delim[0]}${mathPlainText(node.b)}${node.delim[1]}`;
      case "vec": return `(${mathPlainText(node.top)}; ${mathPlainText(node.bottom)})`;
      case "sp": return " ";
    }
  }).join("");
}

export function inlinePlainText(runs: ShadowInline[]): string {
  return runs.map((run) => (run.t === "text" ? run.v : mathPlainText(run.m))).join("");
}

function diagramPlainText(diagram: ShadowDiagram) {
  return diagram.items.flatMap((item) => (item.d === "text" ? [inlinePlainText(item.runs)] : [])).join(" ");
}

export function blockPlainText(blocks: ShadowBlock[]): string {
  return blocks.map((block) => {
    switch (block.b) {
      case "p": return inlinePlainText(block.runs);
      case "math": return mathPlainText(block.m);
      case "table": return block.rows.map((row) => row.map(inlinePlainText).join(" | ")).join("\n");
      case "figure": return diagramPlainText(block.diagram);
      case "gap": return "";
    }
  }).filter(Boolean).join("\n");
}

/** Numeral tokens visible in text, used for reveal-order and stale-value checks. */
export function numeralTokens(textValue: string): string[] {
  return [...textValue.matchAll(/\d+(?:\.\d+)?/gu)].map((match) => match[0]);
}
