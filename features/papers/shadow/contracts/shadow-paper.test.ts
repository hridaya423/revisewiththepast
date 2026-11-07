import { describe, expect, it } from "vitest";

import {
  blockSchema,
  exactValueSchema,
  mathExpressionSchema,
  questionDocumentSchema,
  solutionPartSchema,
  solutionSchema,
  startShadowJobRequestSchema,
  type ShadowSolutionPart,
} from "./shadow-paper";

const prose = (v: string) => ({ t: "text" as const, v });

function part(id: string, marks: number) {
  return {
    id,
    label: id ? `(${id})` : null,
    lead: [],
    prompt: [{ b: "p" as const, runs: [prose("Work out the value.")] }],
    marks,
    working: 120,
    answer: { kind: "line" as const },
  };
}

function solutionPart(overrides: Partial<ShadowSolutionPart> = {}): ShadowSolutionPart {
  return {
    partId: "a",
    marks: 2,
    answer: [prose("60")],
    accepted: [],
    branches: [{ criteria: [
      { id: "p1", code: "P1", text: [prose("for 12 ÷ 0.2")] },
      { id: "a1", code: "A1", text: [prose("cao")], dependsOn: ["p1"] },
    ] }],
    specialCases: [],
    working: [{ b: "p", runs: [prose("12 ÷ 0.2 = 60")] }],
    dependsOnParts: [],
    manualMarking: false,
    ...overrides,
  };
}

describe("shadow paper content contracts", () => {
  it("accepts a multipart question whose part marks match the total", () => {
    const parsed = questionDocumentSchema.safeParse({ number: 1, stem: [], parts: [part("a", 2), part("b", 2)], totalMarks: 4 });
    expect(parsed.success).toBe(true);
  });

  it("rejects mismatched totals, duplicate parts, and unlabelled multipart questions", () => {
    expect(questionDocumentSchema.safeParse({ number: 1, stem: [], parts: [part("a", 2), part("b", 2)], totalMarks: 5 }).success).toBe(false);
    expect(questionDocumentSchema.safeParse({ number: 1, stem: [], parts: [part("a", 2), part("a", 2)], totalMarks: 4 }).success).toBe(false);
    expect(questionDocumentSchema.safeParse({ number: 1, stem: [], parts: [part("a", 2), { ...part("", 2) }], totalMarks: 4 }).success).toBe(false);
  });

  it("requires every alternative marking branch to award exactly the part maximum", () => {
    const alternative = { label: "Alternative method", criteria: [{ id: "b2", code: "B2", text: [prose("for 60")] }] };
    expect(solutionPartSchema.safeParse(solutionPart({ branches: [...solutionPart().branches, alternative] })).success).toBe(true);
    const short = { criteria: [{ id: "b1", code: "B1", text: [prose("for 60")] }] };
    expect(solutionPartSchema.safeParse(solutionPart({ branches: [...solutionPart().branches, short] })).success).toBe(false);
  });

  it("rejects dependencies on later or unknown criteria", () => {
    const branches = [{ criteria: [
      { id: "a1", code: "A1", text: [prose("cao")], dependsOn: ["p1"] },
      { id: "p1", code: "P1", text: [prose("process")] },
    ] }];
    expect(solutionPartSchema.safeParse(solutionPart({ branches })).success).toBe(false);
  });

  it("rejects cyclic part dependencies", () => {
    const parsed = solutionSchema.safeParse({ parts: [
      solutionPart({ partId: "a", dependsOnParts: ["b"] }),
      solutionPart({ partId: "b", dependsOnParts: ["a"] }),
    ] });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("cycle");
  });

  it("rejects invalid fractions and zero denominators", () => {
    expect(mathExpressionSchema.safeParse([{ k: "frac", n: [], d: [{ k: "n", v: "2" }] }]).success).toBe(false);
    expect(mathExpressionSchema.safeParse([{ k: "n", v: "-3" }]).success).toBe(false);
    expect(exactValueSchema.safeParse("3/0").success).toBe(false);
    expect(exactValueSchema.safeParse("-17/4").success).toBe(true);
  });

  it("rejects unknown nodes, executable content, and excessive nesting", () => {
    expect(mathExpressionSchema.safeParse([{ k: "latex", v: "\\input{/etc/passwd}" }]).success).toBe(false);
    expect(mathExpressionSchema.safeParse([{ k: "t", v: "<script>" }]).success).toBe(false);
    expect(blockSchema.safeParse({ b: "image", src: "https://example.com/x.png" }).success).toBe(false);
    let nested: unknown = { k: "n", v: "1" };
    for (let depth = 0; depth < 8; depth += 1) nested = { k: "sqrt", b: [nested] };
    expect(mathExpressionSchema.safeParse([nested]).success).toBe(false);
  });

  it("rejects oversized text and diagrams", () => {
    expect(blockSchema.safeParse({ b: "p", runs: [prose("x".repeat(601))] }).success).toBe(false);
    expect(blockSchema.safeParse({
      b: "figure",
      diagram: { w: 900, h: 100, scale: "not-to-scale", description: "Too wide", items: [{ d: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] },
    }).success).toBe(false);
    expect(blockSchema.safeParse({
      b: "figure",
      diagram: { w: 100, h: 100, scale: "not-to-scale", description: "Non-finite", items: [{ d: "line", x1: Number.NaN, y1: 0, x2: 1, y2: 1 }] },
    }).success).toBe(false);
  });

  it("accepts only source identity, manifest revision, and idempotency key from clients", () => {
    const request = { sourcePaperId: "edexcel-gcse-mathematics-higher-2019-june-paper-1", manifestRevision: "2026-11-01.1", idempotencyKey: "k".repeat(24) };
    expect(startShadowJobRequestSchema.safeParse(request).success).toBe(true);
    expect(startShadowJobRequestSchema.safeParse({ ...request, seed: 42 }).success).toBe(false);
    expect(startShadowJobRequestSchema.safeParse({ ...request, answers: { "1a": "0.4" } }).success).toBe(false);
    expect(startShadowJobRequestSchema.safeParse({ ...request, sourceUrl: "https://example.com/paper.pdf" }).success).toBe(false);
    expect(startShadowJobRequestSchema.safeParse({ ...request, idempotencyKey: "short" }).success).toBe(false);
  });
});
