import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { getMarkingSubmissionBundleFromConvex, setMarkingSubmissionStatusInConvex, upsertMarkingQuestionStatusInConvex, upsertMarkingScoreInConvex } from "@/lib/marking/convex";
import { autoScoreMathPaper, autoScoreMathQuestion } from "@/lib/marking/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutoScoreRequest = {
  submissionId?: string;
  questionKey?: string;
  scoreWholePaper?: boolean;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });  
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let body: AutoScoreRequest;
  try {
    body = (await request.json()) as AutoScoreRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  const questionKey = typeof body.questionKey === "string" ? body.questionKey.trim() : "";
  const scoreWholePaper = body.scoreWholePaper === true;
  if (!submissionId) return badRequest("submissionId is required.");
  if (!scoreWholePaper && !questionKey) return badRequest("questionKey is required.");

  try {
    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    if (!bundle) return badRequest("Submission not found.", 404);

    if (scoreWholePaper) {
      const results = await autoScoreMathPaper(bundle as never);
      for (const entry of results) {
        if (entry.result.skipped) {
          await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey: entry.questionKey, status: "needs_manual_review", failureReason: entry.result.rationale || "This question needs manual review." });
          continue;
        }
        await upsertMarkingScoreInConvex({
          submissionId,
          questionKey: entry.questionKey,
          awardedMarks: entry.result.awardedMarks,
          maxMarks: entry.result.evidence.sourceUnit.totalMarks,
          confidence: entry.result.confidence,
          needsReview: entry.result.needsReview,
          rationale: entry.result.rationale,
          evidenceJson: JSON.stringify(entry.result.evidence),
          scorerProvider: "openrouter",
          scorerModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite",
          scoreStatus: "ai_suggested",
        });
        await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey: entry.questionKey, status: entry.result.needsReview ? "needs_manual_review" : "ai_scored" });
      }

      const updatedBundle = await getMarkingSubmissionBundleFromConvex(submissionId);
      const insights = updatedBundle?.insights;
      const hasReviewRequired = (insights?.reviewRequiredCount ?? 0) > 0 || results.some((entry) => entry.result.skipped);
      const nextStatus = hasReviewRequired
        ? "review_required"
        : (insights?.questionCount ?? 0) > 0 && insights!.ocrCompletedCount >= insights!.questionCount
          ? "ocr_complete"
          : "uploaded";
      await setMarkingSubmissionStatusInConvex(submissionId, nextStatus);
      return Response.json({ results });
    }

    const result = await autoScoreMathQuestion(bundle as never, questionKey);
    if (result.skipped) {
      await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey, status: "needs_manual_review", failureReason: result.rationale || "This question needs manual review." });
      await setMarkingSubmissionStatusInConvex(submissionId, "review_required");
      return Response.json(result);
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
      scorerModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite",
      scoreStatus: "ai_suggested",
    });
    await upsertMarkingQuestionStatusInConvex({ submissionId, questionKey, status: result.needsReview ? "needs_manual_review" : "ai_scored" });

    const updatedBundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    const insights = updatedBundle?.insights;
    const nextStatus = (insights?.reviewRequiredCount ?? 0) > 0
      ? "review_required"
      : (insights?.questionCount ?? 0) > 0 && insights!.ocrCompletedCount >= insights!.questionCount
        ? "ocr_complete"
        : "uploaded";
    await setMarkingSubmissionStatusInConvex(submissionId, nextStatus);

    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) return unauthorizedResponse();
    return badRequest(`Auto-scoring failed: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}
