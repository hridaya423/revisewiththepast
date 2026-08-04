export type MarkingQuestionStatus =
  | "unmapped"
  | "pages_assigned"
  | "ocr_pending"
  | "ocr_ready"
  | "mark_scheme_ready"
  | "ai_scored"
  | "saved"
  | "needs_manual_review"
  | "failed";

export type MarkingSubmissionStatus = "uploaded" | "ocr_complete" | "scored" | "review_required";

export type QuestionProgressState = "confirmed" | "current" | "review" | "ready" | "waiting" | "failed";

export function deriveQuestionProgressState(input: {
  hasPages: boolean;
  hasResponse: boolean;
  hasScore: boolean;
  scoreConfirmed: boolean;
  scoreNeedsReview: boolean;
  status?: MarkingQuestionStatus;
}): Exclude<QuestionProgressState, "current"> {
  if (input.status === "failed") return "failed";
  if (input.status === "needs_manual_review" || input.scoreNeedsReview) return "review";
  if (input.scoreConfirmed) return "confirmed";
  if (input.hasScore || input.status === "ai_scored" || input.status === "mark_scheme_ready" || input.status === "ocr_ready") return "ready";
  if (input.hasResponse) return "ready";
  return "waiting";
}

export function deriveSubmissionStatus(input: {
  questionCount: number;
  reviewRequiredCount: number;
  confirmedCount: number;
  ocrCompletedCount: number;
}): MarkingSubmissionStatus {
  if (input.reviewRequiredCount > 0) return "review_required";
  if (input.questionCount > 0 && input.confirmedCount >= input.questionCount) return "scored";
  if (input.questionCount > 0 && input.ocrCompletedCount >= input.questionCount) return "ocr_complete";
  return "uploaded";
}
