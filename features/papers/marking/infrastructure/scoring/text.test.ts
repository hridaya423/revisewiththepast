import { describe, expect, it } from "vitest";
import { cleanOcrTextForScoring, fallbackSlicePartText, formatStructuredLines } from "./text";

describe("scoring text normalization", () => {
  it("removes OCR boilerplate and prompt echoes", () => {
    expect(cleanOcrTextForScoring("Explain erosion", null, "Page 1\nExplain erosion\nThe river deposits sediment.")).toBe("The river deposits sediment.");
  });

  it("slices a question part before the next part marker", () => {
    expect(fallbackSlicePartText("(a) First response (b) Second response", "a")).toBe("(a) First response");
  });

  it("merges continuation lines into the preceding mark-scheme row", () => {
    expect(formatStructuredLines([
      { pageNumber: 1, y: 1, leftText: "1", answerText: "", markText: "1", schemeText: "Point", guidanceText: "", fullText: "1 1 Point" },
      { pageNumber: 1, y: 2, leftText: "", answerText: "", markText: "", schemeText: "detail", guidanceText: "", fullText: "detail" },
    ])).toBe("Question: 1 | Marks: 1 | Mark scheme: Point detail");
  });
});
