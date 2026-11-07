import { describe, expect, it } from "vitest";

import { findReferencePaperPair } from "./qa-paper-references";

describe("QA paper references", () => {
  it("pairs French Reading with Reading rather than a newer sibling component", () => {
    expect(findReferencePaperPair([
      "003512-2024-listening-question_paper-1fr0-1f-que-20240515-pdf.pdf",
      "003513-2024-listening-mark_scheme-1fr0-1f-rms-20240822-pdf.pdf",
      "003514-2024-reading-question_paper-1fr0-3f-que-20240515-pdf.pdf",
      "003515-2024-reading-mark_scheme-1fr0-3f-rms-20240822-pdf.pdf",
      "003516-2024-writing-question_paper-1fr0-4f-que-20240525-pdf.pdf",
      "003517-2024-writing-mark_scheme-1fr0-4f-rms-20240822-pdf.pdf",
    ], "reading")).toEqual({
      questionPaperFile: "003514-2024-reading-question_paper-1fr0-3f-que-20240515-pdf.pdf",
      markSchemeFile: "003515-2024-reading-mark_scheme-1fr0-3f-rms-20240822-pdf.pdf",
      year: 2024,
      session: "unknown",
    });
  });

  it("keeps combined-science references on the requested discipline and paper", () => {
    expect(findReferencePaperPair([
      "000667-2024-biology-1-mark_scheme-june-202024-pdf.pdf",
      "000668-2024-biology-1-question_paper-june-202024-pdf.pdf",
      "000709-2024-chemistry-2-mark_scheme-june-202024-pdf.pdf",
      "000710-2024-chemistry-2-question_paper-june-202024-pdf.pdf",
    ], "chemistry-2")).toMatchObject({
      questionPaperFile: expect.stringContaining("chemistry-2-question_paper"),
      markSchemeFile: expect.stringContaining("chemistry-2-mark_scheme"),
      year: 2024,
      session: "june",
    });
  });

  it("does not pair files from different examination sessions", () => {
    expect(findReferencePaperPair([
      "001701-2024-paper-1-question_paper-june-202024-pdf.pdf",
      "001702-2024-paper-1-mark_scheme-june-202024-pdf.pdf",
      "001703-2024-paper-1-question_paper-november-202024-pdf.pdf",
      "001704-2024-paper-1-mark_scheme-june-202024-copy-pdf.pdf",
    ], "paper-1")).toMatchObject({
      questionPaperFile: "001701-2024-paper-1-question_paper-june-202024-pdf.pdf",
      markSchemeFile: "001704-2024-paper-1-mark_scheme-june-202024-copy-pdf.pdf",
      session: "june",
    });
  });
});
