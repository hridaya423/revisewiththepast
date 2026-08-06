import { readFileSync } from "node:fs";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { toPdfCropBox } from "../../domain/crop-geometry";
import { getPdfDocument, loadPdfJsForNode, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";

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
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

const SOURCE_FURNITURE_PATTERN = /do not write|outside the box|turn over|pearson edexcel|^pmt$|^\*?[a-z]\d{5,}[a-z]?\*?$/i;

async function sanitizeRasterPage(
  png: Buffer,
  pdfJsPage: Awaited<ReturnType<Awaited<ReturnType<typeof getPdfDocument>>["getPage"]>>,
  scale: number,
  sourceQuestionNumber?: string,
) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  context.fillStyle = "#fff";

  const pdfjs = await loadPdfJsForNode();
  const viewport = pdfJsPage.getViewport({ scale });
  const textContent = await pdfJsPage.getTextContent();
  const pageText = textContent.items
    .flatMap((item) => "str" in item ? [item.str] : [])
    .join(" ")
    .replace(/\s+/g, " ");
  const normalizedPageText = pageText.toLowerCase();
  const hasRightWarningLane = normalizedPageText.includes("write")
    && (normalizedPageText.includes("area") || normalizedPageText.includes("outside"));
  const normalizedQuestionNumber = sourceQuestionNumber?.replace(/\s+/g, "") ?? null;

  for (const rawItem of textContent.items) {
    if (!("str" in rawItem) || !("transform" in rawItem)) continue;
    const item = rawItem as PdfTextItem;
    const text = item.str.trim().replace(/\s+/g, " ");
    if (!text) continue;

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
      && /^(?:do|not|write|in|this|area|outside|the|box)$/i.test(text);
    const isFurniture = SOURCE_FURNITURE_PATTERN.test(text) || isRotatedSideFurniture;
    const itemQuestionNumber = text.match(/^0?\s*(\d{1,2})(?=\s|$)/)?.[1] ?? null;
    const isQuestionNumber = normalizedQuestionNumber !== null
      && itemQuestionNumber === normalizedQuestionNumber
      && originY < image.height * 0.35;
    const isFooterPageNumber = /^\d{1,3}$/.test(text) && originY > image.height * 0.9;
    if (!isFurniture && !isQuestionNumber && !isFooterPageNumber) continue;

    const maskWidth = isQuestionNumber
      ? Math.min(itemWidth, (normalizedQuestionNumber.length * 6.5 + 4) * scale)
      : itemWidth;
    const padding = (isFurniture ? 7 : 2) * scale;
    const localCorners = [
      [-padding, -fontHeight - padding],
      [maskWidth + padding, -fontHeight - padding],
      [maskWidth + padding, fontHeight * 0.35 + padding],
      [-padding, fontHeight * 0.35 + padding],
    ] as const;
    const corners = localCorners.map(([x, y]) => ({
      x: originX + x * cos - y * sin,
      y: originY + x * sin + y * cos,
    }));
    const left = Math.min(...corners.map((point) => point.x));
    const right = Math.max(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    const bottom = Math.max(...corners.map((point) => point.y));

    if (isFurniture && bottom - top > right - left) {
      context.fillRect(Math.max(0, left - 6 * scale), 0, Math.min(image.width, right - left + 12 * scale), image.height);
    } else {
      context.fillRect(left, top, right - left, bottom - top);
    }
  }

  context.fillRect(0, 0, image.width, 48 * scale);
  context.fillRect(0, 0, 52 * scale, image.height);
  const rightBandWidth = Math.min(image.width, Math.round(80 * scale));
  const rightBandX = image.width - rightBandWidth;
  const rightBand = context.getImageData(rightBandX, 0, rightBandWidth, image.height);
  const darkPixelsByColumn = new Uint32Array(rightBandWidth);
  let darkPixelCount = 0;
  for (let pixel = 0; pixel < rightBand.data.length; pixel += 4) {
    if (rightBand.data[pixel] < 220 && rightBand.data[pixel + 1] < 220 && rightBand.data[pixel + 2] < 220) {
      const column = (pixel / 4) % rightBandWidth;
      darkPixelsByColumn[column] += 1;
      darkPixelCount += 1;
    }
  }
  const hasVisualRightWarningLane = darkPixelCount > rightBandWidth * image.height * 0.05;
  if (hasRightWarningLane || hasVisualRightWarningLane) {
    context.fillRect(image.width - 66 * scale, 0, 66 * scale, image.height);
  } else {
    for (let column = 0; column < darkPixelsByColumn.length; column += 1) {
      if (darkPixelsByColumn[column] <= image.height * 0.35) continue;
      context.fillRect(rightBandX + column - 2 * scale, 0, 4 * scale, image.height);
    }
  }
  context.fillRect(0, image.height - 52 * scale, image.width, 52 * scale);

  return canvas.toBuffer("image/png");
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
  const sanitizationKey = options.sanitizeFurniture ? `-clean-${options.sourceQuestionNumber ?? "none"}` : "";
  const rasterUrl = `${pageAssetUrl}#raster-page-${sourcePageIndex}${sanitizationKey}`;
  const cachedDoc = sourceDocCache.get(rasterUrl);
  if (cachedDoc) {
    return {
      candidate: { pdfUrl: rasterUrl, sourcePageIndex: 0 } satisfies SourcePdfCandidate,
      sourceDoc: cachedDoc,
      sourcePdfPage: cachedDoc.getPage(0),
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
  const png = options.sanitizeFurniture
    ? await sanitizeRasterPage(renderedPng, pdfJsPage, renderScale, options.sourceQuestionNumber)
    : renderedPng;
  const rasterDoc = await PDFDocument.create();
  const page = rasterDoc.addPage([viewport.width, viewport.height]);
  page.setMediaBox(pageX, pageY, viewport.width, viewport.height);
  page.setCropBox(pageX, pageY, viewport.width, viewport.height);
  const image = await rasterDoc.embedPng(png);
  page.drawImage(image, { x: pageX, y: pageY, width: viewport.width, height: viewport.height });
  sourcePdfCache.set(rasterUrl, await rasterDoc.save());
  sourceDocCache.set(rasterUrl, rasterDoc);

  return {
    candidate: { pdfUrl: rasterUrl, sourcePageIndex: 0 } satisfies SourcePdfCandidate,
    sourceDoc: rasterDoc,
    sourcePdfPage: page,
  };
}

async function prepareWorkingPage(
  pageAssetUrl: string,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  sourcePageIndex: number,
) {
  const sourceDoc = await loadSourcePdfDocument(pageAssetUrl, sourcePdfCache, sourceDocCache);
  const workingDoc = await PDFDocument.create();
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
