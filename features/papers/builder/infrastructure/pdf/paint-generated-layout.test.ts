import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { GENERATED_PAGE, type PlacedQuestionBlock } from "../../domain/generated-layout";
import type { PreparedFragmentSource } from "./question-fragments";
import { paintGeneratedLayout } from "./paint-generated-layout";
import { getGeneratedPageRole } from "./page-chrome";

async function textItems(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: bytes,
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.filter((item): item is typeof item & { str: string; transform: number[]; height: number; width: number } => (
      "str" in item && "transform" in item && "height" in item && "width" in item
    )));
  }
  return pages;
}

async function sourceMaterial() {
  const sourceDoc = await PDFDocument.create();
  const sourcePage = sourceDoc.addPage([300, 200]);
  sourcePage.setMediaBox(18, 26, 300, 200);
  sourcePage.setCropBox(18, 26, 300, 200);
  sourcePage.drawRectangle({ x: 30, y: 80, width: 100, height: 20 });
  return { sourceDoc, sourcePdfPage: sourcePage };
}

function block(overrides: Partial<PlacedQuestionBlock> = {}): PlacedQuestionBlock {
  return {
    unitKey: "unit-1",
    number: 7,
    numberSlot: {
      outputPageIndex: 0,
      x: 40,
      baseline: 500,
      fontSize: GENERATED_PAGE.numberFontSize,
    },
    fragments: [{
      fragmentId: "fragment-1",
      unitKey: "unit-1",
      sourcePageNumber: 1,
      crop: { left: 12, right: 180, bottom: 20, top: 140 },
      identity: null,
      width: 168,
      height: 120,
      kind: "question",
      outputPageIndex: 0,
      x: 120,
      y: 420,
      scale: 1,
    }],
    ...overrides,
  };
}

function sourceMap(source: Awaited<ReturnType<typeof sourceMaterial>>, fragmentId = "fragment-1") {
  return new Map<string, PreparedFragmentSource>([[fragmentId, {
    fragmentId,
    candidate: { pdfUrl: "fixture.pdf", sourcePageIndex: 0 },
    sourceDoc: source.sourceDoc,
    sourcePdfPage: source.sourcePdfPage,
  }]]);
}

describe("paintGeneratedLayout", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid question number %s",
    async (number) => {
      const outputDoc = await PDFDocument.create();
      const source = await sourceMaterial();
      await expect(paintGeneratedLayout(outputDoc, [block({ number })], sourceMap(source)))
        .rejects.toThrow(/invalid question number/i);
    },
  );

  it("rejects duplicate fragment IDs across blocks", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    await expect(paintGeneratedLayout(outputDoc, [block(), block({ unitKey: "unit-2", number: 8 })], sourceMap(source)))
      .rejects.toThrow(/duplicate.*fragment/i);
  });

  it("rejects a source map entry whose fragment ID does not match its key", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const mismatchedSource = sourceMap(source, "fragment-2");
    mismatchedSource.set("fragment-1", mismatchedSource.get("fragment-2")!);
    await expect(paintGeneratedLayout(outputDoc, [block()], mismatchedSource))
      .rejects.toThrow(/fragment.*match/i);
  });

  it.each([
    ["NaN x", { x: Number.NaN }],
    ["infinite baseline", { baseline: Number.POSITIVE_INFINITY }],
  ] as const)("rejects malformed number slot for %s", async (_label, numberSlot) => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    await expect(paintGeneratedLayout(outputDoc, [block({ numberSlot: { ...block().numberSlot, ...numberSlot } })], sourceMap(source)))
      .rejects.toThrow(/number slot/i);
  });

  it.each([
    ["NaN x", { x: Number.NaN }],
    ["negative y", { y: -1 }],
    ["infinite width", { width: Number.POSITIVE_INFINITY }],
    ["negative height", { height: -1 }],
  ] as const)("rejects malformed fragment geometry for %s", async (_label, geometry) => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    await expect(paintGeneratedLayout(outputDoc, [block({ fragments: [{ ...block().fragments[0], ...geometry }] })], sourceMap(source)))
      .rejects.toThrow(/fragment.*(geometry|dimensions|position)/i);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid fragment scale %s", async (scale) => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    await expect(paintGeneratedLayout(outputDoc, [block({ fragments: [{ ...block().fragments[0], scale }] })], sourceMap(source)))
      .rejects.toThrow(/scale/i);
  });

  it("paints one generated number at its planned position using the shared font size", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();

    await paintGeneratedLayout(outputDoc, [block()], sourceMap(source));

    const pages = await textItems(await outputDoc.save());
    const numbers = pages.flat().filter((item) => item.str === "7");
    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.transform[4]).toBeCloseTo(40, 2);
    expect(numbers[0]?.transform[5]).toBeCloseTo(500, 2);
    expect(numbers[0]?.height).toBeCloseTo(GENERATED_PAGE.numberFontSize, 1);
  });

  it("paints typeset sources that carry only a fragment ID and page", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const sources = new Map([["fragment-1", { fragmentId: "fragment-1", sourcePdfPage: source.sourcePdfPage }]]);

    const pages = await paintGeneratedLayout(outputDoc, [block()], sources);

    expect(pages).toHaveLength(1);
    expect((await textItems(await outputDoc.save())).flat().some((item) => item.str === "7")).toBe(true);
  });

  it("repaints the generated marker as boxed digits inside the masked source number strip", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const identityFragment = {
      ...block().fragments[0],
      identity: {
        pageNumber: 1,
        numberBounds: { x0: 130, x1: 170, y0: 380, y1: 394 },
        promptBaseline: 385,
        promptBounds: { x0: 180, x1: 280, y0: 372, y1: 396 },
      },
      markers: [{
        numberBounds: { x0: 130, x1: 170, y0: 380, y1: 394 },
        partNumber: "1",
        text: "02.1",
      }],
    };

    await paintGeneratedLayout(outputDoc, [block({ fragments: [identityFragment] })], sourceMap(source));

    const pages = await textItems(await outputDoc.save());
    const glyphs = pages[0]?.map((item) => item.str.replace(/\s+/g, "")) ?? [];
    expect(glyphs).toEqual(expect.arrayContaining(["0", "2", ".", "1"]));
    expect(pages[0]?.filter((item) => item.str === "7")).toHaveLength(0);
    const stripLeft = 120 + 2;
    const stripRight = 120 + (170 + 4 - 12);
    const marker = pages[0]?.find((item) => item.str === "0");
    expect(marker).toBeDefined();
    expect(marker!.transform[4]).toBeGreaterThanOrEqual(stripLeft);
    expect(marker!.transform[4]).toBeLessThanOrEqual(stripRight);
    const stripHeight = 394 - 380 + 7;
    const boxHeight = Math.min(stripHeight - 1, stripHeight * 0.9);
    const stripBottom = 420 + (380 - 3.5 - 20);
    const boxBottom = stripBottom + (stripHeight - boxHeight) / 2;
    const baseline = boxBottom + (boxHeight - boxHeight * 0.62 * 0.72) / 2;
    expect(marker!.transform[5]).toBeCloseTo(baseline, 1);
  });

  it("repaints a two-cell marker for english literature", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const identityFragment = {
      ...block().fragments[0],
      identity: {
        pageNumber: 1,
        numberBounds: { x0: 130, x1: 170, y0: 380, y1: 394 },
        promptBaseline: 385,
        promptBounds: { x0: 180, x1: 280, y0: 372, y1: 396 },
      },
      markers: [{
        numberBounds: { x0: 130, x1: 170, y0: 380, y1: 394 },
        partNumber: null,
        text: "01",
      }],
    };

    await paintGeneratedLayout(outputDoc, [block({ fragments: [identityFragment] })], sourceMap(source));

    const pages = await textItems(await outputDoc.save());
    const digits = pages[0]?.map((item) => item.str.replace(/\s+/g, "")) ?? [];
    expect(digits).toEqual(expect.arrayContaining(["0", "1"]));
    expect(pages[0]?.filter((item) => item.str === "7")).toHaveLength(0);
  });

  it("redraws only cross-refs inside the fragment crop", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const fragment = {
      ...block().fragments[0],
      crossRefs: [
        // Inside the crop [12,20,180,140]: a "(Total for Question 5)" digit.
        { bounds: { x0: 60, x1: 68, y0: 50, y1: 60 }, baselineY: 52, fontHeight: 10, sourceNumber: "5" },
        // Outside the crop (below it): would paint a lone digit into whitespace.
        { bounds: { x0: 60, x1: 68, y0: 4, y1: 12 }, baselineY: 6, fontHeight: 10, sourceNumber: "9" },
      ],
    };

    await paintGeneratedLayout(outputDoc, [block({ fragments: [fragment] })], sourceMap(source));

    const pages = await textItems(await outputDoc.save());
    const items = pages[0] ?? [];
    expect(items.filter((item) => item.str === "5")).toHaveLength(1);
    expect(items.filter((item) => item.str === "9")).toHaveLength(0);
  });

  it("paints the maths total footer with its rule directly below the last fragment", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const footerText = "Total for Question 7 = 3 marks";

    await paintGeneratedLayout(outputDoc, [block({
      footer: { text: footerText, outputPageIndex: 0, x: GENERATED_PAGE.contentX, y: 380, ruleY: 394, fontSize: 10.5 },
    })], sourceMap(source));

    const pages = await textItems(await outputDoc.save());
    expect(pages[0]?.filter((item) => item.str === footerText)).toHaveLength(1);
  });

  it("preserves existing pages and treats output page indexes as relative content indexes", async () => {
    const outputDoc = await PDFDocument.create();
    outputDoc.addPage([300, 300]);
    const source = await sourceMaterial();

    await paintGeneratedLayout(outputDoc, [block(), block({
      unitKey: "unit-2",
      number: 8,
      numberSlot: { outputPageIndex: 1, x: 40, baseline: 400, fontSize: GENERATED_PAGE.numberFontSize },
      fragments: [{ ...block().fragments[0], fragmentId: "fragment-2", outputPageIndex: 1 }],
    })], new Map([...sourceMap(source), ["fragment-2", {
      fragmentId: "fragment-2",
      candidate: { pdfUrl: "fixture.pdf", sourcePageIndex: 0 },
      sourceDoc: source.sourceDoc,
      sourcePdfPage: source.sourcePdfPage,
    }]]));

    expect(outputDoc.getPageCount()).toBe(3);
    const pages = await textItems(await outputDoc.save());
    expect(pages[0]).toHaveLength(0);
    expect(pages[1]?.filter((item) => item.str === "7")).toHaveLength(1);
    expect(pages[2]?.filter((item) => item.str === "8")).toHaveLength(1);
  });

  it("creates deterministic generated page order and dimensions", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const createdPages = await paintGeneratedLayout(outputDoc, [block()], sourceMap(source));

    expect(createdPages).toHaveLength(1);
    expect(createdPages[0]?.getSize()).toEqual({ width: GENERATED_PAGE.width, height: GENERATED_PAGE.height });
    expect(outputDoc.getPages()[0]).toBe(createdPages[0]);
  });

  it("persists content and answer page roles through save and load", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    await paintGeneratedLayout(outputDoc, [block({ afterPage: { kind: "answer-space", marks: 2, outputPageIndex: 1 } })], sourceMap(source));

    const saved = await PDFDocument.load(await outputDoc.save());
    expect(getGeneratedPageRole(saved.getPages()[0]!)).toBe("question-content");
    expect(getGeneratedPageRole(saved.getPages()[1]!)).toBe("answer-space");
  });

  it("does not repeat numbers on continuation pages and paints fragment crops at scale", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const first = block();
    const continuation = { ...first.fragments[0], fragmentId: "fragment-2", kind: "continuation" as const, outputPageIndex: 1, scale: 0.5, x: 200, y: 300 };

    await paintGeneratedLayout(outputDoc, [block({ fragments: [first.fragments[0], continuation] })], new Map([
      ...sourceMap(source),
      ["fragment-2", { fragmentId: "fragment-2", candidate: { pdfUrl: "fixture.pdf", sourcePageIndex: 0 }, sourceDoc: source.sourceDoc, sourcePdfPage: source.sourcePdfPage }],
    ]));

    const pages = await textItems(await outputDoc.save());
    expect(pages).toHaveLength(2);
    expect(pages.flat().filter((item) => item.str === "7")).toHaveLength(1);
  });

  it("paints a footer on the last fragment page and keeps the ordinal unique", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();
    const first = block();
    const continuation = { ...first.fragments[0], fragmentId: "fragment-2", kind: "continuation" as const, outputPageIndex: 1, y: 300 };
    await paintGeneratedLayout(outputDoc, [block({
      fragments: [first.fragments[0], continuation],
      footer: { text: "Total for Question 1 = 2 marks", outputPageIndex: 1, x: 42, y: 28, ruleY: 42, fontSize: 10.5 },
    })], new Map([
      ...sourceMap(source),
      ["fragment-2", { fragmentId: "fragment-2", candidate: { pdfUrl: "fixture.pdf", sourcePageIndex: 0 }, sourceDoc: source.sourceDoc, sourcePdfPage: source.sourcePdfPage }],
    ]));

    const pages = await textItems(await outputDoc.save());
    expect(pages[0]?.some((item) => item.str.includes("Total for Question 1"))).toBe(false);
    expect(pages[1]?.some((item) => item.str.includes("Total for Question 1"))).toBe(true);
    expect(pages.flat().filter((item) => item.str === "7")).toHaveLength(1);
  });

  it("fails clearly for missing sources and crops outside the visible source page", async () => {
    const outputDoc = await PDFDocument.create();
    const source = await sourceMaterial();

    await expect(paintGeneratedLayout(outputDoc, [block()], new Map())).rejects.toThrow(/source.*fragment-1/i);
    await expect(paintGeneratedLayout(outputDoc, [block({ fragments: [{ ...block().fragments[0], crop: { left: 0, right: 400, bottom: 0, top: 100 } }] })], sourceMap(source))).rejects.toThrow(/crop.*visible/i);
  });
});
