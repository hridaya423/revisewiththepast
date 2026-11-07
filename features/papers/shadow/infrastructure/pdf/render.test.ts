import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { SHADOW_TEMPLATE_REGISTRY, findShadowManifest } from "../../content/catalog";
import { findShadowMarker } from "../../domain/marker";
import { generatePaperVariant } from "../../domain/template-registry";
import type { ShadowPaperVariant } from "../../domain/types";
import { ShadowRenderError, renderShadowPaperPdf, renderShadowSchemePdf } from "./render";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const manifest = findShadowManifest("edexcel-gcse-mathematics-higher-2019-june-paper-1", { includeDraft: true })!;
const variantFor = (seed: string) => generatePaperVariant({ manifest, registry: SHADOW_TEMPLATE_REGISTRY, paperSeed: seed, sha256, allowDraft: true });

async function pageTexts(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const content = await (await pdf.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/gu, " "));
  }
  return pages;
}

describe("shadow PDF rendering", () => {
  const seeds = ["1".repeat(64), "2".repeat(64), "fedcba9876543210".repeat(4)];

  it.each(seeds)("renders a complete paper and separate scheme for seed %s", async (seed) => {
    const variant = variantFor(seed);
    const [paper, scheme] = await Promise.all([renderShadowPaperPdf(variant), renderShadowSchemePdf(variant)]);
    const paperText = await pageTexts(paper.bytes);
    const schemeText = await pageTexts(scheme.bytes);
    expect(paper.pageCount).toBe(paperText.length);
    expect(paper.pageCount).toBeGreaterThanOrEqual(16);
    expect(paper.pageCount).toBeLessThanOrEqual(32);

    for (const text of [...paperText, ...schemeText]) expect(findShadowMarker(text) ?? text).toBe(variant.displayCode);
    expect(paperText.every((text) => text.includes("SHADOW PAPER"))).toBe(true);
    expect(schemeText.every((text) => text.includes("SHADOW MARK SCHEME"))).toBe(true);

    const joinedPaper = paperText.join(" ");
    const joinedScheme = schemeText.join(" ");
    for (const unit of variant.units) {
      const total = `(Total for Question ${unit.question.number} is ${unit.question.totalMarks} mark`;
      expect(joinedPaper).toContain(total);
      expect(joinedScheme).toContain(total);
    }
    expect(joinedPaper).toContain("(Total for paper is 80 marks)");
    expect(joinedPaper).not.toContain("Answer:");
    expect(joinedPaper).not.toContain("WORKED SOLUTION");
    expect(joinedScheme).toContain("WORKED SOLUTION");
    expect(joinedScheme.match(/Answer:/gu)?.length).toBeGreaterThanOrEqual(variant.units.reduce((sum, unit) => sum + unit.solution.parts.length, 0));
  });

  it("is byte-for-byte reproducible for the same variant and timestamp", async () => {
    const variant = variantFor("3".repeat(64));
    const createdAt = new Date("2026-11-01T10:00:00Z");
    const first = await renderShadowPaperPdf(variant, { createdAt });
    const second = await renderShadowPaperPdf(variant, { createdAt });
    expect(sha256(Buffer.from(first.bytes).toString("binary"))).toBe(sha256(Buffer.from(second.bytes).toString("binary")));
  });

  it("records the variant in document metadata", async () => {
    const variant = variantFor("4".repeat(64));
    const doc = await PDFDocument.load((await renderShadowSchemePdf(variant)).bytes);
    expect(doc.getTitle()).toBe(`Shadow mark scheme ${variant.displayCode}`);
    expect(doc.getKeywords()).toContain(`variant:${variant.displayCode}`);
    expect(doc.getKeywords()).toContain("source:edexcel-gcse-mathematics-higher-2019-june-paper-1");
  });

  it("refuses content that would not print at full scale", async () => {
    const variant = variantFor("5".repeat(64));
    const broken: ShadowPaperVariant = {
      ...variant,
      units: variant.units.map((unit, index) => index === 0
        ? { ...unit, question: { ...unit.question, parts: unit.question.parts.map((part) => ({ ...part, working: 760 })) } }
        : unit),
    };
    await expect(renderShadowPaperPdf(broken)).rejects.toBeInstanceOf(ShadowRenderError);
  });

  it("renders 25 seeds without layout failures", async () => {
    for (let index = 0; index < 25; index += 1) {
      const variant = variantFor(sha256(`render-sweep-${index}`));
      await expect(renderShadowPaperPdf(variant)).resolves.toMatchObject({ kind: "paper" });
      await expect(renderShadowSchemePdf(variant)).resolves.toMatchObject({ kind: "mark-scheme" });
    }
  }, 120_000);
});
