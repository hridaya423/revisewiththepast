import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { checkBlankPages, checkRenderedQuestionTotals, runDeterministicChecks } from "./validate";
import { assertGeneratedPaperQuality } from "./validate";
import { GENERATED_PAGE } from "../../domain/generated-layout";
import { setGeneratedPageRole } from "../pdf/page-chrome";

function makePng(draw: (context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void) {
  const canvas = createCanvas(500, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 500, 500);
  draw(context);
  return canvas.toBuffer("image/png");
}

describe("rendered paper QA", () => {
  it("rejects pages containing only sparse generated markers", async () => {
    const png = makePng((context) => {
      context.fillStyle = "#000";
      context.fillRect(100, 100, 20, 4);
      context.fillRect(100, 200, 20, 4);
    });

    expect(await checkBlankPages([{ pageNumber: 2, png }])).toEqual([
      expect.objectContaining({ check: "blank-page", severity: "error" }),
    ]);
  });

  it("rejects a low-ink page containing only one line", async () => {
    const png = makePng((context) => {
      context.fillStyle = "#000";
      context.fillRect(100, 100, 20, 4);
    });

    expect(await checkBlankPages([{ pageNumber: 2, png }])).toEqual([
      expect.objectContaining({ check: "blank-page", severity: "error" }),
    ]);
  });

  it("rejects a maths total that disagrees with the selected unit marks", () => {
    expect(checkRenderedQuestionTotals([
      { pageNumber: 2, text: "(Total for Question 1 is 1 marks)" },
    ], {
      subjectKey: "edexcel-mathematics-higher",
      selectedUnitMarks: [5],
    })).toEqual([expect.objectContaining({ check: "question-total-mismatch", severity: "error" })]);
  });

  it("accepts all rendered maths totals when they match selection order", () => {
    expect(checkRenderedQuestionTotals([
      { pageNumber: 2, text: "(Total for Question 1 is 5 marks)" },
      { pageNumber: 3, text: "(Total for Question 2 is 2 marks)" },
    ], {
      subjectKey: "edexcel-mathematics-higher",
      selectedUnitMarks: [5, 2],
    })).toEqual([]);
  });

  it("accepts canonical equals-sign maths totals", () => {
    expect(checkRenderedQuestionTotals([
      { pageNumber: 2, text: "Total for Question 1 = 5 marks" },
    ], {
      subjectKey: "edexcel-mathematics-higher",
      selectedUnitMarks: [5],
    })).toEqual([]);
  });

  it("rejects duplicate rendered totals even when their values agree", () => {
    expect(checkRenderedQuestionTotals([
      { pageNumber: 2, text: "(Total for Question 1 is 5 marks)\n(Total for Question 1 is 5 marks)" },
    ], {
      subjectKey: "edexcel-mathematics-higher",
      selectedUnitMarks: [5],
    })).toEqual([expect.objectContaining({
      check: "question-total-mismatch",
      severity: "error",
      message: expect.stringContaining("2 totals"),
    })]);
  });

  it("rejects totals for source question numbers that were not generated", () => {
    expect(checkRenderedQuestionTotals([
      { pageNumber: 2, text: "(Total for Question 1 is 5 marks)\n(Total for Question 3 is 2 marks)" },
    ], {
      subjectKey: "edexcel-mathematics-higher",
      selectedUnitMarks: [5],
    })).toEqual([expect.objectContaining({
      check: "question-total-mismatch",
      severity: "error",
      message: expect.stringContaining("unexpected total for Question 3"),
    })]);
  });

  it("rejects a misaligned ordinal through the generated paper quality boundary", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([GENERATED_PAGE.width, GENERATED_PAGE.height]);
    setGeneratedPageRole(page, "question-content");
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("1", { x: GENERATED_PAGE.numberX + 2, y: 700, size: GENERATED_PAGE.numberFontSize, font });

    await expect(assertGeneratedPaperQuality(new Uint8Array(await document.save()), { expectedOrdinalCount: 1 }))
      .rejects.toThrow(/x position/);
  });

  it("suppresses the heavy-mix warning when the pool could not supply a lighter mix", async () => {
    const png = makePng((context) => {
      context.fillStyle = "#000";
      context.fillRect(50, 50, 400, 300);
    });
    const findings = await runDeterministicChecks(
      [{ pageNumber: 2, png }],
      [{ pageNumber: 2, text: "Question 1 answer space" }],
      {
        selectedUnitMarks: [4, 7, 11, 18],
        totalMarks: 40,
        candidateUnitMarks: [4, 7, 9, 10, 11, 11, 11, 13, 13, 13, 15, 17, 18, 19, 28],
      },
    );
    expect(findings.some((finding) => finding.check === "question-mix-too-heavy")).toBe(false);
  });

  it("warns on a heavy mix when the pool offered lighter units", async () => {
    const png = makePng((context) => {
      context.fillStyle = "#000";
      context.fillRect(50, 50, 400, 300);
    });
    const findings = await runDeterministicChecks(
      [{ pageNumber: 2, png }],
      [{ pageNumber: 2, text: "Question 1 answer space" }],
      {
        selectedUnitMarks: [4, 7, 11, 18],
        totalMarks: 40,
        candidateUnitMarks: [2, 3, 4, 7, 9, 11, 18],
      },
    );
    expect(findings).toContainEqual(expect.objectContaining({ check: "question-mix-too-heavy", severity: "warning" }));
  });
});
