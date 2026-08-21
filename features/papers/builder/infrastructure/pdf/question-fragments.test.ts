import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import type { RegionPageLayout } from "../../domain/region-render";
import type { QuestionUnit, SourcePageAsset } from "@/shared/domain/paper";
import { prepareQuestionFragments } from "./question-fragments";

const anchor = {
  pageNumber: 1,
  numberBounds: { x0: 40, x1: 58, y0: 150, y1: 166 },
  promptBaseline: 158,
  promptBounds: { x0: 64, x1: 420, y0: 140, y1: 170 },
};

function unit(subjectSlug: string, overrides: Partial<QuestionUnit> = {}): QuestionUnit {
  const part = {
    partKey: "part-1",
    unitKey: "unit-1",
    taggedPaperId: "paper-1",
    sourceRelativePath: `edexcel/${subjectSlug}.pdf`,
    questionPaperCdnUrl: null,
    questionPaperFileName: null,
    pageAssetCdnUrls: [],
    boardCode: subjectSlug.startsWith("aqa") ? "aqa" : subjectSlug.startsWith("ocr") ? "ocr" : "edexcel",
    subjectSlug,
    paperCode: "1",
    year: 2024,
    session: "summer",
    questionId: "q-1",
    questionNumber: "1",
    questionPartNumber: null,
    sectionCode: null,
    sectionName: null,
    marks: 2,
    canonicalLeaf: "topic",
    promptText: "Explain the process shown in the question.",
    contextText: null,
    pageNumber: 1,
    pageNumbers: [1],
    bbox: { x0: 40, x1: 420, y0: 120, y1: 180 },
    identityAnchor: anchor,
    regionSpans: [{ pageNumber: 1, yTop: 180, yBottom: 100 }],
    stemSpans: [],
    referencedFigures: [],
    sourceMode: "tagged",
    assetIds: [],
  } satisfies QuestionUnit["parts"][number];

  return {
    unitKey: "unit-1",
    groupUnitKey: "unit-1",
    sourceQuestionKey: "source-1",
    sourceRelativePath: part.sourceRelativePath,
    questionPaperCdnUrl: null,
    questionPaperFileName: null,
    boardCode: part.boardCode,
    subjectSlug,
    paperCode: "1",
    year: 2024,
    session: "summer",
    questionNumber: "1",
    sectionCode: null,
    sectionName: null,
    totalMarks: 2,
    canonicalLeafs: ["topic"],
    parts: [part],
    pages: [{ pageNumber: 1, parts: [part], bboxUnion: part.bbox }],
    ...overrides,
  };
}

function layout(): RegionPageLayout {
  return {
    pageNumber: 1,
    pageWidth: 500,
    pageHeight: 300,
    contentX0: 0,
    contentX1: 500,
    headerFloorY: 300,
    footerCeilingY: 0,
  };
}

async function sourceAsset() {
  const directory = mkdtempSync(join(tmpdir(), "gcsemeta-fragments-"));
  const path = join(directory, "source.pdf");
  const document = await PDFDocument.create();
  const page = document.addPage([500, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("1. Explain the process shown in the question.", { x: 40, y: 150, size: 12, font });
  page.drawText("P12345678", { x: 20, y: 12, size: 8, font });
  writeFileSync(path, await document.save());
  const asset = {
    sourceRelativePath: "edexcel/edexcel-business.pdf",
    pageNumber: 1,
    cdnUrl: path,
    fileName: "page-001.pdf",
    relativePath: path,
  } satisfies SourcePageAsset;
  return { directory, assets: new Map([[asset.sourceRelativePath, [asset]]]) };
}

async function sourceAssetsForPages(pageNumbers: number[]) {
  const directory = mkdtempSync(join(tmpdir(), "gcsemeta-fragments-pages-"));
  const path = join(directory, "source.pdf");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const pageNumber of pageNumbers) {
    const page = document.addPage([500, 300]);
    page.drawText(`${pageNumber}. Explain the process shown in the question.`, { x: 40, y: 150, size: 12, font });
  }
  writeFileSync(path, await document.save());
  const assets = pageNumbers.map((pageNumber) => ({
    sourceRelativePath: "edexcel/edexcel-business.pdf",
    pageNumber,
    cdnUrl: path,
    fileName: `page-${String(pageNumber).padStart(3, "0")}.pdf`,
    relativePath: path,
  } satisfies SourcePageAsset));
  return { directory, assets: new Map([["edexcel/edexcel-business.pdf", assets]]) };
}

describe("prepareQuestionFragments", () => {
  it.each([
    ["aqa", "geography"],
    ["aqa", "business"],
    ["aqa", "english-language"],
    ["aqa", "english-literature"],
    ["edexcel", "business"],
    ["edexcel", "combined-science"],
    ["edexcel", "mathematics-higher"],
    ["edexcel", "french-reading"],
    ["ocr", "computer-science"],
  ])("prepares trusted geometry for %s %s", async (boardCode, subjectSlug) => {
    const source = await sourceAsset();
    try {
      const result = await prepareQuestionFragments({
        unit: unit(subjectSlug, { boardCode }),
        allUnits: [],
        pageAssetsBySource: new Map([[`edexcel/${subjectSlug}.pdf`, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout()],
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments).toHaveLength(1);
      expect(result.fragments[0]).toMatchObject({
        fragmentId: "unit-1:1:0",
        sourcePageNumber: 1,
        crop: { left: 0, right: 500, bottom: 100, top: 180 },
        identity: anchor,
        kind: "question",
      });
      expect(result.sources.has("unit-1:1:0")).toBe(true);
      expect(result.kind === "success" && result.sources.get("unit-1:1:0")?.candidate.pdfUrl).toContain("-40-58-150-166");
      const visualDirectory = process.env.QUESTION_FRAGMENT_VISUAL_DIR;
      if (visualDirectory) {
        mkdirSync(visualDirectory, { recursive: true });
        const source = result.sources.get("unit-1:1:0");
        if (!source) throw new Error("Missing prepared source for visual artifact.");
        const rendered = await renderPdfToPngBuffers(await source.sourceDoc.save(), 1);
        writeFileSync(join(visualDirectory, `${boardCode}-${subjectSlug}.png`), rendered.pages[0].png);
      }
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("keeps support text and gives identity only to the first question fragment", async () => {
    const source = await sourceAsset();
    try {
      const current = unit("business", {
        parts: [{ ...unit("business").parts[0], stemSpans: [{ pageNumber: 1, yTop: 290, yBottom: 230 }] }],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout()],
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments.map((fragment) => fragment.kind)).toEqual(["support", "question"]);
      expect(result.fragments.map((fragment) => fragment.identity)).toEqual([null, anchor]);
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("masks a source number in every same-page fragment while anchoring to the question prompt", async () => {
    const source = await sourceAsset();
    try {
      const splitAnchor = {
        pageNumber: 1,
        numberBounds: { x0: 40, x1: 58, y0: 250, y1: 266 },
        promptBaseline: 158,
        promptBounds: { x0: 64, x1: 420, y0: 140, y1: 170 },
      };
      const current = unit("business", {
        parts: [{
          ...unit("business").parts[0],
          identityAnchor: splitAnchor,
          stemSpans: [{ pageNumber: 1, yTop: 290, yBottom: 230 }],
        }],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout()],
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments.map((fragment) => fragment.identity)).toEqual([null, splitAnchor]);
      expect(result.sources.get("unit-1:1:0")?.candidate.pdfUrl).toContain("-40-58-250-266");
      expect(result.sources.get("unit-1:1:1")?.candidate.pdfUrl).toContain("-40-58-250-266");
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("accepts identical anchors propagated across multipart parts", async () => {
    const source = await sourceAsset();
    try {
      const current = unit("business", {
        parts: [
          unit("business").parts[0],
          { ...unit("business").parts[0], partKey: "part-2" },
        ],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout()],
      });

      expect(result.kind).toBe("success");
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("rejects distinct anchors on the first question page as ambiguous", async () => {
    const current = unit("business", {
      parts: [
        unit("business").parts[0],
        { ...unit("business").parts[0], partKey: "part-2", identityAnchor: { ...anchor, numberBounds: { ...anchor.numberBounds, x0: 70, x1: 88 } } },
      ],
    });
    const result = await prepareQuestionFragments({
      unit: current,
      allUnits: [],
      pageAssetsBySource: new Map(),
      figures: [],
      pageLayouts: [layout()],
    });

    expect(result).toEqual({ kind: "unrenderable", unitKey: "unit-1", page: 1, reason: "ambiguous-anchor" });
  });

  it("selects the anchor on the first question page when parts are reordered", async () => {
    const source = await sourceAssetsForPages([1, 2]);
    try {
      const firstPageAnchor = { ...anchor, pageNumber: 2, numberBounds: { x0: 40, x1: 58, y0: 150, y1: 166 }, promptBounds: { x0: 64, x1: 420, y0: 140, y1: 170 } };
      const current = unit("business", {
        parts: [
          { ...unit("business").parts[0], partKey: "support", pageNumber: 1, pageNumbers: [1], regionSpans: [], stemSpans: [{ pageNumber: 1, yTop: 290, yBottom: 230 }], identityAnchor: { ...anchor, pageNumber: 1 } },
          { ...unit("business").parts[0], partKey: "question", pageNumber: 2, pageNumbers: [2], regionSpans: [{ pageNumber: 2, yTop: 180, yBottom: 100 }], identityAnchor: firstPageAnchor },
        ],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout(), { ...layout(), pageNumber: 2 }],
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments.find((fragment) => fragment.kind === "question")?.identity).toEqual(firstPageAnchor);
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("treats an earlier stem owned by the question as its first question fragment", async () => {
    const source = await sourceAssetsForPages([1, 2]);
    try {
      const current = unit("business", {
        parts: [{
          ...unit("business").parts[0],
          pageNumber: 2,
          pageNumbers: [2],
          identityAnchor: anchor,
          regionSpans: [{ pageNumber: 2, yTop: 180, yBottom: 100 }],
          stemSpans: [{ pageNumber: 1, yTop: 180, yBottom: 100 }],
        }],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout(), { ...layout(), pageNumber: 2 }],
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments.map((fragment) => fragment.kind)).toEqual(["question", "continuation"]);
      expect(result.fragments.map((fragment) => fragment.identity)).toEqual([anchor, null]);
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("treats an earlier region span as support when the part starts on the next page", async () => {
    const source = await sourceAssetsForPages([1, 2]);
    try {
      const pageTwoAnchor = { ...anchor, pageNumber: 2 };
      const current = unit("business", {
        parts: [{
          ...unit("business").parts[0],
          pageNumber: 2,
          pageNumbers: [1, 2],
          identityAnchor: pageTwoAnchor,
          regionSpans: [
            { pageNumber: 1, yTop: 180, yBottom: 100 },
            { pageNumber: 2, yTop: 180, yBottom: 100 },
          ],
        }],
      });
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: [layout(), { ...layout(), pageNumber: 2 }],
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.fragments.map((fragment) => fragment.kind)).toEqual(["support", "question"]);
      expect(result.fragments.map((fragment) => fragment.identity)).toEqual([null, pageTwoAnchor]);
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("fails before cropping when a required source page has no layout", async () => {
    const current = unit("business", {
      parts: [{
        ...unit("business").parts[0],
        regionSpans: [
          { pageNumber: 1, yTop: 180, yBottom: 100 },
          { pageNumber: 2, yTop: 180, yBottom: 100 },
        ],
      }],
    });
    const result = await prepareQuestionFragments({
      unit: current,
      allUnits: [],
      pageAssetsBySource: new Map(),
      figures: [],
      pageLayouts: [layout()],
    });

    expect(result).toEqual({ kind: "unrenderable", unitKey: "unit-1", page: 2, reason: "missing-page-layout" });
  });

  it.each([
    ["missing anchor", { identityAnchor: null }, "missing-anchor"],
    ["anchor page mismatch", { identityAnchor: { ...anchor, pageNumber: 2 } }, "anchor-page-mismatch"],
    ["anchor outside crop", { identityAnchor: { ...anchor, numberBounds: { ...anchor.numberBounds, x0: 700, x1: 720 } } }, "anchor-out-of-crop"],
    ["missing source asset", {}, "missing-source-asset"],
    ["missing page layout", {}, "missing-page-layout"],
  ])("returns typed unrenderable state for %s", async (_label, partOverrides, reason) => {
    const current = unit("business", { parts: [{ ...unit("business").parts[0], ...partOverrides }] });
    const source = await sourceAsset();
    try {
      const result = await prepareQuestionFragments({
        unit: current,
        allUnits: [],
        pageAssetsBySource: reason === "missing-source-asset" ? new Map() : new Map([[current.sourceRelativePath, source.assets.get("edexcel/edexcel-business.pdf") ?? []]]),
        figures: [],
        pageLayouts: reason === "missing-page-layout" ? [] : [layout()],
      });
      expect(result).toEqual({ kind: "unrenderable", unitKey: "unit-1", page: 1, reason });
    } finally {
      rmSync(source.directory, { recursive: true, force: true });
    }
  });

  it("rejects an ambiguous or unavailable persisted anchor without guessing", async () => {
    const current = unit("business", { parts: [{ ...unit("business").parts[0], identityAnchor: null }] });
    const result = await prepareQuestionFragments({
      unit: current,
      allUnits: [],
      pageAssetsBySource: new Map(),
      figures: [],
      pageLayouts: [layout()],
    });
    expect(result.kind).toBe("unrenderable");
    if (result.kind !== "unrenderable") return;
    expect(result.reason).toBe("missing-anchor");
  });
});
