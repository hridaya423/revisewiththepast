import { readFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";

import { getPdfDocument, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";

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
) {
  const rasterUrl = `${pageAssetUrl}#raster-page-${sourcePageIndex}`;
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
  const viewport = pdfJsPage.getViewport({ scale: 1 });
  const png = await renderPdfPageToPng(pdfJsDoc, pdfJsPageNumber, 2);
  const rasterDoc = await PDFDocument.create();
  const page = rasterDoc.addPage([viewport.width, viewport.height]);
  const image = await rasterDoc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
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
  cropBox: CropBox,
  sourcePdfCache: Map<string, Uint8Array>,
  sourceDocCache: Map<string, PDFDocument>,
  sourcePageIndex = 0,
): Promise<PreparedSnippet> {
  const workingPage = await prepareWorkingPage(pageAssetUrl, sourcePdfCache, sourceDocCache, sourcePageIndex);
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
    width: cropBox.right - cropBox.left,
    height: cropBox.top - cropBox.bottom,
    cropBox,
  };
}
