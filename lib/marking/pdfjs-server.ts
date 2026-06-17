import "server-only";

import { resolve } from "node:path";

import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix;
globalThis.ImageData ??= ImageData as unknown as typeof globalThis.ImageData;
globalThis.Path2D ??= Path2D as unknown as typeof globalThis.Path2D;

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsWorkerModule = typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs");
type PdfDocumentProxy = Awaited<ReturnType<PdfJsModule["getDocument"]>> extends { promise: infer P } ? Awaited<P> : never;

type PdfJsWorkerGlobal = {
  WorkerMessageHandler: PdfJsWorkerModule["WorkerMessageHandler"];
};

declare global {
  var pdfjsWorker: PdfJsWorkerGlobal | undefined;
}

export const STANDARD_FONT_DATA_URL = `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;
export const WASM_URL = `${resolve(process.cwd(), "node_modules/pdfjs-dist/wasm")}/`;

let cachedPdfJsModule: Promise<PdfJsModule> | null = null;

export async function loadPdfJsForNode() {
  cachedPdfJsModule ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ]);

    globalThis.pdfjsWorker = {
      WorkerMessageHandler: worker.WorkerMessageHandler,
    };

    return pdfjs;
  })();

  return await cachedPdfJsModule;
}

export async function getPdfDocument(data: Uint8Array) {
  const pdfjs = await loadPdfJsForNode();
  return pdfjs.getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    wasmUrl: WASM_URL,
    useWorkerFetch: false,
  } as never).promise;
}

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

export async function extractPdfPageTexts(document: PdfDocumentProxy): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber, text });
  }

  return pages;
}

export async function renderPdfPageToPng(
  document: PdfDocumentProxy,
  pageNumber: number,
  scale = 2,
): Promise<Buffer> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({
    canvasContext: context as never,
    viewport,
  } as never).promise;
  return canvas.toBuffer("image/png");
}

export async function renderPdfToPngBuffers(data: Uint8Array, scale = 2) {
  const document = await getPdfDocument(data);
  const pages: Array<{ pageNumber: number; png: Buffer }> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    pages.push({
      pageNumber,
      png: await renderPdfPageToPng(document, pageNumber, scale),
    });
  }

  return {
    document,
    pages,
    textPages: await extractPdfPageTexts(document),
  };
}
