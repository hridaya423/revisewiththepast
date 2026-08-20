import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
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

  it("masks source question totals while preserving answer content", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Answer content", { x: 30, y: 110, size: 14, font });
    page.drawText("(Total for Question 6 = 4 marks)", { x: 120, y: 80, size: 12, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-total-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        sourceQuestionNumber: "6",
      });
      const rendered = await renderPdfToPngBuffers(await raster.sourceDoc.save(), 2);
      const image = await loadImage(rendered.pages[0].png);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const answerPixels = context.getImageData(50, 145, 190, 45).data;
      const totalPixels = context.getImageData(230, 205, 360, 50).data;
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };

      expect(darkPixelCount(answerPixels)).toBeGreaterThan(50);
      expect(darkPixelCount(totalPixels)).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("removes identified source furniture while preserving content at every page edge", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Cumulative frequency", { x: 4, y: 110, size: 12, font });
    page.drawText("minutes", { x: 254, y: 110, size: 12, font });
    page.drawText("Top content", { x: 100, y: 182, size: 12, font });
    page.drawText("Bottom content", { x: 100, y: 6, size: 12, font });
    page.drawText("DO NOT WRITE IN THIS AREA", { x: 120, y: 60, size: 9, font });
    page.drawText("DO NOT WRITE IN THIS AREA", { x: 292, y: 30, size: 9, font, rotate: degrees(90) });
    page.drawLine({ start: { x: 220, y: 74 }, end: { x: 286, y: 74 }, thickness: 2, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 12, y: 125, width: 1, height: 45, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 10, y: 135, width: 35, height: 4, color: rgb(0, 0, 0) });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-edge-labels-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
      });
      const rendered = await renderPdfToPngBuffers(await raster.sourceDoc.save(), 2);
      const image = await loadImage(rendered.pages[0].png);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const leftLabel = context.getImageData(0, 145, 190, 55).data;
      const rightLabel = context.getImageData(500, 145, 100, 55).data;
      const topContent = context.getImageData(190, 10, 180, 55).data;
      const bottomContent = context.getImageData(190, 350, 200, 45).data;
      const warning = context.getImageData(225, 245, 275, 45).data;
      const rotatedFurnitureTop = context.getImageData(580, 0, 20, 140).data;
      const rotatedFurnitureBottom = context.getImageData(580, 220, 20, 180).data;
      const graphAxis = context.getImageData(22, 60, 8, 100).data;
      const edgeAnswerLine = context.getImageData(438, 246, 136, 16).data;
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };

      expect(darkPixelCount(leftLabel)).toBeGreaterThan(50);
      expect(darkPixelCount(rightLabel)).toBeGreaterThan(20);
      expect(darkPixelCount(topContent)).toBeGreaterThan(20);
      expect(darkPixelCount(bottomContent)).toBeGreaterThan(20);
      expect(darkPixelCount(warning)).toBe(0);
      expect(darkPixelCount(rotatedFurnitureTop)).toBeLessThan(300);
      expect(darkPixelCount(rotatedFurnitureBottom)).toBeLessThan(300);
      expect(darkPixelCount(graphAxis)).toBeGreaterThan(20);
      expect(darkPixelCount(edgeAnswerLine)).toBeGreaterThan(80);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
