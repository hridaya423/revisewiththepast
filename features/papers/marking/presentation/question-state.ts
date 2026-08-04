export type ScoreEvidence = {
  markScheme?: {
    partText?: string;
    questionText?: string;
    pageNumbers?: number[];
    markSchemeUrl?: string;
  };
  markBreakdown?: Array<{
    criterion?: string;
    awarded?: boolean;
    evidence?: string;
  }>;
};

export function formatQuestionLabel(question: {
  displayOrder?: number;
  questionNumber?: string;
  questionPartNumber?: string | null;
  questionPath?: string[];
  questionKey: string;
}) {
  const number = question.questionNumber ? `Question ${question.questionNumber}` : question.questionKey;
  const pathSuffix = question.questionPath && question.questionPath.length > 0
    ? ` (${question.questionPath.join(")(")})`
    : question.questionPartNumber
      ? ` (${question.questionPartNumber})`
      : "";
  return question.displayOrder ? `${question.displayOrder}. ${number}${pathSuffix}` : `${number}${pathSuffix}`;
}

export function parseScoreEvidence(rawJson?: string): ScoreEvidence | null {
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as ScoreEvidence;
  } catch {
    return null;
  }
}

export function formatStatus(status: "uploaded" | "ocr_complete" | "scored" | "review_required") {
  if (status === "uploaded") return "Uploaded";
  if (status === "ocr_complete") return "OCR complete";
  if (status === "review_required") return "Needs review";
  return "Scored";
}

export type QuestionState = "failed" | "review" | "scored" | "suggested" | "ocr" | "uploaded" | "empty";

export function getQuestionState(row: {
  pages: unknown[];
  response: unknown;
  score: { scoreStatus?: "ai_suggested" | "confirmed"; needsReview: boolean } | null;
  questionStatus: { status: string } | null;
}): QuestionState {
  if (row.questionStatus?.status === "failed") return "failed";
  if (row.questionStatus?.status === "needs_manual_review") return "review";
  if (row.score?.scoreStatus === "confirmed") return row.score.needsReview ? "review" : "scored";
  if (row.score?.scoreStatus === "ai_suggested") return row.score.needsReview ? "review" : "suggested";
  if (row.score?.needsReview) return "review";
  if (row.score) return "scored";
  if (row.response) return "ocr";
  if (row.pages.length > 0) return "uploaded";
  return "empty";
}

export function getQuestionStateLabel(state: QuestionState) {
  if (state === "failed") return "Failed";
  if (state === "review") return "Needs review";
  if (state === "scored") return "Scored";
  if (state === "suggested") return "AI suggestion";
  if (state === "ocr") return "OCR ready";
  if (state === "uploaded") return "Waiting for OCR";
  return "Waiting";
}

export function getQuestionStateTone(state: QuestionState) {
  if (state === "failed") return "failure" as const;
  if (state === "review") return "review" as const;
  if (state === "scored") return "confirmed" as const;
  if (state === "suggested" || state === "ocr") return "active" as const;
  return "neutral" as const;
}

export function prioritizeQuestion(row: Parameters<typeof getQuestionState>[0]) {
  const state = getQuestionState(row);
  if (state === "review" || state === "failed") return 0;
  if (state === "ocr") return 1;
  if (state === "uploaded" || state === "empty") return 2;
  return 3;
}
