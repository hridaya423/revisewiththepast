import { readFileSync } from "node:fs";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { toPdfCropBox } from "../../domain/crop-geometry";
import { GENERATED_PAGE } from "../../domain/generated-layout";
import { getPdfDocument, loadPdfJsForNode, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";
import type { QuestionIdentityAnchor, QuestionUnit } from "@/shared/domain/paper";

export type CropBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type SourcePdfCandidate = {
  pdfUrl: string;
  sourcePageIndex: number;
};

export type PreparedSnippet = {
  embeddedPage: Awaited<ReturnType<PDFDocument["embedPage"]>>;
  width: number;
  height: number;
  cropBox: CropBox;
};

type RasterizeSourceOptions = {
  sanitizeFurniture?: boolean;
  sourceQuestionNumber?: string;
  numberBounds?: QuestionIdentityAnchor["numberBounds"] | QuestionIdentityAnchor["numberBounds"][];
  promptBounds?: QuestionIdentityAnchor["promptBounds"];
  boardCode?: QuestionUnit["boardCode"];
  cropBox?: CropBox;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type Rectangle = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SanitizedPageMetadata = {
  cropBox?: CropBox;
  hasMeaningfulText: boolean;
  isAdditionalAnswerPage: boolean;
  isIsolatedItemHeading: boolean;
  crossRefs: CrossRefMask[];
  splitGaps: SplitGap[];
};

export type CrossRefMask = {
  bounds: { x0: number; x1: number; y0: number; y1: number };
  baselineY: number;
  fontHeight: number;
  sourceNumber: string;
};

type SourcePage = {
  pdfJsPage: Awaited<ReturnType<Awaited<ReturnType<typeof getPdfDocument>>["getPage"]>>;
  renderedPng: Buffer;
};

export type SourcePdfCache = {
  bytes: Map<string, Uint8Array>;
  documents: Map<string, PDFDocument>;
  sourcePages: Map<string, Promise<SourcePage>>;
};

export function createSourcePdfCache(): SourcePdfCache {
  return {
    bytes: new Map(),
    documents: new Map(),
    sourcePages: new Map(),
  };
}

const sanitizedPageMetadata = new WeakMap<PDFDocument, SanitizedPageMetadata>();

export function sourceBoundsToRasterMask(
  numberBounds: QuestionIdentityAnchor["numberBounds"],
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
): Rectangle {
  const points = [
    viewport.convertToViewportPoint(numberBounds.x0, numberBounds.y0),
    viewport.convertToViewportPoint(numberBounds.x1, numberBounds.y0),
    viewport.convertToViewportPoint(numberBounds.x1, numberBounds.y1),
    viewport.convertToViewportPoint(numberBounds.x0, numberBounds.y1),
  ];
  return {
    left: Math.min(...points.map(([x]) => x)),
    right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    bottom: Math.max(...points.map(([, y]) => y)),
  };
}

const SOURCE_FURNITURE_PATTERN = /do not write|outside the box|turn over|pearson edexcel|copyright|total for (?:question|section|paper)|question\s+\d+\s+continues|end of (?:question paper|section|questions?)|no questions printed|answer in the spaces|additional (?:answer )?page|^pmt$/i;
const MARGIN_QUESTION_LABEL_PATTERN = /^question\s+\d+\b/i;
const SECTION_RUBRIC_PATTERN = /\bquestions?\s+\d+\b[^.]{0,60}\bquestions?\s+\d+\b/i;
const QUESTION_WORD_PATTERN = /^questions?$/i;
const MARGIN_WORD_PATTERN = /^(?:do|not|write|in|this|area|outside|the|box)$/i;

export function isMeaningfulSourceText(text: string) {
  return !/^[.\s_\-\uE000-\uF8FF]+$/u.test(text);
}

function isAdditionalAnswerPage(lines: string[], boardCode?: RasterizeSourceOptions["boardCode"]) {
  const text = lines.join(" ").toLowerCase().replace(/\s+/g, " ");
  if (/additional page, if required|write the question numbers in the left-hand margin|extra answer space/.test(text)) {
    return true;
  }
  if (boardCode === "aqa" && /do not write on this page/.test(text) && /answer in the spaces provided/.test(text)) {
    return true;
  }
  if (boardCode !== "ocr") return false;

  const copyrightStart = lines.findIndex((line) => /^(?:copyright information|ocr is committed\b)/i.test(line));
  const contentLines = copyrightStart >= 0 ? lines.slice(0, copyrightStart) : lines;
  return contentLines.every((line) => (
    !line
    || SOURCE_FURNITURE_PATTERN.test(line)
    || /^\(?\d+\)?$/.test(line)
    || /^\[\d+\]$/.test(line)
    || /^©\s*ocr/i.test(line)
    || /^oxford cambridge and rsa$/i.test(line)
    || /^[._\-\s]+$/.test(line)
    || /^question \d+ continues/i.test(line)
    || /^additional (?:answer )?space/i.test(line)
    || /^extra space(?: for question\b)?/i.test(line)
    || /^end of (?:question paper|section)\b/i.test(line)
  ));
}

function subtractRectangle(rectangle: Rectangle, masks: readonly Rectangle[]) {
  let remainder = [rectangle];

  for (const mask of masks) {
    const nextRemainder: Rectangle[] = [];

    for (const piece of remainder) {
      const left = Math.max(piece.left, mask.left);
      const right = Math.min(piece.right, mask.right);
      const top = Math.max(piece.top, mask.top);
      const bottom = Math.min(piece.bottom, mask.bottom);

      if (left >= right || top >= bottom) {
        nextRemainder.push(piece);
        continue;
      }

      if (piece.top < top) nextRemainder.push({ left: piece.left, right: piece.right, top: piece.top, bottom: top });
      if (bottom < piece.bottom) nextRemainder.push({ left: piece.left, right: piece.right, top: bottom, bottom: piece.bottom });
      if (piece.left < left) nextRemainder.push({ left: piece.left, right: left, top, bottom });
      if (right < piece.right) nextRemainder.push({ left: right, right: piece.right, top, bottom });
    }

    remainder = nextRemainder;
  }

  return remainder;
}

function clearCropBoundary(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  cropBox: CropBox,
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
  scale: number,
) {
  const boundary = sourceBoundsToRasterMask({
    x0: cropBox.left,
    x1: cropBox.right,
    y0: cropBox.bottom,
    y1: cropBox.top,
  }, viewport);
  const thickness = Math.max(2, Math.ceil(scale * 2));
  context.fillStyle = "#fff";
  context.fillRect(boundary.left - thickness, boundary.top - thickness, boundary.right - boundary.left + thickness * 2, thickness * 2);
  context.fillRect(boundary.left - thickness, boundary.bottom - thickness, boundary.right - boundary.left + thickness * 2, thickness * 2);
  context.fillRect(boundary.left - thickness, boundary.top - thickness, thickness * 2, boundary.bottom - boundary.top + thickness * 2);
  context.fillRect(boundary.right - thickness, boundary.top - thickness, thickness * 2, boundary.bottom - boundary.top + thickness * 2);
}

function detectBarcodeMasks(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  protectedTextBounds: readonly Rectangle[],
): Rectangle[] {
  const masks: Rectangle[] = [];
  const bandTop = Math.floor(image.height * 0.82);
  const data = context.getImageData(0, bandTop, image.width, image.height - bandTop).data;
  const width = image.width;
  const height = image.height - bandTop;
  const darkAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return data[offset] + data[offset + 1] + data[offset + 2] < 240;
  };
  // A row of real text ("Delay in minutes") hits the same span/coverage
  // signature as a barcode — never let a barcode row swallow a text row.
  const touchesText = (runLeft: number, lastDark: number, y: number) =>
    protectedTextBounds.some((bounds) =>
      bounds.left < lastDark && bounds.right > runLeft && bounds.top < y + 1 && bounds.bottom > y);
  for (let y = 0; y < height; y += 1) {
    let runLeft = -1;
    let darkCount = 0;
    let lastDark = -1;
    for (let x = 0; x < width; x += 1) {
      if (!darkAt(x, y)) continue;
      if (runLeft < 0) runLeft = x;
      lastDark = x;
      darkCount += 1;
    }
    if (runLeft < 0 || lastDark - runLeft < 30) continue;
    const coverage = darkCount / (lastDark - runLeft + 1);
    if (coverage < 0.3 || coverage > 0.85) continue;
    if (touchesText(runLeft, lastDark, y + bandTop)) continue;
    const existing = masks[masks.length - 1];
    if (existing && Math.abs(existing.left - runLeft) < 20 && Math.abs(existing.right - lastDark) < 20 && y + bandTop - existing.bottom <= 3) {
      existing.bottom = y + bandTop + 1;
      existing.left = Math.min(existing.left, runLeft);
      existing.right = Math.max(existing.right, lastDark);
    } else {
      masks.push({ left: runLeft, right: lastDark, top: y + bandTop, bottom: y + bandTop + 1 });
    }
  }
  return masks
    .filter((mask) => mask.bottom - mask.top >= 8 && mask.right - mask.left >= 30)
    .map((mask) => ({ left: mask.left - 4, right: mask.right + 4, top: mask.top - 4, bottom: mask.bottom + 4 }));
}

function detectEdgeLineMasks(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  cropBounds: Rectangle | null,
): Rectangle[] {
  if (!cropBounds) return [];
  const left = Math.max(0, Math.floor(cropBounds.left));
  const right = Math.min(image.width, Math.ceil(cropBounds.right));
  const top = Math.max(0, Math.floor(cropBounds.top));
  const bottom = Math.min(image.height, Math.ceil(cropBounds.bottom));
  const spanX = right - left;
  const spanY = bottom - top;
  if (spanX < 40 || spanY < 40) return [];
  const depth = Math.min(16, Math.floor(spanX * 0.06));
  const data = context.getImageData(left, top, spanX, spanY).data;
  const darkAt = (x: number, y: number) => {
    const offset = (y * spanX + x) * 4;
    // Frame/border rules print grey (~170-200 per channel) — the near-black
    // threshold misses them. Coverage (>55% of the edge) still gates text.
    return data[offset] + data[offset + 1] + data[offset + 2] < 660;
  };
  const masks: Rectangle[] = [];
  const columnDark = (x: number) => {
    let count = 0;
    for (let y = 0; y < spanY; y += 2) if (darkAt(x, y)) count += 1;
    return count / (spanY / 2);
  };
  const rowDark = (y: number) => {
    let count = 0;
    for (let x = 0; x < spanX; x += 2) if (darkAt(x, y)) count += 1;
    return count / (spanX / 2);
  };
  const columnMask = (fromLeft: boolean) => {
    let best = -1;
    for (let offset = 0; offset < depth; offset += 1) {
      const x = fromLeft ? offset : spanX - 1 - offset;
      if (columnDark(x) > 0.55) best = offset;
    }
    if (best < 0) return;
    masks.push(fromLeft
      ? { left, right: left + best + 2, top, bottom }
      : { left: right - best - 2, right, top, bottom });
  };
  const rowMask = (fromTop: boolean) => {
    const rowDepth = Math.min(10, Math.floor(spanY * 0.04));
    let best = -1;
    for (let offset = 0; offset < rowDepth; offset += 1) {
      const y = fromTop ? offset : spanY - 1 - offset;
      if (rowDark(y) > 0.55) best = offset;
    }
    if (best < 0) return;
    masks.push(fromTop
      ? { left, right, top, bottom: top + best + 2 }
      : { left, right, top: bottom - best - 2, bottom });
  };
  columnMask(true);
  columnMask(false);
  rowMask(true);
  rowMask(false);
  return masks;
}

// AQA answer blocks end with a vector "►" marker (and dash) at the right
// margin — furniture ink that text extraction never reports, so it survives
// into crops and floats alone in whitespace. Mask any small isolated ink
// cluster confined to the right band whose rows carry no ink anywhere else —
// real right-margin text like "[3 marks]" shares its rows with the answer
// rule or prompt, so it never qualifies.
function detectMarginMarkMasks(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  cropBounds: Rectangle | null,
): Rectangle[] {
  const bandLeft = Math.round(image.width * 0.78);
  const bandW = image.width - bandLeft;
  if (bandW < 30) return [];
  const band = context.getImageData(bandLeft, 0, bandW, image.height).data;
  const interior = context.getImageData(0, 0, bandLeft, image.height).data;
  const masks: Rectangle[] = [];
  const rowMinX = new Array<number>(image.height).fill(-1);
  const rowMaxX = new Array<number>(image.height).fill(-1);
  const interiorInked = (y: number) => {
    for (let x = 0; x < bandLeft; x += 3) {
      const offset = (y * bandLeft + x) * 4;
      if (interior[offset] + interior[offset + 1] + interior[offset + 2] < 720) return true;
    }
    return false;
  };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < bandW; x += 1) {
      const offset = (y * bandW + x) * 4;
      if (band[offset] + band[offset + 1] + band[offset + 2] < 420) {
        if (rowMinX[y] < 0) rowMinX[y] = x;
        rowMaxX[y] = x;
      }
    }
  }
  let block: { top: number; bottom: number; left: number; right: number } | null = null;
  const flush = () => {
    if (!block) return;
    const height = block.bottom - block.top + 1;
    // ponytail: a lone right-band mark is furniture; a taller block is a real
    // graphic and any interior ink on its rows means it's part of content.
    const isolated = height >= 4 && height <= 60
      && !(cropBounds && (block.bottom < cropBounds.top || block.top > cropBounds.bottom));
    if (isolated) {
      let clean = true;
      for (let y = block.top; y <= block.bottom; y += 1) {
        if (interiorInked(y)) { clean = false; break; }
      }
      if (clean) {
        masks.push({
          left: bandLeft + block.left - 3,
          right: bandLeft + block.right + 4,
          top: block.top - 3,
          bottom: block.bottom + 4,
        });
      }
    }
    block = null;
  };
  for (let y = 0; y < image.height; y += 1) {
    if (rowMinX[y] >= 0) {
      if (!block) block = { top: y, bottom: y, left: rowMinX[y], right: rowMaxX[y] };
      else if (y - block.bottom <= 10) {
        block.bottom = y;
        block.left = Math.min(block.left, rowMinX[y]);
        block.right = Math.max(block.right, rowMaxX[y]);
      } else {
        flush();
        block = { top: y, bottom: y, left: rowMinX[y], right: rowMaxX[y] };
      }
    }
  }
  flush();
  return masks;
}

// Edexcel footers carry a "marks progress" strip at the very bottom of the
// page: a tight cluster of small filled/empty squares (■■■□□) beside a
// "Turn over ▶" arrowhead, with the answer box's bottom rule ~50px above.
// It's vector ink with no text, so the furniture text patterns never see it.
// Anchor on the squares cluster — >=2 wide runs among small tight runs in a
// narrow span, sustained over several rows — then mask the companion rule and
// the arrowhead zone to the right. The wide-run requirement keeps barcodes
// (all thin runs) from matching, and the protected-text check keeps tick-box
// rows (which sit beside label text) safe.
function detectProgressStripMasks(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  protectedTextBounds: readonly Rectangle[],
): Rectangle[] {
  const bandTop = Math.floor(image.height * 0.8);
  const height = image.height - bandTop;
  const width = image.width;
  if (height < 60) return [];
  const data = context.getImageData(0, bandTop, width, height).data;
  const inkedAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return data[offset] + data[offset + 1] + data[offset + 2] < 720;
  };
  const rowRuns = (y: number) => {
    const runs: { left: number; right: number }[] = [];
    let runLeft = -1;
    for (let x = 0; x <= width; x += 1) {
      const inked = x < width && inkedAt(x, y);
      if (inked && runLeft < 0) runLeft = x;
      if (!inked && runLeft >= 0) {
        runs.push({ left: runLeft, right: x - 1 });
        runLeft = -1;
      }
    }
    return runs;
  };
  const overlapsText = (rect: Rectangle) => protectedTextBounds.some((bounds) =>
    bounds.left < rect.right && bounds.right > rect.left
    && bounds.top < rect.bottom && bounds.bottom > rect.top);

  // Empty squares read as two thin edges ~15px apart — the gap budget must
  // span a hollow box, not just the 1-2px gutters between filled ones.
  const clusterMaxGap = 20;
  const clusterMaxSpan = Math.round(width * 0.14);
  const ruleMinWidth = Math.round(width * 0.45);
  const masks: Rectangle[] = [];

  // Qualifying row: a cluster of >=3 small runs (2-48px each, gaps <=10px)
  // in a <=0.14W span, with >=2 of them >=10px wide (squares, not barcode).
  const clusterOnRow = (y: number) => {
    const small = rowRuns(y).filter((run) => {
      const w = run.right - run.left + 1;
      return w >= 2 && w <= 48;
    });
    for (let i = 0; i < small.length; i += 1) {
      let j = i;
      while (j + 1 < small.length && small[j + 1]!.left - small[j]!.right - 1 <= clusterMaxGap) j += 1;
      const count = j - i + 1;
      const span = small[j]!.right - small[i]!.left + 1;
      const wide = small.slice(i, j + 1).filter((run) => run.right - run.left + 1 >= 10).length;
      if (count >= 3 && wide >= 2 && span <= clusterMaxSpan) {
        return { left: small[i]!.left, right: small[j]!.right };
      }
      i = j;
    }
    return null;
  };

  // Group qualifying rows into blocks (tolerant of empty-square middle rows
  // that only show thin edges).
  let block: { top: number; bottom: number; left: number; right: number } | null = null;
  let gap = 0;
  const flushBlock = () => {
    if (!block) return;
    if (block.bottom - block.top >= 8) {
      const squares: Rectangle = {
        left: block.left - 12,
        right: block.right + 12,
        top: block.top + bandTop - 4,
        bottom: block.bottom + bandTop + 8,
      };
      if (!overlapsText(squares)) {
        masks.push(squares);
        // Companion zone to the right: "Turn over" arrowhead, page number.
        const rightBand: Rectangle = {
          left: block.right + 30,
          right: Math.round(width * 0.99),
          top: block.top + bandTop - 50,
          bottom: block.bottom + bandTop + 10,
        };
        if (!overlapsText(rightBand)) masks.push(rightBand);
        // The answer-box bottom rule ~50-90px above the squares.
        let ruleTop = -1;
        let ruleBottom = -1;
        let ruleLeft = Number.POSITIVE_INFINITY;
        let ruleRight = 0;
        for (let y = Math.max(0, block.top - 95); y < block.top - 2; y += 1) {
          const longRun = rowRuns(y).find((run) => run.right - run.left + 1 >= ruleMinWidth);
          if (longRun) {
            if (ruleTop < 0) ruleTop = y;
            ruleBottom = y;
            ruleLeft = Math.min(ruleLeft, longRun.left);
            ruleRight = Math.max(ruleRight, longRun.right);
          }
        }
        if (ruleTop >= 0) {
          const rule: Rectangle = {
            left: ruleLeft - 8,
            right: ruleRight + 8,
            top: ruleTop + bandTop - 2,
            bottom: ruleBottom + bandTop + 2,
          };
          if (!overlapsText(rule)) masks.push(rule);
        }
      }
    }
    block = null;
  };

  for (let y = 0; y < height; y += 1) {
    const cluster = clusterOnRow(y);
    if (cluster) {
      if (!block) block = { top: y, bottom: y, left: cluster.left, right: cluster.right };
      else if (y - block.bottom <= 8) {
        block.bottom = y;
        block.left = Math.min(block.left, cluster.left);
        block.right = Math.max(block.right, cluster.right);
      } else {
        flushBlock();
        block = { top: y, bottom: y, left: cluster.left, right: cluster.right };
      }
      gap = 0;
    } else if (block) {
      gap += 1;
      if (gap > 8) flushBlock();
    }
  }
  flushBlock();
  return masks;
}

function detectMarginRuleMasks(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  innerBounds: Rectangle | null,
  outerBounds: Rectangle | null,
): Rectangle[] {
  if (!innerBounds || !outerBounds) return [];
  const top = Math.max(0, Math.floor(innerBounds.top));
  const bottom = Math.min(image.height, Math.ceil(innerBounds.bottom));
  const spanY = bottom - top;
  if (spanY < 60) return [];
  const masks: Rectangle[] = [];
  // Text-item expansion pulls the crop edges past the answer-box border; the
  // border then renders inside the fragment as a stray vertical rule. Scan the
  // bands the expansion added for columns dark across the full crop height.
  const bands = [
    { left: Math.floor(outerBounds.left) - 2, right: Math.ceil(innerBounds.left) + 2 },
    { left: Math.floor(innerBounds.right) - 2, right: Math.ceil(outerBounds.right) + 2 },
  ];
  for (const band of bands) {
    const left = Math.max(0, band.left);
    const right = Math.min(image.width, band.right);
    const width = right - left;
    if (width < 4) continue;
    const data = context.getImageData(left, top, width, spanY).data;
    const darkAt = (x: number, y: number) => {
      const offset = (y * width + x) * 4;
      return data[offset] + data[offset + 1] + data[offset + 2] < 660;
    };
    const samples = Math.ceil(spanY / 2);
    let runLeft = -1;
    for (let x = 0; x <= width; x += 1) {
      let qualifies = false;
      if (x < width) {
        let dark = 0;
        for (let y = 0; y < spanY; y += 2) {
          if (darkAt(x, y) || (x > 0 && darkAt(x - 1, y)) || (x + 1 < width && darkAt(x + 1, y))) dark += 1;
        }
        qualifies = dark / samples > 0.55;
      }
      if (qualifies) {
        if (runLeft < 0) runLeft = x;
      } else if (runLeft >= 0) {
        masks.push({ left: left + runLeft - 1, right: left + x + 1, top, bottom });
        runLeft = -1;
      }
    }
  }
  return masks;
}

// AQA numbers each answer-writing line ("1 ___", "2 ___") at the left margin.
// The digit is furniture: it sits alone on its baseline with a long answer
// rule running to its right. A table cell digit always shares its row with
// neighbouring cells or borders, so the lone-digit + rule signature is safe.
function hasAnswerLineRule(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  bounds: Rectangle,
  scale: number,
): boolean {
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(image.height, Math.ceil(bounds.bottom) + Math.round(3 * scale));
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(image.width, Math.round(image.width * 0.95));
  const width = right - left;
  if (width < 140 || bottom - top < 4) return false;
  const data = context.getImageData(left, top, width, bottom - top).data;
  const minRun = Math.round(100 * scale);
  const darkAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return data[offset] + data[offset + 1] + data[offset + 2] < 660;
  };
  const digitRight = bounds.right - left;
  for (let y = 0; y < bottom - top; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      // Antialiased rules carry light seams — bridge gaps up to 3px.
      const dark = x < width && (darkAt(x, y) || darkAt(x + 1, y) || darkAt(x + 2, y) || darkAt(x + 3, y));
      if (dark && runStart < 0) runStart = x;
      if ((!dark || x === width - 1) && runStart >= 0) {
        // The line-number digit overlaps its rule's left end, so count the
        // run whenever it carries at least minRun past the digit's right edge.
        if (x > digitRight + minRun) return true;
        runStart = -1;
      }
    }
  }
  return false;
}

export type SplitGap = { y: number; pageInk: number };

type CropRowScan = { gaps: SplitGap[]; contentBottom?: number };

// Scans the crop's raster rows once: finds horizontal white bands where a tall
// fragment can be safely split across a page turn (between answer lines, like a
// real paper), and the lowest row of real content so blank answer-space tails
// can be trimmed off. Each gap carries the fraction of a full page the
// remainder alone would ink, so the planner can reject splits that would
// strand a near-blank page.
function scanCropRows(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  image: { width: number; height: number },
  cropBounds: Rectangle | null,
  scale: number,
  cropBox: CropBox | undefined,
): CropRowScan {
  if (!cropBounds || !cropBox) return { gaps: [] };
  const left = Math.max(0, Math.floor(cropBounds.left));
  const right = Math.min(image.width, Math.ceil(cropBounds.right));
  const top = Math.max(0, Math.floor(cropBounds.top));
  const declaredBottom = Math.min(image.height, Math.ceil(cropBounds.bottom));
  // Scan a little past the declared bottom so a boundary that slices a text
  // row can be grown to include the rest of the row.
  const bottom = Math.min(image.height, declaredBottom + Math.round(20 * scale));
  const spanX = right - left;
  const spanY = bottom - top;
  if (spanX < 40 || spanY < 40) return { gaps: [] };
  const data = context.getImageData(left, top, spanX, spanY).data;
  const stride = 3;
  const sampledColumns = Math.ceil(spanX / stride);
  const darkCounts = new Array<number>(spanY).fill(0);
  // Soft-ink counts pixels down to light gray so graph grids and faint rules
  // register as content when estimating how much a split remainder would ink.
  const softCounts = new Array<number>(spanY).fill(0);
  for (let y = 0; y < spanY; y += 1) {
    let count = 0;
    let soft = 0;
    for (let x = 0; x < spanX; x += stride) {
      const offset = (y * spanX + x) * 4;
      const sum = data[offset] + data[offset + 1] + data[offset + 2];
      if (sum < 200) count += 1;
      else if (sum < 690) soft += 1;
    }
    darkCounts[y] = count;
    softCounts[y] = count + soft;
  }
  const rowInk = (y: number) => darkCounts[y] / sampledColumns;
  const whiteRunAbove = (y: number) => {
    let run = 0;
    for (let k = y - 1; k >= 0 && rowInk(k) < 0.005; k -= 1) run += 1;
    return run;
  };

  const declaredSpan = declaredBottom - top;

  // Lowest row of real content. A lone full-width line separated from the
  // content above by a tall white gap is the section-box bottom frame — skip it.
  let contentBottom: number | undefined;
  for (let y = declaredSpan - 1; y >= 0; y -= 1) {
    if (rowInk(y) < 0.01) continue;
    if (rowInk(y) > 0.55 && whiteRunAbove(y) >= Math.round(36 * scale)) continue;
    contentBottom = cropBox.top - (y + 1) / scale;
    break;
  }

  // Boundary slice: the declared bottom cuts through an inked row (a row that
  // is inked inside the crop and stays inked below it). Grow the bottom edge
  // to just past that row so the glyph isn't clipped in half.
  if (declaredSpan >= 3 && declaredSpan < spanY
    && rowInk(declaredSpan - 2) >= 0.005 && rowInk(declaredSpan - 1) >= 0.005
    && rowInk(declaredSpan) >= 0.005) {
    let y = declaredSpan;
    while (y + 1 < spanY && rowInk(y + 1) >= 0.005) y += 1;
    const slicedBottom = cropBox.top - (y + 2) / scale;
    if (contentBottom === undefined || slicedBottom < contentBottom) contentBottom = slicedBottom;
  }

  const suffixDark = new Array<number>(spanY + 1).fill(0);
  for (let y = spanY - 1; y >= 0; y -= 1) {
    suffixDark[y] = suffixDark[y + 1] + softCounts[y];
  }
  const pageArea = Math.max(1, image.width * image.height);
  const minGapPx = Math.max(6, Math.round(4 * scale));
  const edgePadPx = Math.round(18 * scale);
  const gaps: SplitGap[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0 || end - runStart < minGapPx) { runStart = -1; return; }
    const center = Math.floor((runStart + end) / 2);
    runStart = -1;
    if (center < edgePadPx || center > declaredSpan - edgePadPx || gaps.length >= 16) return;
    gaps.push({
      y: cropBox.top - center / scale,
      pageInk: (suffixDark[end] * stride) / pageArea,
    });
  };
  for (let y = 0; y < declaredSpan; y += 1) {
    if (rowInk(y) < 0.005) {
      if (runStart < 0) runStart = y;
    } else {
      flush(y);
    }
  }
  flush(declaredSpan);
  return { gaps, contentBottom };
}

async function sanitizeRasterPage(
  png: Buffer,
  pdfJsPage: Awaited<ReturnType<Awaited<ReturnType<typeof getPdfDocument>>["getPage"]>>,
  scale: number,
  sourceQuestionNumber?: string,
  numberBounds?: QuestionIdentityAnchor["numberBounds"] | QuestionIdentityAnchor["numberBounds"][],
  boardCode?: RasterizeSourceOptions["boardCode"],
  cropBox?: CropBox,
  promptBounds?: QuestionIdentityAnchor["promptBounds"],
) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  context.fillStyle = "#fff";

  const pdfjs = await loadPdfJsForNode();
  const viewport = pdfJsPage.getViewport({ scale });
  const textContent = await pdfJsPage.getTextContent();
  const normalizedQuestionNumber = sourceQuestionNumber?.replace(/\s+/g, "") ?? null;
  const protectedTextBounds: Rectangle[] = [];
  const meaningfulPdfBounds: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const croppedMeaningfulText: string[] = [];
  const furnitureMasks: Rectangle[] = [];
  const sourceIdentityMasks: Rectangle[] = [];
  const crossRefs: CrossRefMask[] = [];
  const boundsList = numberBounds ? (Array.isArray(numberBounds) ? numberBounds : [numberBounds]) : [];
  const identityPad = boardCode === "aqa" ? GENERATED_PAGE.identityWipePad : { x: 3, y: 2 };
  const identityPadX = identityPad.x * scale;
  const identityPadY = identityPad.y * scale;
  const pageWidth = pdfJsPage.view[2];
  const cropBounds = cropBox ? sourceBoundsToRasterMask({
    x0: cropBox.left,
    x1: cropBox.right,
    y0: cropBox.bottom,
    y1: cropBox.top,
  }, viewport) : null;
  const pageTextLines: string[] = [];
  const pendingTextItems: Array<{
    text: string;
    bounds: Rectangle;
    maskBounds: Rectangle;
    originX: number;
    originY: number;
    fontHeight: number;
    horizontal: boolean;
    pdfBounds: { x0: number; x1: number; y0: number; y1: number } | null;
  }> = [];
  let pendingQuestionWord: PdfTextItem | null = null;

  // Count bare-digit items per baseline row. A real page number sits alone (or
  // beside "Turn over"); a row of several digits is data — axis tick labels,
  // answer grids — and must never be wiped as furniture.
  const digitsPerRow = new Map<number, number>();
  for (const rawItem of textContent.items) {
    if (!("str" in rawItem) || !("transform" in rawItem)) continue;
    const item = rawItem as PdfTextItem;
    if (!/^\(?\d{1,3}\)?$/.test(item.str.trim())) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    if (Math.abs(Math.sin(Math.atan2(t[1], t[0]))) >= 0.3) continue;
    const bucket = Math.round(t[5] / 8);
    digitsPerRow.set(bucket, (digitsPerRow.get(bucket) ?? 0) + 1);
  }

  for (const rawItem of textContent.items) {
    if (!("str" in rawItem) || !("transform" in rawItem)) continue;
    const item = rawItem as PdfTextItem;
    const text = item.str.trim().replace(/\s+/g, " ");
    if (!text) continue;
    pageTextLines.push(text);
    if (!isMeaningfulSourceText(text)) continue;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const originX = transform[4];
    const originY = transform[5];
    const angle = Math.atan2(transform[1], transform[0]);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
    const itemWidth = Math.max(1, item.width * scale);
    const rawAngle = Math.atan2(rawItem.transform[1], rawItem.transform[0]);
    const horizontalPdfBounds = Math.abs(Math.sin(rawAngle)) < 0.3
      ? {
        x0: rawItem.transform[4] - 1,
        x1: rawItem.transform[4] + item.width + 1,
        y0: rawItem.transform[5] - 2,
        y1: rawItem.transform[5] + Math.hypot(rawItem.transform[2], rawItem.transform[3]) + 1,
      }
      : null;
    if (horizontalPdfBounds) {
      meaningfulPdfBounds.push(horizontalPdfBounds);
    }
    const isMarginWord = MARGIN_WORD_PATTERN.test(text)
      && Math.abs(Math.sin(angle)) < 0.3
      && (originX < image.width * 0.1 || originX > image.width * 0.9);
    const isRotatedSideFurniture = Math.abs(Math.sin(angle)) > 0.7
      && (originX < image.width * 0.2 || originX > image.width * 0.8)
      && (SOURCE_FURNITURE_PATTERN.test(text) || MARGIN_QUESTION_LABEL_PATTERN.test(text) || MARGIN_WORD_PATTERN.test(text));
    const isPageNumber = /^\(?\d{1,3}\)?$/.test(text)
      && (originY > image.height * 0.85 || originY < image.height * 0.06)
      && (digitsPerRow.get(Math.round(originY / 8)) ?? 0) <= 2;
    const isFooterBarcode = /^(?=.*\d)\*?[a-z0-9]{8,}\*?$/i.test(text) && originY > image.height * 0.85;
    const isMarginQuestionLabel = MARGIN_QUESTION_LABEL_PATTERN.test(text)
      && (originX < 80 * scale || originX > image.width - 100 * scale);
    const isFurniture = SOURCE_FURNITURE_PATTERN.test(text) || SECTION_RUBRIC_PATTERN.test(text) || isMarginQuestionLabel || isRotatedSideFurniture || isPageNumber || isFooterBarcode || isMarginWord;
    const questionNumberMatch = normalizedQuestionNumber !== null
      ? text.match(/^0?\s*(\d{1,2})(?=\s|$)/)
      : null;
    const remainderAfterNumber = questionNumberMatch ? text.slice(questionNumberMatch[0].length) : "";
    // Question numbers sit at the left margin; a margin-positioned digit run
    // followed by a capitalised prompt is a heading at any height, not only
    // in the page's top third.
    const isQuestionNumber = questionNumberMatch?.[1] === normalizedQuestionNumber
      && (originY < image.height * 0.35 || originX < image.width * 0.15)
      && (remainderAfterNumber === "" || /^[A-Z(]/.test(remainderAfterNumber));

    const crossRefDigitMatch = pendingQuestionWord !== null && Math.abs(Math.sin(angle)) < 0.3
      ? text.match(/^0?(\d{1,2})(?=\(|[.,;:!?]|\s|$)/)
      : null;
    if (!isFurniture && Math.abs(Math.sin(angle)) < 0.3) {
      // pdf.js often emits "Question 5" (or "for question 5 only") as one item
      // when the word and digit share a font — patch the digit span in place.
      for (const fused of text.matchAll(/questions?\s+0?(\d{1,2})(?=\(|[.,;:!?]|\s|$)/gi)) {
        const digits = fused[1];
        const digitStart = fused.index + fused[0].length - digits.length;
        const digitLeft = originX + itemWidth * (digitStart / text.length);
        const digitWidthFused = itemWidth * ((digits.length + 0.4) / text.length);
        furnitureMasks.push({
          left: digitLeft - 1.5 * scale,
          right: digitLeft + digitWidthFused + 1.5 * scale,
          top: originY - fontHeight - 1.5 * scale,
          bottom: originY + fontHeight * 0.35 + 1.5 * scale,
        });
        crossRefs.push({
          bounds: {
            x0: rawItem.transform[4] + item.width * (digitStart / text.length),
            x1: rawItem.transform[4] + item.width * ((digitStart + digits.length) / text.length),
            y0: rawItem.transform[5] - fontHeight * 0.35 / scale,
            y1: rawItem.transform[5] + fontHeight / scale,
          },
          baselineY: rawItem.transform[5],
          fontHeight: fontHeight / scale,
          sourceNumber: digits,
        });
      }
    }
    if (QUESTION_WORD_PATTERN.test(text) && Math.abs(Math.sin(angle)) < 0.3) {
      pendingQuestionWord = item;
    } else if (crossRefDigitMatch && pendingQuestionWord !== null) {
      const refTransform = pdfjs.Util.transform(viewport.transform, pendingQuestionWord.transform);
      const sameLine = Math.abs(refTransform[5] - originY) < fontHeight * 1.2;
      const gap = originX - (refTransform[4] + pendingQuestionWord.width * scale);
      if (sameLine && gap > -fontHeight && gap < fontHeight * 6) {
        const digitPrefix = crossRefDigitMatch[0];
        const digitWidth = itemWidth * ((digitPrefix.length + 0.4) / Math.max(1, text.length));
        furnitureMasks.push({
          left: originX - 1.5 * scale,
          right: originX + digitWidth + 1.5 * scale,
          top: originY - fontHeight - 1.5 * scale,
          bottom: originY + fontHeight * 0.35 + 1.5 * scale,
        });
        crossRefs.push({
          bounds: {
            x0: rawItem.transform[4],
            x1: rawItem.transform[4] + item.width * (digitPrefix.length / Math.max(1, text.length)),
            y0: rawItem.transform[5] - fontHeight * 0.35 / scale,
            y1: rawItem.transform[5] + fontHeight / scale,
          },
          baselineY: rawItem.transform[5],
          fontHeight: fontHeight / scale,
          sourceNumber: crossRefDigitMatch[1],
        });
        pendingQuestionWord = null;
        continue;
      }
      pendingQuestionWord = null;
    } else if (Math.abs(Math.sin(angle)) < 0.3) {
      pendingQuestionWord = null;
    }

    let maskWidth = itemWidth;
    if (isQuestionNumber) {
      if (remainderAfterNumber === "") {
        maskWidth = itemWidth;
      } else {
        const numberPrefix = text.slice(0, questionNumberMatch![0].length).trimEnd();
        const proportional = itemWidth * ((numberPrefix.length + 0.6) / Math.max(1, text.length));
        maskWidth = Math.min(itemWidth * 0.6, proportional);
      }
    }
    const padding = isRotatedSideFurniture || isMarginWord ? 0 : (isFurniture ? 7 : isQuestionNumber ? 1.5 : 2) * scale;
    const boundsFor = (width: number, boundsPadding: number) => {
      const corners = [
        [-boundsPadding, -fontHeight - boundsPadding],
        [width + boundsPadding, -fontHeight - boundsPadding],
        [width + boundsPadding, fontHeight * 0.35 + boundsPadding],
        [-boundsPadding, fontHeight * 0.35 + boundsPadding],
      ].map(([x, y]) => ({
        x: originX + x * cos - y * sin,
        y: originY + x * sin + y * cos,
      }));
      return {
        left: Math.min(...corners.map((point) => point.x)),
        right: Math.max(...corners.map((point) => point.x)),
        top: Math.min(...corners.map((point) => point.y)),
        bottom: Math.max(...corners.map((point) => point.y)),
      };
    };
    if (!isFurniture && !isQuestionNumber) {
      pendingTextItems.push({
        text,
        bounds: boundsFor(itemWidth, 2 * scale),
        maskBounds: boundsFor(itemWidth, 7 * scale),
        originX,
        originY,
        fontHeight,
        horizontal: Math.abs(Math.sin(angle)) < 0.3,
        pdfBounds: horizontalPdfBounds,
      });
      continue;
    }
    const { left, right, top, bottom } = boundsFor(maskWidth, padding);
    furnitureMasks.push({ left, right, top, bottom });
  }

  // Mask furniture phrases that pdf.js split into per-word items ("END" "OF"
  // "QUESTIONS", "DO NOT WRITE ON THIS PAGE") — no single item matches the
  // pattern, but the joined baseline does.
  pendingTextItems.sort((a, b) => a.originY - b.originY);
  const lineClusters: (typeof pendingTextItems)[number][][] = [];
  for (const pending of pendingTextItems) {
    const cluster = lineClusters[lineClusters.length - 1];
    const previous = cluster?.[cluster.length - 1];
    if (cluster && previous && pending.horizontal
      && Math.abs(pending.originY - previous.originY) < Math.max(4, pending.fontHeight * 0.6)
      && pending.originX - previous.originX < Math.max(60, pending.fontHeight * 8)) {
      cluster.push(pending);
    } else {
      lineClusters.push([pending]);
    }
  }
  for (const cluster of lineClusters) {
    cluster.sort((a, b) => a.originX - b.originX);
    const line = cluster.map((item) => item.text).join(" ");
    const isFurnitureLine = cluster.length > 1
      && (SOURCE_FURNITURE_PATTERN.test(line) || SECTION_RUBRIC_PATTERN.test(line));
    if (isFurnitureLine) {
      // A reference whose host line is masked is dead: redrawing its digit
      // would paint a lone number into whitespace (e.g. the "8" in
      // "(Total for Question 8 is 12 marks)" floating below the answer lines).
      const linePdf = cluster.map((item) => item.pdfBounds).filter((b): b is NonNullable<typeof b> => b != null);
      if (linePdf.length > 0) {
        const lx0 = Math.min(...linePdf.map((b) => b.x0)) - 2;
        const lx1 = Math.max(...linePdf.map((b) => b.x1)) + 2;
        for (let i = crossRefs.length - 1; i >= 0; i -= 1) {
          const ref = crossRefs[i]!;
          // The ref sits on the same baseline as its host line (pdfBounds
          // y0 = baseline - 2) — match on baseline plus horizontal span.
          const onLine = linePdf.some((b) => Math.abs(ref.baselineY - (b.y0 + 2)) < ref.fontHeight * 0.5);
          if (onLine && ref.bounds.x0 >= lx0 && ref.bounds.x1 <= lx1) crossRefs.splice(i, 1);
        }
      }
    }
    const isAnswerLineNumber = cluster.length === 1
      && /^\d{1,2}$/.test(cluster[0]!.text)
      && cluster[0]!.horizontal
      && cluster[0]!.bounds.left < image.width * 0.35
      && hasAnswerLineRule(context, image, cluster[0]!.bounds, scale);
    for (const item of cluster) {
      if (isFurnitureLine || isAnswerLineNumber) {
        furnitureMasks.push(item.maskBounds);
        continue;
      }
      protectedTextBounds.push(item.bounds);
      if (!cropBounds || Math.max(item.bounds.left, cropBounds.left) < Math.min(item.bounds.right, cropBounds.right)
        && Math.max(item.bounds.top, cropBounds.top) < Math.min(item.bounds.bottom, cropBounds.bottom)) {
        croppedMeaningfulText.push(item.text);
      }
    }
  }

  // An identity bound that only covers a paren part label — "(a)", "(ii)" — is a
  // part marker, not the question number. Wiping it deletes a label that nothing
  // redraws (non-boxed subjects draw only the margin number).
  for (const bound of boundsList) {
    const overlapped = pendingTextItems.filter((item) => item.pdfBounds !== null
      && item.pdfBounds.x0 <= bound.x1 && item.pdfBounds.x1 >= bound.x0
      && item.pdfBounds.y0 <= bound.y1 && item.pdfBounds.y1 >= bound.y0);
    if (overlapped.length > 0 && overlapped.every((item) => /^\([a-z]{1,4}\)$/i.test(item.text))) continue;
    const stripMask = sourceBoundsToRasterMask(bound, viewport);
    sourceIdentityMasks.push({
      left: stripMask.left - identityPadX,
      right: stripMask.right + identityPadX,
      top: stripMask.top - identityPadY,
      bottom: stripMask.bottom + identityPadY,
    });
  }

  const effectiveCropBox = resolveCropBoxToTextItems(cropBox, meaningfulPdfBounds, pageWidth);
  const effectiveCropBounds = effectiveCropBox ? sourceBoundsToRasterMask({
    x0: effectiveCropBox.left,
    x1: effectiveCropBox.right,
    y0: effectiveCropBox.bottom,
    y1: effectiveCropBox.top,
  }, viewport) : null;
  const edgeMasks = detectEdgeLineMasks(context, image, cropBounds);
  const marginMasks = detectMarginRuleMasks(context, image, cropBounds, effectiveCropBounds);
  const progressMasks = detectProgressStripMasks(context, image, protectedTextBounds);
  furnitureMasks.push(
    ...detectBarcodeMasks(context, image, protectedTextBounds),
    ...edgeMasks,
    ...marginMasks,
    ...progressMasks,
    ...detectMarginMarkMasks(context, image, cropBounds),
  );

  for (const mask of furnitureMasks) {
    context.fillRect(mask.left, mask.top, mask.right - mask.left, mask.bottom - mask.top);
  }

  const allMasks = [...furnitureMasks, ...sourceIdentityMasks];
  for (const bounds of protectedTextBounds) {
    const left = Math.max(0, Math.floor(bounds.left));
    const top = Math.max(0, Math.floor(bounds.top));
    const right = Math.min(image.width, Math.ceil(bounds.right));
    const bottom = Math.min(image.height, Math.ceil(bounds.bottom));
    if (right > left && bottom > top) {
      for (const remainder of subtractRectangle({ left, right, top, bottom }, allMasks)) {
        context.drawImage(
          image,
          remainder.left,
          remainder.top,
          remainder.right - remainder.left,
          remainder.bottom - remainder.top,
          remainder.left,
          remainder.top,
          remainder.right - remainder.left,
          remainder.bottom - remainder.top,
        );
      }
    }
  }

  for (const mask of furnitureMasks) {
    context.fillRect(mask.left, mask.top, mask.right - mask.left, mask.bottom - mask.top);
  }
  for (const mask of sourceIdentityMasks) {
    // The wipe pad must not eat neighbouring prompt glyphs — clamp to any
    // protected text on the marker's own line that sits past the raw bounds.
    const rawLeft = mask.left + identityPadX;
    const rawRight = mask.right - identityPadX;
    const rawTop = mask.top + identityPadY;
    const rawBottom = mask.bottom - identityPadY;
    for (const bounds of protectedTextBounds) {
      if (bounds.bottom <= rawTop || bounds.top >= rawBottom) continue;
      if (bounds.left >= rawRight) mask.right = Math.min(mask.right, bounds.left - 1);
      if (bounds.right <= rawLeft) mask.left = Math.max(mask.left, bounds.right + 1);
    }
    context.fillRect(mask.left, mask.top, mask.right - mask.left, mask.bottom - mask.top);
  }

  const rowScan = scanCropRows(context, image, cropBounds, scale, effectiveCropBox);
  if (cropBox && effectiveCropBox) clearCropBoundary(context, effectiveCropBox, viewport, scale);
  if (effectiveCropBox && rowScan.contentBottom !== undefined) {
    const anchorFloor = Math.min(
      ...boundsList.map((bound) => bound.y0),
      promptBounds?.y0 ?? Number.POSITIVE_INFINITY,
    ) - 2;
    // Whitespace below the content raises the edge; content sliced at the
    // boundary lowers it to include the rest of the clipped row (capped so a
    // false read can't pull the next question's rows into this fragment).
    const trimmed = rowScan.contentBottom < effectiveCropBox.bottom
      ? Math.max(rowScan.contentBottom - 4, effectiveCropBox.bottom - 16)
      : Math.max(effectiveCropBox.bottom, rowScan.contentBottom - 4);
    // Only clamp when the anchor actually sits inside this crop — an anchor
    // below the crop belongs to a sibling fragment and must not pull the
    // bottom edge down into its content.
    const nextBottom = Number.isFinite(anchorFloor) && anchorFloor >= effectiveCropBox.bottom
      ? Math.min(trimmed, anchorFloor)
      : trimmed;
    if (nextBottom !== effectiveCropBox.bottom) {
      effectiveCropBox.bottom = nextBottom;
      clearCropBoundary(context, effectiveCropBox, viewport, scale);
    }
  }

  const croppedText = croppedMeaningfulText.join(" ").replace(/\s+/g, " ").trim();

  // Furniture-only pages: additional-answer / "no questions printed" pages whose
  // header text fails extraction entirely. Post-mask the interior holds nothing
  // but a ruled answer box (or is empty), so flag and let the caller drop it.
  const interior = {
    left: Math.round(image.width * 0.12),
    right: Math.round(image.width * 0.88),
    top: Math.round(image.height * 0.08),
    bottom: Math.round(image.height * 0.88),
  };
  const scanLeft = Math.round(image.width * 0.06);
  const scanWidth = Math.round(image.width * 0.94) - scanLeft;
  const interiorWidth = interior.right - interior.left;
  const interiorHeight = interior.bottom - interior.top;
  const interiorData = context.getImageData(scanLeft, interior.top, scanWidth, interiorHeight).data;
  const interiorStride = 2;
  let interiorDark = 0;
  const borderColumns: number[] = [];
  const darkAt = (x: number, y: number) => {
    const offset = (y * scanWidth + x) * 4;
    return interiorData[offset] + interiorData[offset + 1] + interiorData[offset + 2] < 200;
  };
  for (let x = 0; x < scanWidth; x += interiorStride) {
    let columnDark = 0;
    for (let y = 0; y < interiorHeight; y += 1) {
      // Window max so 1-2px box borders can't slip between sampled columns.
      if (darkAt(x, y) || (x > 0 && darkAt(x - 1, y)) || (x + 1 < scanWidth && darkAt(x + 1, y))) columnDark += 1;
    }
    if (scanLeft + x >= interior.left && scanLeft + x <= interior.right) interiorDark += columnDark;
    if (columnDark / interiorHeight >= 0.55) borderColumns.push(scanLeft + x);
  }
  const boxEdges = borderColumns.reduce<number>((count, x, index) => (
    index === 0 || x - borderColumns[index - 1]! > image.width * 0.2 ? count + 1 : count
  ), 0);
  const interiorHasText = protectedTextBounds.some((bounds) => bounds.left < interior.right && bounds.right > interior.left
    && bounds.top < interior.bottom && bounds.bottom > interior.top);
  const furnitureOnlyPage = !interiorHasText
    && (boxEdges >= 2 || (interiorDark * interiorStride) / (interiorWidth * interiorHeight) < 0.001);

  return {
    png: canvas.toBuffer("image/png"),
    cropBox: effectiveCropBox,
    hasMeaningfulText: protectedTextBounds.some((bounds) => !cropBounds
      || Math.max(bounds.left, cropBounds.left) < Math.min(bounds.right, cropBounds.right)
      && Math.max(bounds.top, cropBounds.top) < Math.min(bounds.bottom, cropBounds.bottom)),
    isAdditionalAnswerPage: isAdditionalAnswerPage(pageTextLines, boardCode) || furnitureOnlyPage,
    crossRefs,
    isIsolatedItemHeading: boardCode === "aqa"
      && effectiveCropBox !== undefined
      && effectiveCropBox.top - effectiveCropBox.bottom < 80
      && /^(?:\d{1,3}\s+)?(?:outside the box\s+)?Item\s+[A-Z]\s*:/i.test(croppedText),
    splitGaps: rowScan.gaps,
  };
}

function resolveCropBoxToTextItems(
  cropBox: CropBox | undefined,
  textBounds: Array<{ x0: number; x1: number; y0: number; y1: number }>,
  pageWidth: number,
): CropBox | undefined {
  if (!cropBox || textBounds.length === 0) return cropBox;
  let left = cropBox.left;
  let right = cropBox.right;
  for (const bounds of textBounds) {
    if (bounds.y1 < cropBox.bottom - 2 || bounds.y0 > cropBox.top + 2) continue;
    left = Math.min(left, bounds.x0);
    right = Math.max(right, bounds.x1);
  }
  return {
    ...cropBox,
    left: Math.max(0, left),
    right: Math.min(pageWidth, right),
  };
}

function getEmbeddedPages(outputDoc: PDFDocument) {
  const embeddedPages = Reflect.get(outputDoc, "embeddedPages");
  if (!Array.isArray(embeddedPages)) {
    throw new Error("PDF document does not expose its embedded page queue.");
  }
  return embeddedPages;
}

export async function fetchPdfBytes(url: string, cache: Map<string, Uint8Array>) {
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

export async function loadSourcePdfDocument(
  pageAssetUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  options?: { throwOnInvalidObject?: boolean },
) {
  let sourceDoc = sourceDocCache.get(pageAssetUrl);
  if (sourceDoc) return sourceDoc;

  const sourceBytes = await fetchPdfBytes(pageAssetUrl, sourcePdfCache);
  try {
    sourceDoc = await PDFDocument.load(sourceBytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: options?.throwOnInvalidObject ?? false,
    });
  } catch (error) {
    throw new Error(`Failed to load source PDF ${pageAssetUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  sourceDocCache.set(pageAssetUrl, sourceDoc);
  return sourceDoc;
}

export async function rasterizeSourcePdfPage(
  pageAssetUrl: string,
  sourcePageIndex: number,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  options: RasterizeSourceOptions = {},
  sourcePageCache?: Map<string, Promise<SourcePage>>,
) {
  const boundsKey = options.numberBounds
    ? (Array.isArray(options.numberBounds) ? options.numberBounds : [options.numberBounds])
      .map((bound) => Object.values(bound).join("-")).join("_")
    : "none";
  const sanitizationKey = options.sanitizeFurniture
    ? `-clean-${options.boardCode ?? "none"}-${options.sourceQuestionNumber ?? "none"}-${boundsKey}-${options.promptBounds ? Object.values(options.promptBounds).join("-") : "none"}-${options.cropBox ? Object.values(options.cropBox).join("-") : "none"}`
    : "";
  const rasterUrl = `${pageAssetUrl}#raster-page-${sourcePageIndex}${sanitizationKey}`;
  const cachedDoc = sourceDocCache.get(rasterUrl);
  if (cachedDoc) {
    const metadata = sanitizedPageMetadata.get(cachedDoc) ?? { hasMeaningfulText: true, isAdditionalAnswerPage: false, isIsolatedItemHeading: false, crossRefs: [] as CrossRefMask[], splitGaps: [] as SplitGap[] };
    return {
      candidate: { pdfUrl: rasterUrl, sourcePageIndex: 0 } satisfies SourcePdfCandidate,
      sourceDoc: cachedDoc,
      sourcePdfPage: cachedDoc.getPage(0),
      ...metadata,
    };
  }
  const pdfJsPageNumber = sourcePageIndex + 1;
  const sourcePageKey = `${pageAssetUrl}#source-page-${sourcePageIndex}`;
  let sourcePage = sourcePageCache?.get(sourcePageKey);
  if (!sourcePage) {
    sourcePage = (async () => {
      const sourceBytes = await fetchPdfBytes(pageAssetUrl, sourcePdfCache);
      const pdfJsDoc = await getPdfDocument(sourceBytes);
      const pdfJsPage = await pdfJsDoc.getPage(pdfJsPageNumber);
      const renderedPng = await renderPdfPageToPng(pdfJsDoc, pdfJsPageNumber, 2);
      return { pdfJsPage, renderedPng };
    })();
    sourcePageCache?.set(sourcePageKey, sourcePage);
  }
  const { pdfJsPage, renderedPng } = await sourcePage;
  const [pageX, pageY] = pdfJsPage.view;
  const viewport = pdfJsPage.getViewport({ scale: 1 });
  const renderScale = 2;
  const sanitized = options.sanitizeFurniture
    ? await sanitizeRasterPage(renderedPng, pdfJsPage, renderScale, options.sourceQuestionNumber, options.numberBounds, options.boardCode, options.cropBox, options.promptBounds)
    : { png: renderedPng, cropBox: undefined, hasMeaningfulText: true, isAdditionalAnswerPage: false, isIsolatedItemHeading: false, crossRefs: [] as CrossRefMask[], splitGaps: [] as SplitGap[] };
  const rasterDoc = await PDFDocument.create();
  const page = rasterDoc.addPage([viewport.width, viewport.height]);
  page.setMediaBox(pageX, pageY, viewport.width, viewport.height);
  page.setCropBox(pageX, pageY, viewport.width, viewport.height);
  const image = await rasterDoc.embedPng(sanitized.png);
  page.drawImage(image, { x: pageX, y: pageY, width: viewport.width, height: viewport.height });
  sourcePdfCache.set(rasterUrl, await rasterDoc.save());
  sourceDocCache.set(rasterUrl, rasterDoc);
  sanitizedPageMetadata.set(rasterDoc, sanitized);

  return {
    candidate: { pdfUrl: rasterUrl, sourcePageIndex: 0 } satisfies SourcePdfCandidate,
    sourceDoc: rasterDoc,
    sourcePdfPage: page,
    cropBox: sanitized.cropBox,
    hasMeaningfulText: sanitized.hasMeaningfulText,
    isAdditionalAnswerPage: sanitized.isAdditionalAnswerPage,
    isIsolatedItemHeading: sanitized.isIsolatedItemHeading,
    crossRefs: sanitized.crossRefs,
    splitGaps: sanitized.splitGaps,
  };
}

async function prepareWorkingPage(
  pageAssetUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  sourcePageIndex: number,
) {
  const [sourceDoc, workingDoc] = await Promise.all([
    loadSourcePdfDocument(pageAssetUrl, sourcePdfCache, sourceDocCache),
    PDFDocument.create(),
  ]);
  try {
    const [workingPage] = await workingDoc.copyPages(sourceDoc, [sourcePageIndex]);
    return workingPage;
  } catch {
    const { sourceDoc: rasterDoc } = await rasterizeSourcePdfPage(pageAssetUrl, sourcePageIndex, sourcePdfCache, sourceDocCache);
    const [workingPage] = await workingDoc.copyPages(rasterDoc, [0]);
    return workingPage;
  }
}

export async function prepareSnippet(
  outputDoc: PDFDocument,
  pageAssetUrl: string,
  localCropBox: CropBox,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  sourcePageIndex = 0,
): Promise<PreparedSnippet> {
  const workingPage = await prepareWorkingPage(pageAssetUrl, sourcePdfCache, sourceDocCache, sourcePageIndex);
  const visiblePage = workingPage.getCropBox();
  const cropBox = toPdfCropBox(localCropBox, {
    x: visiblePage.x,
    y: visiblePage.y,
    width: visiblePage.width,
    height: visiblePage.height,
  });
  const embeddedPage = await outputDoc.embedPage(workingPage, cropBox);
  try {
    await embeddedPage.embed();
  } catch (error) {
    const queued = getEmbeddedPages(outputDoc);
    const index = queued.indexOf(embeddedPage);
    if (index >= 0) queued.splice(index, 1);
    throw error;
  }
  return {
    embeddedPage,
    width: localCropBox.right - localCropBox.left,
    height: localCropBox.top - localCropBox.bottom,
    cropBox: localCropBox,
  };
}
