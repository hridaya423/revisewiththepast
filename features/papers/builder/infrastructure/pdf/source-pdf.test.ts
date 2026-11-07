import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { extractPdfPageTexts, getPdfDocument, renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import { prepareSnippet, rasterizeSourcePdfPage, sourceBoundsToRasterMask } from "./source-pdf";

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

  it("reports answer-line-only pages as having no meaningful text", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("........................................................", { x: 30, y: 120, size: 8, font });
    page.drawText("TOTAL FOR SECTION B = 30 MARKS", { x: 80, y: 30, size: 10, font });
    page.drawText("*P67619A01624*", { x: 110, y: 10, size: 8, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-answer-lines-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
      });
      expect(raster.hasMeaningfulText).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("identifies OCR additional answer sheets", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("EXTRA ANSWER SPACE", { x: 90, y: 160, size: 12, font });
    page.drawText("If you need extra space use these lined pages.", { x: 30, y: 140, size: 9, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-ocr-answer-sheet-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        boardCode: "ocr",
      });
      expect(raster.isAdditionalAnswerPage).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("identifies OCR line-only continuation sheets", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("19", { x: 20, y: 180, size: 9, font });
    page.drawText("........................................................", { x: 30, y: 120, size: 8, font });
    page.drawText("PMT", { x: 250, y: 10, size: 8, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-ocr-lines-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        boardCode: "ocr",
      });
      expect(raster.isAdditionalAnswerPage).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not treat footer-adjacent words as barcodes", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Identify", { x: 30, y: 10, size: 10, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-footer-word-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
      });
      expect(raster.hasMeaningfulText).toBe(true);
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
    page.drawRectangle({ x: 100, y: 50, width: 20, height: 20, color: rgb(0, 0, 0) });
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
      // A reference inside a masked furniture line is dead — redrawing it
      // would paint a lone digit into whitespace.
      expect(raster.crossRefs.filter((entry) => entry.sourceNumber === "6")).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("drops the cross-ref when a 'Total for Question N' line is split into word items", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("(Total for", { x: 120, y: 80, size: 12, font });
    page.drawText("Question", { x: 185, y: 80, size: 12, font });
    page.drawText("6", { x: 235, y: 80, size: 12, font });
    page.drawText("= 4 marks)", { x: 243, y: 80, size: 12, font });
    page.drawText("Answer content", { x: 30, y: 110, size: 14, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-total-split-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        sourceQuestionNumber: "6",
      });
      expect(raster.crossRefs.filter((entry) => entry.sourceNumber === "6")).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("masks a vector margin arrow while preserving same-row marks brackets", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Answer content", { x: 30, y: 110, size: 14, font });
    page.drawText("................................................", { x: 30, y: 70, size: 10, font });
    page.drawText("[4 marks]", { x: 232, y: 70, size: 10, font });
    // Vector "turn over" arrowhead below the last answer line — no text item,
    // isolated in the right band.
    page.drawSvgPath("M 262 30 L 274 36 L 262 42 Z", { color: rgb(0, 0, 0) });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-arrow-"));
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
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };
      // Arrow: pdf x 262-274, y 30-42 → raster x 524-548, y ~308-332.
      expect(darkPixelCount(context.getImageData(518, 302, 44, 36).data)).toBe(0);
      // Marks bracket shares its row with the dotted rule — must survive.
      expect(darkPixelCount(context.getImageData(455, 245, 120, 30).data)).toBeGreaterThan(50);
      expect(darkPixelCount(context.getImageData(50, 145, 190, 45).data)).toBeGreaterThan(50);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("masks AQA question headers while preserving the adjacent topic heading", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Question 7", { x: 30, y: 140, size: 14, font });
    page.drawText("The living world", { x: 120, y: 140, size: 14, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-question-header-"));
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
      const sourceHeader = context.getImageData(50, 85, 170, 70).data;
      const topicHeading = context.getImageData(230, 85, 250, 70).data;
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };

      expect(darkPixelCount(sourceHeader)).toBe(0);
      expect(darkPixelCount(topicHeading)).toBeGreaterThan(50);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves a row of axis tick digits while still masking a lone page number", async () => {
    const digitRow = await PDFDocument.create();
    const digitPage = digitRow.addPage([300, 200]);
    const font = await digitRow.embedFont(StandardFonts.Helvetica);
    for (const [text, x] of [["0", 40], ["10", 80], ["20", 120], ["30", 160], ["40", 200], ["50", 240]] as const) {
      digitPage.drawText(text, { x, y: 15, size: 10, font });
    }
    digitPage.drawText("Delay in minutes", { x: 110, y: 4, size: 9, font });
    const loneDigit = await PDFDocument.create();
    const lonePage = loneDigit.addPage([300, 200]);
    lonePage.drawText("7", { x: 150, y: 15, size: 10, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-digit-rows-"));

    try {
      const rowPath = join(directory, "row.pdf");
      const lonePath = join(directory, "lone.pdf");
      writeFileSync(rowPath, await digitRow.save());
      writeFileSync(lonePath, await loneDigit.save());
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };
      const regionPixels = async (raster: Awaited<ReturnType<typeof rasterizeSourcePdfPage>>, x: number, y: number, w: number, h: number) => {
        const rendered = await renderPdfToPngBuffers(await raster.sourceDoc.save(), 2);
        const image = await loadImage(rendered.pages[0].png);
        const canvas = createCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(x, y, w, h).data;
      };

      const rowRaster = await rasterizeSourcePdfPage(rowPath, 0, new Map(), new Map(), { sanitizeFurniture: true });
      // pdf y=15 → raster originY ≈ 370; glyphs span roughly y 350–372 at scale 2.
      expect(darkPixelCount(await regionPixels(rowRaster, 75, 350, 25, 25))).toBeGreaterThan(10);
      expect(darkPixelCount(await regionPixels(rowRaster, 475, 350, 30, 25))).toBeGreaterThan(10);
      expect(darkPixelCount(await regionPixels(rowRaster, 215, 372, 120, 20))).toBeGreaterThan(10);

      const loneRaster = await rasterizeSourcePdfPage(lonePath, 0, new Map(), new Map(), { sanitizeFurniture: true });
      expect(darkPixelCount(await regionPixels(loneRaster, 295, 350, 25, 25))).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("registers a cross-ref patch for a fused 'Question 5' item mid-sentence", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("You are advised to plan your answer to Question 5 before you start to write.", { x: 30, y: 120, size: 9, font });
    page.drawText("Keep this answer text", { x: 30, y: 60, size: 12, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-qref-"));

    try {
      const sourcePath = join(directory, "source.pdf");
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), { sanitizeFurniture: true });
      const ref = raster.crossRefs.find((entry) => entry.sourceNumber === "5");
      expect(ref).toBeDefined();
      expect(ref!.bounds.x0).toBeGreaterThan(150);
      expect(ref!.bounds.x1).toBeLessThan(270);
      // Other digits in the same sentence must not become refs.
      expect(raster.crossRefs.filter((entry) => entry.sourceNumber !== "5")).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("masks the Edexcel bottom progress strip while preserving nearby content", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Keep this answer text", { x: 30, y: 60, size: 12, font });
    // Answer-box bottom rule: 140pt wide, ~20pt above the squares.
    page.drawRectangle({ x: 30, y: 30, width: 140, height: 0.75, color: rgb(0, 0, 0) });
    // Progress squares: 5 filled 5.5pt boxes with 2pt gaps, page-bottom zone.
    for (let index = 0; index < 5; index += 1) {
      page.drawRectangle({ x: 30 + index * 7.5, y: 12, width: 5.5, height: 6, color: rgb(0, 0, 0) });
    }
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-strip-"));
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
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };
      // Raster y = 2 * (200 - pdfY): squares ≈ 364-376, rule ≈ 339-341, text ≈ 256-280.
      expect(darkPixelCount(context.getImageData(55, 358, 90, 25).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(55, 334, 300, 15).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(55, 252, 200, 35).data)).toBeGreaterThan(50);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("masks AQA answer-line index digits while preserving the answer rule", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Write your answer on the lines below.", { x: 30, y: 150, size: 10, font });
    // Numbered answer lines: "1 ___", "2 ___" — the digit is source furniture.
    page.drawText("1", { x: 30, y: 120, size: 10, font });
    page.drawRectangle({ x: 42, y: 119, width: 150, height: 0.75, color: rgb(0, 0, 0) });
    page.drawText("2", { x: 30, y: 90, size: 10, font });
    page.drawRectangle({ x: 42, y: 89, width: 150, height: 0.75, color: rgb(0, 0, 0) });
    // A lone digit with no rule beside it is content, not a line index.
    page.drawText("3", { x: 30, y: 50, size: 10, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-line-idx-"));
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
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };
      // Raster y = 2 * (200 - pdfY): "1" ≈ rows 140-165, "2" ≈ rows 200-225, "3" ≈ 280-305.
      expect(darkPixelCount(context.getImageData(55, 140, 20, 25).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(55, 200, 20, 25).data)).toBe(0);
      // The rules themselves survive: 300px runs beside each masked digit.
      expect(darkPixelCount(context.getImageData(84, 155, 300, 12).data)).toBeGreaterThan(50);
      expect(darkPixelCount(context.getImageData(84, 215, 300, 12).data)).toBeGreaterThan(50);
      // Control digit untouched.
      expect(darkPixelCount(context.getImageData(55, 280, 20, 25).data)).toBeGreaterThan(10);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("masks only exact source number bounds when the prompt starts immediately beside the number", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    const numberFont = await source.embedFont(StandardFonts.HelveticaBold);
    page.drawText("2", { x: 30, y: 140, size: 14, font: numberFont });
    page.drawText("PROMPT", { x: 37, y: 140, size: 14, font });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-number-bounds-"));
    const sourcePath = join(directory, "source.pdf");
    const artifactDirectory = join(tmpdir(), "opencode", "source-number-mask");
    mkdirSync(artifactDirectory, { recursive: true });

    try {
      writeFileSync(sourcePath, await source.save());
      const viewport = (await getPdfDocument(new Uint8Array(await source.save()))).getPage(1)
        .then((pdfJsPage) => pdfJsPage.getViewport({ scale: 2 }));
      const rasterViewport = await viewport;
      const exactMask = sourceBoundsToRasterMask(
        { x0: 30, y0: 140, x1: 37, y1: 154 },
        rasterViewport,
      );
      expect(exactMask.left).toBe(60);
      expect(exactMask.right).toBe(74);
      expect(exactMask.top).toBe(92);
      expect(exactMask.bottom).toBe(120);

      const before = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        sourceQuestionNumber: "2",
      });
      const after = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        sourceQuestionNumber: "2",
        numberBounds: { x0: 30, y0: 140, x1: 37, y1: 154 },
      });
      writeFileSync(join(artifactDirectory, "before-guessed-mask.png"), (await renderPdfToPngBuffers(await before.sourceDoc.save(), 2)).pages[0].png);
      writeFileSync(join(artifactDirectory, "after-exact-mask.png"), (await renderPdfToPngBuffers(await after.sourceDoc.save(), 2)).pages[0].png);
      expect(exactMask.right).toBeLessThan(2 * 37.1);
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

  it("clears all four crop-boundary seams without erasing interior graph and table lines", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    page.drawRectangle({ x: 20, y: 20, width: 260, height: 160, borderWidth: 2, borderColor: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 100, y: 60 }, end: { x: 100, y: 140 }, thickness: 2, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 120, y: 80, width: 80, height: 40, borderWidth: 2, borderColor: rgb(0, 0, 0) });
    const directory = mkdtempSync(join(tmpdir(), "gcsemeta-raster-crop-frame-"));
    const sourcePath = join(directory, "source.pdf");

    try {
      writeFileSync(sourcePath, await source.save());
      const raster = await rasterizeSourcePdfPage(sourcePath, 0, new Map(), new Map(), {
        sanitizeFurniture: true,
        cropBox: { left: 20, right: 280, bottom: 20, top: 180 },
      });
      const rendered = await renderPdfToPngBuffers(await raster.sourceDoc.save(), 2);
      const image = await loadImage(rendered.pages[0].png);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const darkPixelCount = (pixels: Uint8ClampedArray) => {
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) count += 1;
        }
        return count;
      };

      expect(darkPixelCount(context.getImageData(80, 36, 440, 12).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(80, 352, 440, 12).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(36, 70, 12, 260).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(552, 70, 12, 260).data)).toBe(0);
      expect(darkPixelCount(context.getImageData(194, 120, 12, 160).data)).toBeGreaterThan(100);
      expect(darkPixelCount(context.getImageData(236, 156, 168, 88).data)).toBeGreaterThan(200);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
