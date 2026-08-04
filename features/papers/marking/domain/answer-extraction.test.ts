import { describe, expect, it } from "vitest";
import { extractAnswerRegionText, requiresManualReview } from "./answer-extraction";

describe("marking answer extraction", () => {
  it("removes the printed prompt and stops at paper totals", () => {
    const result = extractAnswerRegionText({
      fullOcrText: "Explain why rivers flood.\nThe river floods because rainfall exceeds channel capacity.\nTotal for question 4",
      promptText: "Explain why rivers flood.",
    });

    expect(result.answerText).toContain("rainfall exceeds channel capacity");
    expect(result.answerText).not.toContain("Total for question");
  });

  it("flags visual-construction questions for manual review", () => {
    expect(requiresManualReview("Draw a labelled diagram of the apparatus.")).toBe(true);
    expect(requiresManualReview("State the definition of GDP.")).toBe(false);
  });
});
