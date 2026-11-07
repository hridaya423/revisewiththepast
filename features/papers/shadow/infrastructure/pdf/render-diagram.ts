import { rgb, type PDFPage } from "pdf-lib";

import type { ShadowDiagram, ShadowDiagramItem } from "../../contracts/shadow-paper";
import { GRID, GRID_MAJOR, INK, LIGHT, SHADE, WHITE, type ShadowFonts } from "./fonts";
import { typesetSingleLine } from "./layout";

const DASH = [3, 2.2];
const fmt = (value: number) => (Math.round(value * 1000) / 1000).toString();

function lineTone(tone: Extract<ShadowDiagramItem, { d: "line" }>["tone"]) {
  if (tone === "grid") return GRID;
  if (tone === "gridMajor") return GRID_MAJOR;
  return INK;
}

function rectPath(item: Extract<ShadowDiagramItem, { d: "rect" }>) {
  const radius = Math.min(item.radius ?? 0, item.w / 2, item.h / 2);
  const { x, y, w, h } = item;
  if (radius <= 0) return `M ${fmt(x)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y)} L ${fmt(x + w)} ${fmt(y + h)} L ${fmt(x)} ${fmt(y + h)} Z`;
  const r = fmt(radius);
  return [
    `M ${fmt(x + radius)} ${fmt(y)}`,
    `L ${fmt(x + w - radius)} ${fmt(y)}`,
    `A ${r} ${r} 0 0 1 ${fmt(x + w)} ${fmt(y + radius)}`,
    `L ${fmt(x + w)} ${fmt(y + h - radius)}`,
    `A ${r} ${r} 0 0 1 ${fmt(x + w - radius)} ${fmt(y + h)}`,
    `L ${fmt(x + radius)} ${fmt(y + h)}`,
    `A ${r} ${r} 0 0 1 ${fmt(x)} ${fmt(y + h - radius)}`,
    `L ${fmt(x)} ${fmt(y + radius)}`,
    `A ${r} ${r} 0 0 1 ${fmt(x + radius)} ${fmt(y)}`,
    "Z",
  ].join(" ");
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number, half: "full" | "upper" | "lower") {
  const left = `${fmt(cx - rx)} ${fmt(cy)}`;
  const right = `${fmt(cx + rx)} ${fmt(cy)}`;
  const radii = `${fmt(rx)} ${fmt(ry)}`;
  // SVG coordinates grow downwards, so a clockwise sweep from the left point passes over the top.
  if (half === "upper") return `M ${left} A ${radii} 0 0 1 ${right}`;
  if (half === "lower") return `M ${left} A ${radii} 0 0 0 ${right}`;
  return `M ${left} A ${radii} 0 0 1 ${right} A ${radii} 0 0 1 ${left} Z`;
}

function arrowHead(tipX: number, tipY: number, fromX: number, fromY: number, size: number) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = Math.PI / 7;
  const a = [tipX - size * Math.cos(angle - spread), tipY - size * Math.sin(angle - spread)];
  const b = [tipX - size * Math.cos(angle + spread), tipY - size * Math.sin(angle + spread)];
  return `M ${fmt(tipX)} ${fmt(tipY)} L ${fmt(a[0]!)} ${fmt(a[1]!)} L ${fmt(b[0]!)} ${fmt(b[1]!)} Z`;
}

function drawItem(page: PDFPage, item: ShadowDiagramItem, left: number, top: number, fonts: ShadowFonts) {
  const origin = { x: left, y: top };
  switch (item.d) {
    case "line": {
      const width = item.w ?? 0.8;
      const color = lineTone(item.tone);
      page.drawSvgPath(`M ${fmt(item.x1)} ${fmt(item.y1)} L ${fmt(item.x2)} ${fmt(item.y2)}`, {
        ...origin,
        borderColor: color,
        borderWidth: width,
        ...(item.dash ? { borderDashArray: DASH } : {}),
      });
      const size = Math.max(5, width * 5.5);
      if (item.arrow === "end" || item.arrow === "both") page.drawSvgPath(arrowHead(item.x2, item.y2, item.x1, item.y1, size), { ...origin, color });
      if (item.arrow === "both") page.drawSvgPath(arrowHead(item.x1, item.y1, item.x2, item.y2, size), { ...origin, color });
      return;
    }
    case "poly": {
      const path = item.pts.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y)}`).join(" ") + (item.closed ? " Z" : "");
      page.drawSvgPath(path, {
        ...origin,
        ...(item.fill === "shade" && item.closed ? { color: SHADE } : {}),
        borderColor: INK,
        borderWidth: item.w ?? 0.9,
        ...(item.dash ? { borderDashArray: DASH } : {}),
      });
      return;
    }
    case "circle": {
      if (item.fill === "sphere") {
        // Concentric discs shift towards an upper-left highlight to suggest a lit sphere in greyscale print.
        const steps = 14;
        for (let index = 0; index < steps; index += 1) {
          const t = index / steps;
          const r = item.r * (1 - t * 0.92);
          const shift = item.r * 0.38 * t;
          const tone = 0.52 + 0.45 * t;
          page.drawSvgPath(ellipsePath(item.cx - shift, item.cy - shift, r, r, "full"), { ...origin, color: rgb(tone, tone, tone) });
        }
        page.drawSvgPath(ellipsePath(item.cx, item.cy, item.r, item.r, "full"), { ...origin, borderColor: INK, borderWidth: item.w ?? 0.6 });
        return;
      }
      page.drawSvgPath(ellipsePath(item.cx, item.cy, item.r, item.r, "full"), {
        ...origin,
        ...(item.fill === "shade" ? { color: SHADE } : {}),
        borderColor: INK,
        borderWidth: item.w ?? 0.9,
        ...(item.dash ? { borderDashArray: DASH } : {}),
      });
      return;
    }
    case "ellipse": {
      page.drawSvgPath(ellipsePath(item.cx, item.cy, item.rx, item.ry, item.half ?? "full"), {
        ...origin,
        borderColor: INK,
        borderWidth: item.w ?? 0.9,
        ...(item.dash ? { borderDashArray: DASH } : {}),
      });
      return;
    }
    case "rect": {
      const fill = item.fill === "shade" ? SHADE : item.fill === "light" ? LIGHT : item.fill === "white" ? WHITE : undefined;
      page.drawSvgPath(rectPath(item), {
        ...origin,
        ...(fill ? { color: fill } : {}),
        ...(item.stroke === false ? {} : { borderColor: INK, borderWidth: item.lineWidth ?? 0.9 }),
      });
      return;
    }
    case "text": {
      const label = typesetSingleLine(item.runs, fonts, { size: item.size ?? 10, bold: item.bold });
      const anchorOffset = item.anchor === "middle" ? label.width / 2 : item.anchor === "end" ? label.width : 0;
      label.draw(page, left + item.x - anchorOffset, top - item.y);
      return;
    }
  }
}

/** Paints a diagram at its natural size; `top` is the PDF y of the diagram's top edge. */
export function drawDiagram(page: PDFPage, diagram: ShadowDiagram, left: number, top: number, fonts: ShadowFonts) {
  for (const item of diagram.items) drawItem(page, item, left, top, fonts);
}
