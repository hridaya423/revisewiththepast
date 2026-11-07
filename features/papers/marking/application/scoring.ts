import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import { getMarkingSubmissionBundleFromConvex, recordQuestionScoreInConvex } from "../infrastructure/convex/commands";
import { autoScoreMathPaper, autoScoreMathQuestion, buildCombinedMarkScheme } from "../infrastructure/scoring/scoring";
import type { AutoScoreRequest, ScoreRequest } from "../contracts/http";
import { DomainError, NotFoundError } from "@/shared/application/errors";
import { SHADOW_MARKING_UNSUPPORTED_MESSAGE, isShadowSavedPaper } from "@/features/papers/shadow/application/marking-boundary";

const PERSIST_CONCURRENCY = 4;

async function forEachConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function scorerModel() {
  return getServerEnvironment().OPENROUTER_MODEL;
}

async function persistAutoScore(submissionId: string, questionKey: string, result: Awaited<ReturnType<typeof autoScoreMathQuestion>>) {
  if (result.skipped) {
    await recordQuestionScoreInConvex({ submissionId, questionKey, status: "needs_manual_review", failureReason: result.rationale || "This question needs manual review." });
    return;
  }
  await recordQuestionScoreInConvex({
    submissionId,
    questionKey,
    score: {
      awardedMarks: result.awardedMarks,
      maxMarks: result.evidence.sourceUnit.totalMarks,
      confidence: result.confidence,
      needsReview: result.needsReview,
      rationale: result.rationale,
      evidenceJson: JSON.stringify(result.evidence),
      scorerProvider: "openrouter",
      scorerModel: scorerModel(),
      scoreStatus: "ai_suggested",
    },
    status: result.needsReview ? "needs_manual_review" : "ai_scored",
  });
}

export async function autoScoreSubmission(input: AutoScoreRequest) {
  const bundle = await getMarkingSubmissionBundleFromConvex(input.submissionId);
  if (!bundle) throw new NotFoundError("Submission not found.");
  if (isShadowSavedPaper(bundle.savedPaper)) throw new DomainError(SHADOW_MARKING_UNSUPPORTED_MESSAGE);

  if (input.scoreWholePaper) {
    const results = await autoScoreMathPaper(bundle);
    await forEachConcurrent(results, PERSIST_CONCURRENCY, (entry) => persistAutoScore(input.submissionId, entry.questionKey, entry.result));
    return { results };
  }

  const result = await autoScoreMathQuestion(bundle, input.questionKey!);
  await persistAutoScore(input.submissionId, input.questionKey!, result);
  return result;
}

export async function saveManualScore(input: ScoreRequest) {
  const result = await recordQuestionScoreInConvex({
    submissionId: input.submissionId,
    questionKey: input.questionKey,
    score: {
      awardedMarks: input.awardedMarks,
      maxMarks: input.maxMarks,
      // A student's own confirmation is authoritative; the client never sets confidence.
      confidence: 1,
      needsReview: input.needsReview,
      rationale: input.rationale,
      evidenceJson: JSON.stringify(input.evidence),
      scorerProvider: "manual",
      scorerModel: "manual",
      scoreStatus: "confirmed",
    },
    status: input.needsReview ? "needs_manual_review" : "saved",
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  if (result.conflict) return { status: "conflict" as const, current: result.conflict };
  return { status: "saved" as const, updatedAt: result.updatedAt };
}

export async function getCombinedMarkScheme(submissionId: string) {
  const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
  if (!bundle) return null;
  return await buildCombinedMarkScheme(bundle);
}
