import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { getMarkingSubmissionBundleFromConvex, setMarkingSubmissionStatusInConvex, upsertMarkingScoreInConvex } from "@/lib/marking/convex";
import { autoScoreMathQuestion } from "@/lib/marking/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutoScoreRequest = {
  submissionId?: string;
  questionKey?: string;
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
  if (!submissionId) return badRequest("submissionId is required.");
  if (!questionKey) return badRequest("questionKey is required.");

  try {
    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    if (!bundle) return badRequest("Submission not found.", 404);

    const result = await autoScoreMathQuestion(bundle as never, questionKey);
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
      scorerModel: process.env.OPENROUTER_MODEL ?? "google/gemini-3-flash-preview",
    });

    const updatedBundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    const hasReviewRequired = (updatedBundle?.scores ?? []).some((score) => score.needsReview);
    await setMarkingSubmissionStatusInConvex(submissionId, hasReviewRequired ? "review_required" : "scored");

    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) return unauthorizedResponse();
    return badRequest(`Auto-scoring failed: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}
