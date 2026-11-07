import type { ShadowDiagram, ShadowDiagramItem, ShadowInline } from "../contracts/shadow-paper";
import { inlinePlainText, math, text } from "./content";
import { check, type ShadowCheck } from "./types";

export const POINTS_PER_CM = 72 / 2.54;

/** Diagram coordinates are points from the top-left corner, with y increasing downwards. */
export class DiagramBuilder {
  readonly items: ShadowDiagramItem[] = [];

  constructor(readonly width: number, readonly height: number) {}

  line(x1: number, y1: number, x2: number, y2: number, options: Omit<Extract<ShadowDiagramItem, { d: "line" }>, "d" | "x1" | "y1" | "x2" | "y2"> = {}) {
    this.items.push({ d: "line", x1, y1, x2, y2, ...options });
    return this;
  }

  poly(points: Array<[number, number]>, options: { closed?: boolean; fill?: "none" | "shade"; w?: number; dash?: boolean } = {}) {
    this.items.push({ d: "poly", pts: points, closed: options.closed ?? true, ...(options.fill ? { fill: options.fill } : {}), ...(options.w ? { w: options.w } : {}), ...(options.dash ? { dash: true } : {}) });
    return this;
  }

  circle(cx: number, cy: number, r: number, options: { fill?: "none" | "shade" | "sphere"; w?: number; dash?: boolean } = {}) {
    this.items.push({ d: "circle", cx, cy, r, ...options });
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, options: { half?: "full" | "upper" | "lower"; w?: number; dash?: boolean } = {}) {
    this.items.push({ d: "ellipse", cx, cy, rx, ry, ...options });
    return this;
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: "none" | "shade" | "light" | "white"; stroke?: boolean; radius?: number; lineWidth?: number } = {}) {
    this.items.push({ d: "rect", x, y, w, h, ...options });
    return this;
  }

  label(x: number, y: number, runs: ShadowInline[] | string, options: { size?: number; anchor?: "start" | "middle" | "end"; bold?: boolean } = {}) {
    this.items.push({ d: "text", x, y, runs: typeof runs === "string" ? [text(runs)] : runs, ...options });
    return this;
  }

  build(scale: ShadowDiagram["scale"], description: string): ShadowDiagram {
    return { w: this.width, h: this.height, items: this.items, scale, description };
  }
}

export type GridAxes = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Points per axis unit. */
  unit: number;
  minorPerUnit: number;
  labelStep: number;
  margin: { left: number; right: number; top: number; bottom: number };
};

export type CalibratedGrid = {
  builder: DiagramBuilder;
  toDiagram(x: number, y: number): [number, number];
  fromDiagram(px: number, py: number): [number, number];
  axes: GridAxes;
};

function formatAxisNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded < 0 ? [math("−", String(-rounded))] : [math(String(rounded))];
}

function backedLabel(builder: DiagramBuilder, x: number, y: number, runs: ShadowInline[], anchor: "middle" | "end") {
  const box = estimateLabelBox({ d: "text", x, y, runs, size: 9, anchor });
  builder.rect(box.x0 - 1, box.y0, box.x1 - box.x0 + 2, box.y1 - box.y0, { fill: "white", stroke: false });
  builder.label(x, y, runs, { size: 9, anchor });
}

/** A coordinate grid whose axis units map to an exact number of points, so read-off questions stay calibrated. */
export function coordinateGrid(axes: GridAxes): CalibratedGrid {
  const width = (axes.xMax - axes.xMin) * axes.unit + axes.margin.left + axes.margin.right;
  const height = (axes.yMax - axes.yMin) * axes.unit + axes.margin.top + axes.margin.bottom;
  const builder = new DiagramBuilder(width, height);
  const toDiagram = (x: number, y: number): [number, number] => [
    axes.margin.left + (x - axes.xMin) * axes.unit,
    axes.margin.top + (axes.yMax - y) * axes.unit,
  ];
  const fromDiagram = (px: number, py: number): [number, number] => [
    axes.xMin + (px - axes.margin.left) / axes.unit,
    axes.yMax - (py - axes.margin.top) / axes.unit,
  ];
  const [left, top] = toDiagram(axes.xMin, axes.yMax);
  const [right, bottom] = toDiagram(axes.xMax, axes.yMin);
  const steps = axes.minorPerUnit;
  for (let index = 0; index <= (axes.xMax - axes.xMin) * steps; index += 1) {
    const x = left + (index * axes.unit) / steps;
    const major = index % steps === 0;
    builder.line(x, top, x, bottom, { w: major ? 0.5 : 0.25, tone: major ? "gridMajor" : "grid" });
  }
  for (let index = 0; index <= (axes.yMax - axes.yMin) * steps; index += 1) {
    const y = top + (index * axes.unit) / steps;
    const major = index % steps === 0;
    builder.line(left, y, right, y, { w: major ? 0.5 : 0.25, tone: major ? "gridMajor" : "grid" });
  }
  const [originX, originY] = toDiagram(0, 0);
  if (axes.yMin <= 0 && axes.yMax >= 0) builder.line(left, originY, right + 12, originY, { w: 1, arrow: "end" });
  if (axes.xMin <= 0 && axes.xMax >= 0) builder.line(originX, bottom, originX, top - 12, { w: 1, arrow: "end" });
  builder.label(right + 16, originY + 4, [math("x")], { size: 10 });
  builder.label(originX - 5, top - 6, [math("y")], { size: 10, anchor: "end" });
  for (let x = Math.ceil(axes.xMin / axes.labelStep) * axes.labelStep; x <= axes.xMax; x += axes.labelStep) {
    if (x === 0) continue;
    const [px] = toDiagram(x, 0);
    backedLabel(builder, px, originY + 12, formatAxisNumber(x), "middle");
  }
  for (let y = Math.ceil(axes.yMin / axes.labelStep) * axes.labelStep; y <= axes.yMax; y += axes.labelStep) {
    if (y === 0) continue;
    const [, py] = toDiagram(0, y);
    backedLabel(builder, originX - 4, py + 3, formatAxisNumber(y), "end");
  }
  backedLabel(builder, originX - 4, originY + 12, [math("O")], "end");
  return { builder, toDiagram, fromDiagram, axes };
}

/** Clips the line ax + by = c to the grid window, returning diagram endpoints. */
export function clipLineToWindow(a: number, b: number, c: number, axes: Pick<GridAxes, "xMin" | "xMax" | "yMin" | "yMax">): Array<[number, number]> {
  const candidates: Array<[number, number]> = [];
  if (b !== 0) {
    for (const x of [axes.xMin, axes.xMax]) candidates.push([x, (c - a * x) / b]);
  }
  if (a !== 0) {
    for (const y of [axes.yMin, axes.yMax]) candidates.push([(c - b * y) / a, y]);
  }
  const epsilon = 1e-9;
  const inside = candidates.filter(([x, y]) => x >= axes.xMin - epsilon && x <= axes.xMax + epsilon && y >= axes.yMin - epsilon && y <= axes.yMax + epsilon);
  const unique: Array<[number, number]> = [];
  for (const point of inside) {
    if (!unique.some(([x, y]) => Math.abs(x - point[0]) < 1e-7 && Math.abs(y - point[1]) < 1e-7)) unique.push(point);
  }
  if (unique.length < 2) throw new Error("Line does not cross the grid window.");
  unique.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return [unique[0]!, unique.at(-1)!];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

export function estimateLabelBox(item: Extract<ShadowDiagramItem, { d: "text" }>): Box {
  const size = item.size ?? 10;
  const characters = inlinePlainText(item.runs).length;
  const hasFraction = item.runs.some((run) => run.t === "math" && run.m.some((node) => node.k === "frac"));
  const width = Math.max(size * 0.5, characters * size * (hasFraction ? 0.32 : 0.5));
  const anchorOffset = item.anchor === "middle" ? width / 2 : item.anchor === "end" ? width : 0;
  const ascent = hasFraction ? size * 1.2 : size * 0.72;
  const descent = hasFraction ? size * 0.6 : size * 0.22;
  return { x0: item.x - anchorOffset, x1: item.x - anchorOffset + width, y0: item.y - ascent, y1: item.y + descent };
}

function overlaps(left: Box, right: Box) {
  return left.x0 < right.x1 && right.x0 < left.x1 && left.y0 < right.y1 && right.y0 < left.y1;
}

function itemBounds(item: ShadowDiagramItem): Box {
  switch (item.d) {
    case "line": return { x0: Math.min(item.x1, item.x2), x1: Math.max(item.x1, item.x2), y0: Math.min(item.y1, item.y2), y1: Math.max(item.y1, item.y2) };
    case "poly": return {
      x0: Math.min(...item.pts.map(([x]) => x)), x1: Math.max(...item.pts.map(([x]) => x)),
      y0: Math.min(...item.pts.map(([, y]) => y)), y1: Math.max(...item.pts.map(([, y]) => y)),
    };
    case "circle": return { x0: item.cx - item.r, x1: item.cx + item.r, y0: item.cy - item.r, y1: item.cy + item.r };
    case "ellipse": return {
      x0: item.cx - item.rx, x1: item.cx + item.rx,
      y0: item.half === "lower" ? item.cy : item.cy - item.ry,
      y1: item.half === "upper" ? item.cy : item.cy + item.ry,
    };
    case "rect": return { x0: item.x, x1: item.x + item.w, y0: item.y, y1: item.y + item.h };
    case "text": return estimateLabelBox(item);
  }
}

export function validateDiagram(diagram: ShadowDiagram, name = "diagram"): ShadowCheck[] {
  const tolerance = 1;
  const outside = diagram.items.filter((item) => {
    const box = itemBounds(item);
    return box.x0 < -tolerance || box.y0 < -tolerance || box.x1 > diagram.w + tolerance || box.y1 > diagram.h + tolerance;
  });
  const labels = diagram.items.filter((item): item is Extract<ShadowDiagramItem, { d: "text" }> => item.d === "text").map(estimateLabelBox);
  const collisions: string[] = [];
  labels.forEach((label, index) => {
    for (let other = index + 1; other < labels.length; other += 1) {
      if (overlaps(label, labels[other]!)) collisions.push(`${index}/${other}`);
    }
  });
  return [
    check(`${name}:within-bounds`, outside.length === 0, `${outside.length} items fall outside the ${diagram.w.toFixed(0)}×${diagram.h.toFixed(0)} frame`),
    check(`${name}:labels-separate`, collisions.length === 0, `Overlapping labels ${collisions.slice(0, 4).join(", ")}`),
    check(`${name}:finite`, diagram.items.every((item) => Object.values(item).every((value) => typeof value !== "number" || Number.isFinite(value)))),
  ];
}

export function diagramLabels(diagram: ShadowDiagram) {
  return diagram.items.flatMap((item) => (item.d === "text" ? [inlinePlainText(item.runs)] : []));
}
