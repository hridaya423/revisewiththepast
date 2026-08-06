import { describe, expect, it } from "vitest";

import type { QuestionUnit } from "@/shared/domain/paper";
import { findMathUnitStartLine } from "./pdf";

describe("Maths crop discovery", () => {
  it("uses the question part that belongs to a continuation page", () => {
    const page = {
      page_number: 7,
      page_text: "(b) Work out the total surface area of the pyramid.",
      text_lines: [{
        text: "(b) Work out the total surface area of the pyramid.",
        y: 771,
        bbox: { x0: 60, y0: 771, x1: 306, y1: 783 },
      }],
    };
    const unit = {
      questionNumber: "5",
      parts: [
        {
          questionNumber: "5",
          questionPartNumber: "a",
          promptText: "5 Here is a solid square-based pyramid",
          pageNumbers: [6],
        },
        {
          questionNumber: "5",
          questionPartNumber: "b",
          promptText: "(b) Work out the total surface area of the pyramid.",
          pageNumbers: [7],
        },
      ],
    } as QuestionUnit;

    expect(findMathUnitStartLine(page, unit)?.text).toBe("(b) Work out the total surface area of the pyramid.");
  });
});
