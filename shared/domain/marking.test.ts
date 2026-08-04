import { describe, expect, it } from "vitest";
import { deriveQuestionProgressState, deriveSubmissionStatus } from "./marking";

describe("marking summaries", () => {
  it("does not mark a paper OCR-complete after only one question", () => {
    expect(deriveSubmissionStatus({ questionCount: 3, reviewRequiredCount: 0, confirmedCount: 0, ocrCompletedCount: 1 })).toBe("uploaded");
  });

  it("prioritizes review and confirmation", () => {
    expect(deriveSubmissionStatus({ questionCount: 3, reviewRequiredCount: 1, confirmedCount: 3, ocrCompletedCount: 3 })).toBe("review_required");
    expect(deriveSubmissionStatus({ questionCount: 3, reviewRequiredCount: 0, confirmedCount: 3, ocrCompletedCount: 3 })).toBe("scored");
  });

  it("derives question-level presentation state without React", () => {
    expect(deriveQuestionProgressState({ hasPages: true, hasResponse: false, hasScore: false, scoreConfirmed: false, scoreNeedsReview: false })).toBe("waiting");
    expect(deriveQuestionProgressState({ hasPages: true, hasResponse: true, hasScore: true, scoreConfirmed: false, scoreNeedsReview: true })).toBe("review");
    expect(deriveQuestionProgressState({ hasPages: true, hasResponse: true, hasScore: true, scoreConfirmed: true, scoreNeedsReview: false })).toBe("confirmed");
  });
});
