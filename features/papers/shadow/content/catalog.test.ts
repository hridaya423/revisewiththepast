import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildShadowPaperInventory, loadInventoryRecords } from "@/scripts/shadow-paper-inventory";
import { generatePaperVariant } from "../domain/template-registry";
import { templateRevisionKey } from "../domain/types";
import { SHADOW_MANIFESTS, SHADOW_TEMPLATE_REGISTRY, findShadowManifest, listShadowManifests } from "./catalog";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const pilot = SHADOW_MANIFESTS.find((manifest) => manifest.source.sourcePaperId === "edexcel-gcse-mathematics-higher-2019-june-paper-1")!;

describe("shadow manifest completeness", () => {
  it("records the exact pilot sitting", () => {
    expect(pilot).toBeDefined();
    expect(pilot.source).toMatchObject({ specCode: "1MA1", tier: "higher", year: 2019, session: "june", paperCode: "paper-1", calculator: "not-allowed", totalMarks: 80, durationMinutes: 90 });
  });

  it("covers every question in the source inventory, in order, with no omissions", () => {
    const inventory = buildShadowPaperInventory(loadInventoryRecords("edexcel-mathematics-higher"));
    const entry = inventory.papers.find((paper) => paper.sourcePaperId === pilot.source.sourcePaperId);
    expect(entry?.status).toBe("complete");
    expect(entry?.sourcePdfSha256).toBe(pilot.provenance.questionPdfSha256);
    const questionNumbers = [...new Set(entry!.questionLabels.map((label) => Number.parseInt(label, 10)))];
    expect(pilot.units.map((unit) => unit.questionNumber)).toEqual(questionNumbers);
  });

  it("binds every unit to a registered template with matching key, parts and marks", () => {
    for (const unit of pilot.units) {
      expect(unit.classification, `Q${unit.questionNumber}`).toBe("template");
      const template = SHADOW_TEMPLATE_REGISTRY.get(unit.templateRevision!, { allowDraft: true });
      expect(templateRevisionKey(template)).toBe(unit.templateRevision);
      expect(template.sourceUnitKey).toBe(unit.sourceUnitKey);
      expect(template.sourceQuestionNumber).toBe(unit.questionNumber);
      const parts = template.structure.map((part) => ({ path: part.partId ? `${unit.questionNumber}(${part.partId})` : String(unit.questionNumber), marks: part.marks }));
      expect(parts).toEqual(unit.parts);
    }
    expect(pilot.units.reduce((sum, unit) => sum + unit.marks, 0)).toBe(80);
  });

  it("has no unchanged questions that would need disclosure", () => {
    expect(pilot.units.filter((unit) => unit.classification === "unchanged")).toEqual([]);
  });

  it("generates a complete, deterministic, fully changed paper", () => {
    const seeds = ["a".repeat(64), "b".repeat(64), "0123456789abcdef".repeat(4)];
    const codes = new Set<string>();
    for (const paperSeed of seeds) {
      const variant = generatePaperVariant({ manifest: pilot, registry: SHADOW_TEMPLATE_REGISTRY, paperSeed, sha256, allowDraft: true });
      expect(variant.totalMarks).toBe(80);
      expect(variant.units).toHaveLength(22);
      expect(variant.displayCode).toMatch(/^SH-[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
      const again = generatePaperVariant({ manifest: pilot, registry: SHADOW_TEMPLATE_REGISTRY, paperSeed, sha256, allowDraft: true });
      expect(again.semanticHash).toBe(variant.semanticHash);
      codes.add(variant.displayCode);
    }
    expect(codes.size).toBe(seeds.length);
  });

  it("never prints code fragments or placeholders in questions or schemes", () => {
    for (const paperSeed of ["c".repeat(64), "7f3a".repeat(16), "91c2".repeat(16)]) {
      const variant = generatePaperVariant({ manifest: pilot, registry: SHADOW_TEMPLATE_REGISTRY, paperSeed, sha256, allowDraft: true });
      const printed = JSON.stringify(variant.units);
      expect(printed).not.toMatch(/BigInt|undefined|NaN|\[object |Infinity/u);
    }
  });

  it("hides draft and withdrawn manifests from the public catalogue", () => {
    const publicIds = listShadowManifests().map((manifest) => manifest.source.sourcePaperId);
    for (const manifest of SHADOW_MANIFESTS) {
      if (manifest.publicationStatus !== "approved") expect(publicIds).not.toContain(manifest.source.sourcePaperId);
    }
    expect(findShadowManifest("edexcel-gcse-mathematics-higher-2019-june-paper-1", { includeDraft: true })).not.toBeNull();
    expect(findShadowManifest("unknown-paper", { includeDraft: true })).toBeNull();
  });
});
