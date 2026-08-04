import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBundle: vi.fn(),
  buildCombinedMarkScheme: vi.fn(),
  autoScoreMathPaper: vi.fn(),
  autoScoreMathQuestion: vi.fn(),
  upsertQuestionStatus: vi.fn(),
  upsertScore: vi.fn(),
}));

vi.mock("../infrastructure/convex/commands", () => ({
  getMarkingSubmissionBundleFromConvex: mocks.getBundle,
  upsertMarkingQuestionStatusInConvex: mocks.upsertQuestionStatus,
  upsertMarkingScoreInConvex: mocks.upsertScore,
}));

vi.mock("../infrastructure/scoring/scoring", () => ({
  autoScoreMathPaper: mocks.autoScoreMathPaper,
  autoScoreMathQuestion: mocks.autoScoreMathQuestion,
  buildCombinedMarkScheme: mocks.buildCombinedMarkScheme,
}));

import { autoScoreSubmission, getCombinedMarkScheme, saveManualScore } from "./scoring";

describe("marking scoring application", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without invoking mark-scheme assembly for a missing submission", async () => {
    mocks.getBundle.mockResolvedValue(null);

    await expect(getCombinedMarkScheme("submission_missing")).resolves.toBeNull();
    expect(mocks.buildCombinedMarkScheme).not.toHaveBeenCalled();
  });

  it("assembles a combined mark scheme from the persisted submission bundle", async () => {
    const bundle = { submission: { subjectKey: "aqa-geography" }, savedPaperQuestions: [], responses: [] };
    const result = { entries: [], failures: [], combinedText: "" };
    mocks.getBundle.mockResolvedValue(bundle);
    mocks.buildCombinedMarkScheme.mockResolvedValue(result);

    await expect(getCombinedMarkScheme("submission_123")).resolves.toBe(result);
    expect(mocks.buildCombinedMarkScheme).toHaveBeenCalledWith(bundle);
  });

  it("persists a manual score without coordinating a separate aggregate status write", async () => {
    const input = {
      submissionId: "submission_123",
      questionKey: "question_1",
      awardedMarks: 3,
      maxMarks: 4,
      confidence: 1,
      needsReview: false,
      rationale: "Checked manually.",
      evidence: {},
      scorerProvider: "manual",
      scorerModel: "manual",
    };

    await expect(saveManualScore(input)).resolves.toBe(input);
    expect(mocks.upsertScore).toHaveBeenCalledWith(expect.objectContaining({ scoreStatus: "confirmed" }));
    expect(mocks.upsertQuestionStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "saved" }));
    expect(mocks.getBundle).not.toHaveBeenCalled();
  });

  it("records skipped automatic scoring as manual review", async () => {
    mocks.getBundle.mockResolvedValue({ submission: {}, savedPaperQuestions: [] });
    mocks.autoScoreMathQuestion.mockResolvedValue({ skipped: true, rationale: "Diagram question" });

    await autoScoreSubmission({ submissionId: "submission_123", questionKey: "question_1", scoreWholePaper: false });

    expect(mocks.upsertScore).not.toHaveBeenCalled();
    expect(mocks.upsertQuestionStatus).toHaveBeenCalledWith({
      submissionId: "submission_123",
      questionKey: "question_1",
      status: "needs_manual_review",
      failureReason: "Diagram question",
    });
  });
});
