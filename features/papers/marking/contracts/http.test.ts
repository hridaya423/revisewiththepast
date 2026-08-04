import { describe, expect, it } from "vitest";
import { autoScoreRequestSchema, scoreRequestSchema } from "./http";

describe("marking HTTP contracts", () => {
  it("requires a question for single-question scoring", () => {
    expect(autoScoreRequestSchema.safeParse({ submissionId: "sub_123" }).success).toBe(false);
    expect(autoScoreRequestSchema.parse({ submissionId: "sub_123", scoreWholePaper: true })).toEqual({
      submissionId: "sub_123",
      scoreWholePaper: true,
    });
  });

  it("applies manual-score defaults and rejects scores above the maximum", () => {
    expect(scoreRequestSchema.parse({
      submissionId: "sub_123",
      questionKey: "q_1",
      awardedMarks: 2,
      maxMarks: 3,
      rationale: "Clear response",
    })).toMatchObject({ confidence: 0, needsReview: false, scorerProvider: "manual", scorerModel: "manual" });

    expect(scoreRequestSchema.safeParse({
      submissionId: "sub_123",
      questionKey: "q_1",
      awardedMarks: 4,
      maxMarks: 3,
      rationale: "Invalid",
    }).success).toBe(false);
  });
});
