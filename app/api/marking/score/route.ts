import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { getMarkingSubmissionBundleFromConvex, setMarkingSubmissionStatusInConvex, upsertMarkingQuestionStatusInConvex, upsertMarkingScoreInConvex } from "@/lib/marking/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScoreRequest = {
  submissionId?: string;
  questionKey?: string;
  awardedMarks?: number;
  maxMarks?: number;
  confidence?: number;
  needsReview?: boolean;
  rationale?: string;
  evidence?: unknown;
  scorerProvider?: string;
  scorerModel?: string;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message.includes("Unauthorized");
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let body: ScoreRequest;
  try {
    body = (await request.json()) as ScoreRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  const questionKey = typeof body.questionKey === "string" ? body.questionKey.trim() : "";
  const awardedMarks = typeof body.awardedMarks === "number" && Number.isFinite(body.awardedMarks)
    ? Math.max(0, body.awardedMarks)
    : null;
  const maxMarks = typeof body.maxMarks === "number" && Number.isFinite(body.maxMarks)
    ? Math.max(0, body.maxMarks)
    : null;
  const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence)
    ? Math.max(0, Math.min(1, body.confidence))
    : 0;
  const needsReview = body.needsReview === true;
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  const scorerProvider = typeof body.scorerProvider === "string" && body.scorerProvider.trim() ? body.scorerProvider.trim() : "manual";
  const scorerModel = typeof body.scorerModel === "string" && body.scorerModel.trim() ? body.scorerModel.trim() : "manual";

  if (!submissionId) return badRequest("submissionId is required.");
  if (!questionKey) return badRequest("questionKey is required.");
  if (awardedMarks === null) return badRequest("awardedMarks is required.");
  if (maxMarks === null) return badRequest("maxMarks is required.");
  if (awardedMarks > maxMarks) return badRequest("awardedMarks cannot exceed maxMarks.");
  if (!rationale) return badRequest("rationale is required.");

  try {
    await upsertMarkingScoreInConvex({
      submissionId,
      questionKey,
      awardedMarks,
      maxMarks,
      confidence,
      needsReview,
      rationale,
      evidenceJson: JSON.stringify(body.evidence ?? {}),
      scorerProvider,
      scorerModel,
      scoreStatus: "confirmed",
    });

    await upsertMarkingQuestionStatusInConvex({
      submissionId,
      questionKey,
      status: needsReview ? "needs_manual_review" : "saved",
    });

    const bundle = await getMarkingSubmissionBundleFromConvex(submissionId);
    const insights = bundle?.insights;
    const nextStatus = (insights?.reviewRequiredCount ?? 0) > 0
      ? "review_required"
      : (insights?.questionCount ?? 0) > 0 && insights!.confirmedCount >= insights!.questionCount
        ? "scored"
        : (insights?.questionCount ?? 0) > 0 && insights!.ocrCompletedCount >= insights!.questionCount
          ? "ocr_complete"
          : "uploaded";
    await setMarkingSubmissionStatusInConvex(submissionId, nextStatus);

    return Response.json({
      submissionId,
      questionKey,
      awardedMarks,
      maxMarks,
      confidence,
      needsReview,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    return badRequest(
      `Scoring update failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}
