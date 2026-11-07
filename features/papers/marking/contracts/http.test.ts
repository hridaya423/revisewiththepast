import { describe, expect, it } from "vitest";
import { autoScoreRequestSchema, scoreRequestSchema } from "./http";

const SUBMISSION_ID = "jh7abcdef1234567890";

describe("marking HTTP contracts", () => {
  it("requires a question for single-question scoring", () => {
    expect(autoScoreRequestSchema.safeParse({ submissionId: SUBMISSION_ID }).success).toBe(false);
    expect(autoScoreRequestSchema.parse({ submissionId: SUBMISSION_ID, scoreWholePaper: true })).toEqual({
      submissionId: SUBMISSION_ID,
      scoreWholePaper: true,
    });
  });

  it("rejects malformed submission ids", () => {
    expect(autoScoreRequestSchema.safeParse({ submissionId: "sub_123", scoreWholePaper: true }).success).toBe(false);
  });

  it("applies manual-score defaults and rejects scores above the maximum", () => {
    expect(scoreRequestSchema.parse({
      submissionId: SUBMISSION_ID,
      questionKey: "q_1",
      awardedMarks: 2,
      maxMarks: 3,
      rationale: "Clear response",
    })).toMatchObject({ needsReview: false, rationale: "Clear response" });

    expect(scoreRequestSchema.parse({ submissionId: SUBMISSION_ID, questionKey: "q_1", awardedMarks: 0, maxMarks: 3 }))
      .toMatchObject({ rationale: "" });
    expect(scoreRequestSchema.parse({ submissionId: SUBMISSION_ID, questionKey: "q_1", awardedMarks: 1, maxMarks: 3, expectedUpdatedAt: null }))
      .toMatchObject({ expectedUpdatedAt: null });

    expect(scoreRequestSchema.safeParse({
      submissionId: SUBMISSION_ID,
      questionKey: "q_1",
      awardedMarks: 4,
      maxMarks: 3,
      rationale: "Invalid",
    }).success).toBe(false);
  });
});
