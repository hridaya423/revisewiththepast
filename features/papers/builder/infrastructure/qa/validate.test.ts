import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { checkBlankPages, checkRenderedQuestionTotals } from "./validate";

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
});
