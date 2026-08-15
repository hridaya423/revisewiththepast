import { describe, expect, it } from "vitest";

import type { QuestionUnit } from "@/shared/domain/paper";
import { expandScienceCropToReferencedFigures } from "./pdf";
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

describe("expandScienceCropToReferencedFigures", () => {
  it("includes the full matching figure geometry with a safe margin", () => {
    const crop = expandScienceCropToReferencedFigures(
      { left: 0, right: 595, bottom: 460, top: 600 },
      21,
      595,
      842,
      [12],
      [{ label: "Figure 12", pageNumber: 21, yTop: 817.8895, yBottom: 442.5559 }],
      [],
    );

    expect(crop).toEqual({ left: 0, right: 595, bottom: 434.5559, top: 825.8895 });
  });

  it("leaves crops without a matching figure unchanged", () => {
    const crop = { left: 0, right: 595, bottom: 460, top: 600 };

    expect(expandScienceCropToReferencedFigures(crop, 21, 595, 842, [11], [{ label: "Figure 12", pageNumber: 21, yTop: 817, yBottom: 443 }], [])).toBe(crop);
  });

  it("ignores siblings in another column", () => {
    const crop = expandScienceCropToReferencedFigures(
      { left: 0, right: 280, bottom: 460, top: 600 },
      21,
      595,
      842,
      [12],
      [{ label: "Figure 12", pageNumber: 21, yTop: 817, yBottom: 443 }],
      [{ left: 315, right: 595, bottom: 700, top: 820 }],
    );

    expect(crop.top).toBe(825);
  });

});
