import { describe, expect, it } from "vitest";
import { normalizeScoreModelResult } from "./model-result";

describe("score model result normalization", () => {
  it("keeps valid marks and normalizes breakdown values", () => {
    expect(normalizeScoreModelResult({
      awardedMarks: 2,
      confidence: 0.9,
      needsReview: false,
      rationale: "  Clear evidence. ",
      markBreakdown: [{ criterion: "A", awarded: true, evidence: "line 1" }, { awarded: false }],
    }, 3)).toEqual({
      awardedMarks: 2,
      confidence: 0.9,
      needsReview: false,
      rationale: "Clear evidence.",
      markBreakdown: [
        { criterion: "A", awarded: true, evidence: "line 1" },
        { criterion: "criterion", awarded: false, evidence: "" },
      ],
    });
  });

  it("fails closed for invalid model output", () => {
    expect(normalizeScoreModelResult({ awardedMarks: 4, confidence: 0.8, needsReview: false }, 3)).toMatchObject({
      awardedMarks: 0,
      confidence: 0,
      needsReview: true,
      rationale: "The scoring model returned an invalid or incomplete result.",
    });
  });
});
