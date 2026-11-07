import { describe, expect, it } from "vitest";

import { decideQaPaperGate, type QaArtifactValidation, type QaPaperGateInput } from "./qa-paper-gate";

const validArtifact = {
  readable: true,
  byteLength: 100,
  pageCount: 2,
  renderedPageCount: 2,
  pageSizes: [
    { width: 595.28, height: 841.89 },
    { width: 595.28, height: 841.89 },
  ],
  metadata: { title: "Question Paper", creator: null, producer: null },
} satisfies QaArtifactValidation;

function validGate(overrides: Partial<QaPaperGateInput> = {}): QaPaperGateInput {
  return {
    findings: [],
    canonicalLayoutChecked: true,
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
    ["missing canonical layout check", { canonicalLayoutChecked: false }, "canonical-layout-unchecked"],
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
    ["missing question page dimensions", { questionPaper: { ...validArtifact, pageSizes: [] } }, "question-paper-missing-page-sizes"],
    ["non-A4 question page", { questionPaper: { ...validArtifact, pageSizes: [{ width: 612, height: 792 }] } }, "question-paper-non-a4"],
    ["landscape question page", { questionPaper: { ...validArtifact, pageSizes: [{ width: 841.89, height: 595.28 }] } }, "question-paper-non-portrait"],
    ["non-A4 mark-scheme page", { markScheme: { ...validArtifact, pageSizes: [{ width: 842, height: 231 }] } }, "mark-scheme-non-a4"],
    ["missing question-paper title", { questionPaper: { ...validArtifact, metadata: { ...validArtifact.metadata, title: null } } }, "question-paper-missing-title"],
    ["tooling metadata", { markScheme: { ...validArtifact, metadata: { ...validArtifact.metadata, producer: "pdf-lib" } } }, "mark-scheme-tooling-metadata"],
  ];

  it.each(failureCases)("fails for %s", (_label, overrides, expectedFailure) => {
    const result = decideQaPaperGate(validGate(overrides));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });
});
