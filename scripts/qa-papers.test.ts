import { describe, expect, it } from "vitest";

import { decideQaPaperGate, type QaArtifactValidation, type QaPaperGateInput } from "./qa-paper-gate";

const validArtifact = {
  readable: true,
  byteLength: 100,
  pageCount: 2,
  renderedPageCount: 2,
} satisfies QaArtifactValidation;

function validGate(overrides: Partial<QaPaperGateInput> = {}): QaPaperGateInput {
  return {
    findings: [],
    selectedUnitCount: 4,
    markSchemeIncludedCount: 4,
    markSchemeFailureCount: 0,
    questionPaper: validArtifact,
    markScheme: validArtifact,
    ...overrides,
  };
}

describe("QA paper gate", () => {
  it("passes complete readable artifacts with warning-only findings", () => {
    expect(decideQaPaperGate(validGate({ findings: [{ severity: "warning" }] }))).toEqual({ ok: true, failures: [] });
  });

  const failureCases: Array<[string, Partial<QaPaperGateInput>, string]> = [
    ["error finding", { findings: [{ severity: "error" }] }, "error-findings"],
    ["incomplete coverage", { markSchemeIncludedCount: 3 }, "mark-scheme-coverage"],
    ["assembly failure", { markSchemeFailureCount: 1 }, "mark-scheme-assembly"],
    ["empty mark scheme", { markScheme: { ...validArtifact, byteLength: 0 } }, "mark-scheme-empty"],
    ["unreadable question paper", { questionPaper: { ...validArtifact, readable: false } }, "question-paper-unreadable"],
    ["unreadable mark scheme", { markScheme: { ...validArtifact, readable: false } }, "mark-scheme-unreadable"],
    ["question paper without pages", { questionPaper: { ...validArtifact, pageCount: 0, renderedPageCount: 0 } }, "question-paper-no-pages"],
    ["mark scheme without pages", { markScheme: { ...validArtifact, pageCount: 0, renderedPageCount: 0 } }, "mark-scheme-no-pages"],
    ["missing question render", { questionPaper: { ...validArtifact, renderedPageCount: 1 } }, "question-paper-missing-rendered-pages"],
    ["missing mark scheme render", { markScheme: { ...validArtifact, renderedPageCount: 1 } }, "mark-scheme-missing-rendered-pages"],
  ];

  it.each(failureCases)("fails for %s", (_label, overrides, expectedFailure) => {
    const result = decideQaPaperGate(validGate(overrides));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });
});
