import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBundle: vi.fn(),
  buildCombinedMarkScheme: vi.fn(),
  autoScoreMathPaper: vi.fn(),
  autoScoreMathQuestion: vi.fn(),
  recordQuestionScore: vi.fn(),
}));

vi.mock("../infrastructure/convex/commands", () => ({
  getMarkingSubmissionBundleFromConvex: mocks.getBundle,
  recordQuestionScoreInConvex: mocks.recordQuestionScore,
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

  it("persists a manual score atomically with its status and server-owned confidence", async () => {
    mocks.recordQuestionScore.mockResolvedValue({ scoreId: "score_1", updatedAt: 50, conflict: null });
    const input = {
      submissionId: "submission_123",
      questionKey: "question_1",
      awardedMarks: 3,
      maxMarks: 4,
      needsReview: false,
      rationale: "Checked manually.",
      evidence: {},
      expectedUpdatedAt: 10,
    };

    await expect(saveManualScore(input)).resolves.toEqual({ status: "saved", updatedAt: 50 });
    expect(mocks.recordQuestionScore).toHaveBeenCalledTimes(1);
    expect(mocks.recordQuestionScore).toHaveBeenCalledWith(expect.objectContaining({
      status: "saved",
      expectedUpdatedAt: 10,
      score: expect.objectContaining({ scoreStatus: "confirmed", awardedMarks: 3, confidence: 1, scorerProvider: "manual" }),
    }));
    expect(mocks.getBundle).not.toHaveBeenCalled();
  });

  it("reports a stale revision as a conflict carrying the current score", async () => {
    const current = { awardedMarks: 1, maxMarks: 4, needsReview: false, rationale: "Other tab", scoreStatus: "confirmed", updatedAt: 99 };
    mocks.recordQuestionScore.mockResolvedValue({ scoreId: "score_1", updatedAt: 99, conflict: current });

    await expect(saveManualScore({ submissionId: "s", questionKey: "q", awardedMarks: 3, maxMarks: 4, needsReview: false, rationale: "", evidence: {}, expectedUpdatedAt: 10 }))
      .resolves.toEqual({ status: "conflict", current });
  });

  it("records skipped automatic scoring as manual review", async () => {
    mocks.getBundle.mockResolvedValue({ submission: {}, savedPaperQuestions: [] });
    mocks.autoScoreMathQuestion.mockResolvedValue({ skipped: true, rationale: "Diagram question" });

    await autoScoreSubmission({ submissionId: "submission_123", questionKey: "question_1", scoreWholePaper: false });

    expect(mocks.recordQuestionScore).toHaveBeenCalledTimes(1);
    expect(mocks.recordQuestionScore).toHaveBeenCalledWith({
      submissionId: "submission_123",
      questionKey: "question_1",
      status: "needs_manual_review",
      failureReason: "Diagram question",
    });
  });
});
