import { readFileSync } from "node:fs";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { toPdfCropBox } from "../../domain/crop-geometry";
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
  numberBounds?: QuestionIdentityAnchor["numberBounds"];
  boardCode?: QuestionUnit["boardCode"];
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
  hasMeaningfulText: boolean;
  isAdditionalAnswerPage: boolean;
};

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

const SOURCE_FURNITURE_PATTERN = /do not write|outside the box|turn over|pearson edexcel|copyright|total for (?:question|section|paper)|^question\s+\d+\b|^pmt$/i;

function isAdditionalAnswerPage(lines: string[], boardCode?: RasterizeSourceOptions["boardCode"]) {
  const text = lines.join(" ").toLowerCase().replace(/\s+/g, " ");
  if (/additional page, if required|write the question numbers in the left-hand margin|extra answer space/.test(text)) {
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

async function sanitizeRasterPage(
  png: Buffer,
  pdfJsPage: Awaited<ReturnType<Awaited<ReturnType<typeof getPdfDocument>>["getPage"]>>,
  scale: number,
  sourceQuestionNumber?: string,
  numberBounds?: QuestionIdentityAnchor["numberBounds"],
  boardCode?: RasterizeSourceOptions["boardCode"],
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
  const furnitureMasks: Rectangle[] = [];
  const sourceIdentityMasks = numberBounds ? [sourceBoundsToRasterMask(numberBounds, viewport)] : [];
  const pageTextLines: string[] = [];

  for (const rawItem of textContent.items) {
    if (!("str" in rawItem) || !("transform" in rawItem)) continue;
    const item = rawItem as PdfTextItem;
    const text = item.str.trim().replace(/\s+/g, " ");
    if (!text) continue;
    pageTextLines.push(text);
    if (/^[.\s_-]+$/.test(text)) continue;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const originX = transform[4];
    const originY = transform[5];
    const angle = Math.atan2(transform[1], transform[0]);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
    const itemWidth = Math.max(1, item.width * scale);
    const isRotatedSideFurniture = Math.abs(Math.sin(angle)) > 0.7
      && (originX < image.width * 0.2 || originX > image.width * 0.8)
      && (SOURCE_FURNITURE_PATTERN.test(text) || /^(?:do|not|write|in|this|area|outside|the|box)$/i.test(text));
    const isPageNumber = /^\d{1,3}$/.test(text) && originY > image.height * 0.85;
    const isFooterBarcode = /^(?=.*\d)\*?[a-z0-9]{8,}\*?$/i.test(text) && originY > image.height * 0.85;
    const isFurniture = SOURCE_FURNITURE_PATTERN.test(text) || isRotatedSideFurniture || isPageNumber || isFooterBarcode;
    const itemQuestionNumber = text.match(/^0?\s*(\d{1,2})(?=\s|$)/)?.[1] ?? null;
    const isQuestionNumber = normalizedQuestionNumber !== null
      && itemQuestionNumber === normalizedQuestionNumber
      && originY < image.height * 0.35;

    const maskWidth = isQuestionNumber
      ? Math.min(itemWidth, (normalizedQuestionNumber.length * 6.5 + 4) * scale)
      : itemWidth;
    const padding = isRotatedSideFurniture ? 0 : (isFurniture ? 7 : 2) * scale;
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
      protectedTextBounds.push(boundsFor(itemWidth, 2 * scale));
      continue;
    }
    const { left, right, top, bottom } = boundsFor(maskWidth, padding);
    furnitureMasks.push({ left, right, top, bottom });
  }

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
    context.fillRect(mask.left, mask.top, mask.right - mask.left, mask.bottom - mask.top);
  }

  return {
    png: canvas.toBuffer("image/png"),
    hasMeaningfulText: protectedTextBounds.length > 0,
    isAdditionalAnswerPage: isAdditionalAnswerPage(pageTextLines, boardCode),
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
) {
  const sanitizationKey = options.sanitizeFurniture
    ? `-clean-${options.boardCode ?? "none"}-${options.sourceQuestionNumber ?? "none"}-${options.numberBounds ? Object.values(options.numberBounds).join("-") : "none"}`
    : "";
  const rasterUrl = `${pageAssetUrl}#raster-page-${sourcePageIndex}${sanitizationKey}`;
  const cachedDoc = sourceDocCache.get(rasterUrl);
  if (cachedDoc) {
    const metadata = sanitizedPageMetadata.get(cachedDoc) ?? { hasMeaningfulText: true, isAdditionalAnswerPage: false };
    return {
      candidate: { pdfUrl: rasterUrl, sourcePageIndex: 0 } satisfies SourcePdfCandidate,
      sourceDoc: cachedDoc,
      sourcePdfPage: cachedDoc.getPage(0),
      ...metadata,
    };
  }

  const sourceBytes = await fetchPdfBytes(pageAssetUrl, sourcePdfCache);
  const pdfJsDoc = await getPdfDocument(sourceBytes.slice());
  const pdfJsPageNumber = sourcePageIndex + 1;
  const pdfJsPage = await pdfJsDoc.getPage(pdfJsPageNumber);
  const [pageX, pageY] = pdfJsPage.view;
  const viewport = pdfJsPage.getViewport({ scale: 1 });
  const renderScale = 2;
  const renderedPng = await renderPdfPageToPng(pdfJsDoc, pdfJsPageNumber, renderScale);
  const sanitized = options.sanitizeFurniture
    ? await sanitizeRasterPage(renderedPng, pdfJsPage, renderScale, options.sourceQuestionNumber, options.numberBounds, options.boardCode)
    : { png: renderedPng, hasMeaningfulText: true, isAdditionalAnswerPage: false };
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
    hasMeaningfulText: sanitized.hasMeaningfulText,
    isAdditionalAnswerPage: sanitized.isAdditionalAnswerPage,
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
