import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import { getMarkingSubmissionBundleFromConvex, upsertMarkingQuestionStatusInConvex, upsertMarkingScoreInConvex } from "../infrastructure/convex/commands";
import { autoScoreMathPaper, autoScoreMathQuestion, buildCombinedMarkScheme } from "../infrastructure/scoring/scoring";
import type { AutoScoreRequest, ScoreRequest } from "../contracts/http";
import { NotFoundError } from "@/shared/application/errors";

function scorerModel() {
  return getServerEnvironment().OPENROUTER_MODEL;
}

async function persistAutoScore(submissionId: string, questionKey: string, result: Awaited<ReturnType<typeof autoScoreMathQuestion>>) {
  if (result.skipped) {
    await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey, status: "needs_manual_review", failureReason: result.rationale || "This question needs manual review." });
    return;
  }
  await upsertMarkingScoreInConvex({
    submissionId,
    questionKey,
    awardedMarks: result.awardedMarks,
    maxMarks: result.evidence.sourceUnit.totalMarks,
    confidence: result.confidence,
    needsReview: result.needsReview,
    rationale: result.rationale,
    evidenceJson: JSON.stringify(result.evidence),
    scorerProvider: "openrouter",
    scorerModel: scorerModel(),
    scoreStatus: "ai_suggested",
  });
  await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey, status: result.needsReview ? "needs_manual_review" : "ai_scored" });
}

export async function autoScoreSubmission(input: AutoScoreRequest) {
  const bundle = await getMarkingSubmissionBundleFromConvex(input.submissionId);
  if (!bundle) throw new NotFoundError("Submission not found.");

  if (input.scoreWholePaper) {
    const results = await autoScoreMathPaper(bundle);
    for (const entry of results) await persistAutoScore(input.submissionId, entry.questionKey, entry.result);
    return { results };
  }

  const result = await autoScoreMathQuestion(bundle, input.questionKey!);
  await persistAutoScore(input.submissionId, input.questionKey!, result);
  return result;
}

export async function saveManualScore(input: ScoreRequest) {
  await upsertMarkingScoreInConvex({
    submissionId: input.submissionId,
    questionKey: input.questionKey,
    awardedMarks: input.awardedMarks,
    maxMarks: input.maxMarks,
    confidence: input.confidence,
    needsReview: input.needsReview,
    rationale: input.rationale,
    evidenceJson: JSON.stringify(input.evidence),
    scorerProvider: input.scorerProvider,
    scorerModel: input.scorerModel,
    scoreStatus: "confirmed",
  });
  await upsertMarkingQuestionStatusInConvex({ submissionId: input.submissionId, questionKey: input.questionKey, status: input.needsReview ? "needs_manual_review" : "saved" });
  return input;
}

export async function getCombinedMarkScheme(submissionId: string) {
  const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
  if (!bundle) return null;
  return await buildCombinedMarkScheme(bundle);
}
