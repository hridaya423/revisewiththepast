import "server-only";

import { resolve } from "node:path";

import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

type NapiCanvas = ReturnType<typeof createCanvas>;

// pdfjs-dist resolves its own nested @napi-rs/canvas via createRequire; canvases
// from that copy reject Path2D/ImageData instances from this copy. Routing every
// pdf.js canvas through this factory keeps a single class realm.
class NapiCanvasFactory {
  constructor(_params: { ownerDocument?: unknown; enableHWA?: boolean } = {}) {}
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair: { canvas: NapiCanvas }, width: number, height: number) {
    if (!pair.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    pair.canvas.width = width;
    pair.canvas.height = height;
  }
  destroy(pair: { canvas: NapiCanvas }) {
    if (!pair.canvas) throw new Error("Canvas is not specified");
    pair.canvas.width = pair.canvas.height = 0;
  }
}

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
  const ownedData = new Uint8Array(data.byteLength);
  ownedData.set(data);
  return pdfjs.getDocument({
    data: ownedData,
    disableWorker: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    wasmUrl: WASM_URL,
    useWorkerFetch: false,
    CanvasFactory: NapiCanvasFactory,
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
