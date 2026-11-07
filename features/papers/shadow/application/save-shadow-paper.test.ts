import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ShadowSaveError, planShadowSave, shadowDownloadPath, type ShadowQuestionForSave, type ShadowVariantForSave } from "@/convex/model/shadowSave";
import { SHADOW_TEMPLATE_REGISTRY, findShadowManifest } from "../content/catalog";
import { generatePaperVariant } from "../domain/template-registry";
import { buildPublication } from "./generate-shadow-paper";

const NOW = 1_800_000_000_000;
const manifest = findShadowManifest("edexcel-gcse-mathematics-higher-2019-june-paper-1", { includeDraft: true })!;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function stored(seed: string, ownerId: string, id: string) {
  const variant = generatePaperVariant({ manifest, registry: SHADOW_TEMPLATE_REGISTRY, paperSeed: seed, sha256, allowDraft: true });
  const artifact = { storageId: `storage-${id}`, sha256: "f".repeat(64), fileSize: 1234, pageCount: 20 };
  const publication = buildPublication(variant, { paper: artifact, markScheme: { ...artifact, storageId: `storage-${id}-ms` } }, { rendererVersion: "v", validation: { checks: 1, failed: 0 } });
  const record: ShadowVariantForSave = {
    ...publication.variant,
    _id: id,
    ownerId,
    questionCount: publication.questions.length,
    manifestRevision: manifest.revision,
    expiresAt: NOW + 1000,
  };
  const questions: ShadowQuestionForSave[] = publication.questions.map((question, index) => ({ ...question, _id: `${id}-q${index}` }));
  return { record, questions, variant };
}

describe("planShadowSave", () => {
  it("builds saved rows from snapshots with unique variant keys and source provenance", () => {
    const { record, questions } = stored("a".repeat(64), "owner-a", "variant-a");
    const plan = planShadowSave({ variant: record, questions, ownerId: "owner-a", now: NOW });
    expect(plan.savedPaper).toMatchObject({ ownerId: "owner-a", generationKind: "shadow", totalMarks: 80, questionCount: 22, importKey: "shadow:variant-a", pdfUrl: shadowDownloadPath("variant-a", "paper") });
    expect(plan.questions).toHaveLength(22);
    expect(new Set(plan.questions.map((question) => question.unitKey)).size).toBe(22);
    expect(plan.questions[0]).toMatchObject({ unitKey: "shadow:variant-a:1", sourceQuestionKey: questions[0]!.sourceUnitKey, shadowQuestionVariantId: "variant-a-q0" });
    expect(plan.questions.every((question) => question.promptText.length > 0)).toBe(true);
    expect(plan.receipt).toMatchObject({ ownerId: "owner-a", generationKind: "shadow", markSchemeSha256: "f".repeat(64) });
  });

  it("refuses another owner's variant even when the PDF hashes match", () => {
    const first = stored("a".repeat(64), "owner-a", "variant-a");
    const second = stored("b".repeat(64), "owner-b", "variant-b");
    expect(first.record.paper.sha256).toBe(second.record.paper.sha256);
    expect(() => planShadowSave({ variant: first.record, questions: first.questions, ownerId: "owner-b", now: NOW })).toThrow(ShadowSaveError);
    const own = planShadowSave({ variant: second.record, questions: second.questions, ownerId: "owner-b", now: NOW });
    expect(own.savedPaper.importKey).toBe("shadow:variant-b");
    expect(own.questions[0]!.shadowQuestionVariantId).toBe("variant-b-q0");
  });

  it("rejects missing variants, expired variants and missing solutions", () => {
    const { record, questions } = stored("c".repeat(64), "owner-a", "variant-c");
    expect(() => planShadowSave({ variant: null, questions, ownerId: "owner-a", now: NOW })).toThrow("NOT_FOUND");
    expect(() => planShadowSave({ variant: record, questions, ownerId: "owner-a", now: NOW + 5000 })).toThrow("EXPIRED");
    expect(() => planShadowSave({ variant: record, questions: questions.slice(1), ownerId: "owner-a", now: NOW })).toThrow("MISSING_SNAPSHOT");
    const broken = questions.map((question, index) => (index === 3 ? { ...question, solutionJson: "{\"parts\":[]}" } : question));
    expect(() => planShadowSave({ variant: record, questions: broken, ownerId: "owner-a", now: NOW })).toThrow("MISSING_SNAPSHOT");
  });

  it("allows saving a saved (non-expiring) variant", () => {
    const { record, questions } = stored("d".repeat(64), "owner-a", "variant-d");
    expect(() => planShadowSave({ variant: { ...record, expiresAt: undefined }, questions, ownerId: "owner-a", now: NOW + 10 ** 9 })).not.toThrow();
  });

  it("keeps saved questions independent of later template revisions", () => {
    const { record, questions } = stored("e".repeat(64), "owner-a", "variant-e");
    const snapshot = JSON.stringify(questions.map((question) => question.questionJson));
    const plan = planShadowSave({ variant: record, questions, ownerId: "owner-a", now: NOW });
    expect(plan.questions.map((question) => question.promptText)).toEqual(questions.map((question) => question.promptText));
    expect(JSON.stringify(questions.map((question) => question.questionJson))).toBe(snapshot);
  });
});
