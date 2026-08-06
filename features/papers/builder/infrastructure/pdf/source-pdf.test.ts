import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { extractPdfPageTexts, getPdfDocument, renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import { prepareSnippet, rasterizeSourcePdfPage } from "./source-pdf";

describe("source PDF rasterization", () => {
  it("removes source text objects when a page is rasterized for masking", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("SECRET SOURCE TOTAL", { x: 30, y: 100, size: 14, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map());
      const document = await getPdfDocument(await raster.sourceDoc.save());
      const [text] = await extractPdfPageTexts(document);
      expect(text?.text).not.toContain("SECRET SOURCE TOTAL");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts PDF bytes backed by a SharedArrayBuffer", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 200]);
    const bytes = await source.save();
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
    sharedBytes.set(bytes);

    const document = await getPdfDocument(sharedBytes);

    expect(document.numPages).toBe(1);
  });

  it("preserves a non-zero source crop origin when rasterizing", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    page.setMediaBox(18, 26, 300, 200);
    page.setCropBox(18, 26, 300, 200);
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-origin-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map());
      expect(raster.sourcePdfPage.getCropBox()).toMatchObject({ x: 18, y: 26, width: 300, height: 200 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders local crop content from a raster page with a non-zero origin", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    page.setMediaBox(18, 26, 300, 200);
    page.setCropBox(18, 26, 300, 200);
    page.drawRectangle({ x: 118, y: 76, width: 20, height: 20, color: rgb(0, 0, 0) });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-local-crop-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const sourcePdfCache = new Map<string, Uint8Array>();
      const sourceDocCache = new Map<string, PDFDocument>();
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, sourcePdfCache, sourceDocCache);
      const output = await PDFDocument.create();
      const snippet = await prepareSnippet(
        output,
        raster.candidate.pdfUrl,
        { left: 90, right: 130, bottom: 40, top: 80 },
        sourcePdfCache,
        sourceDocCache,
      );
      const outputPage = output.addPage([40, 40]);
      outputPage.drawPage(snippet.embeddedPage, { x: 0, y: 0, width: 40, height: 40 });
      const rendered = await renderPdfToPngBuffers(await output.save(), 2);
      const image = await loadImage(rendered.pages[0].png);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const center = context.getImageData(image.width / 2, image.height / 2, 1, 1).data;

      expect(center[0]).toBeLessThan(32);
      expect(center[1]).toBeLessThan(32);
      expect(center[2]).toBeLessThan(32);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
