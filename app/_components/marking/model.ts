export type MarkingTone = "neutral" | "active" | "confirmed" | "review" | "failure";

export type MarkingSubmissionBundle = {
  submission: {
    subjectKey: string;
    studentLabel?: string;
    paperCode?: string;
    status: "uploaded" | "ocr_complete" | "scored" | "review_required";
    importSource?: "manual_upload" | "imported_pdf" | "saved_paper";
  };
  savedPaper?: { title: string; pdfUrl: string } | null;
  savedPaperQuestions?: Array<{
    unitKey: string;
    displayOrder: number;
    paperCode: string;
    year?: number;
    session?: string;
    questionNumber: string;
    questionPartNumber?: string | null;
    questionPath?: string[];
    totalMarks: number;
    promptText: string;
    contextText?: string | null;
    canonicalLeafIds?: string[];
    topicLabels?: string[];
  }>;
  pages: Array<{ _id: string; questionKey: string; questionNumber?: string; questionPartNumber?: string; pageLabel?: string; fileName: string; sourceImageUrl: string; scriptPageNumber?: number; ocrText?: string }>;
  responses: Array<{ _id: string; questionKey: string; questionNumber?: string; questionPartNumber?: string; sourceImageUrl?: string; ocrText: string; ocrProvider?: string }>;
  scores: Array<{ _id: string; questionKey: string; awardedMarks: number; maxMarks: number; confidence: number; needsReview: boolean; rationale: string; evidenceJson?: string; scoreStatus?: "ai_suggested" | "confirmed"; updatedAt?: number }>;
  questionStatuses?: Array<{ questionKey: string; status: string; failureReason?: string }>;
  insights: { questionCount: number; uploadedPageCount: number; ocrCompletedCount: number; scoredCount: number; reviewRequiredCount: number; totalAwardedMarks: number; totalMaxMarks: number; averageConfidence: number | null };
};

export type CombinedMarkSchemeEntry = { questionKey: string; label: string; markScheme: { partText: string; questionText: string; pageNumbers: number[]; markSchemeUrl: string } };
type QuestionStatus = NonNullable<MarkingSubmissionBundle["questionStatuses"]>[number];
export type QuestionRow = { questionKey: string; savedQuestion: NonNullable<MarkingSubmissionBundle["savedPaperQuestions"]>[number] | null; pages: MarkingSubmissionBundle["pages"]; response: MarkingSubmissionBundle["responses"][number] | null; score: MarkingSubmissionBundle["scores"][number] | null; questionStatus: QuestionStatus | null; combinedMarkScheme: CombinedMarkSchemeEntry | null };
export type FeedbackScope = "setup" | "upload" | "ocr" | "score" | "mark-scheme" | "bulk" | "whole-paper";

export function buildQuestionRows(bundle: MarkingSubmissionBundle, markSchemeEntries: CombinedMarkSchemeEntry[] = []): QuestionRow[] {
  const savedQuestions = bundle.savedPaperQuestions ?? [];
  const questionKeys = savedQuestions.length > 0
    ? savedQuestions.map((question) => question.unitKey)
    : Array.from(new Set([...bundle.pages.map((page) => page.questionKey), ...bundle.responses.map((response) => response.questionKey), ...bundle.scores.map((score) => score.questionKey)]));
  const savedQuestionByKey = new Map(savedQuestions.map((question) => [question.unitKey, question]));
  const pagesByKey = new Map<string, MarkingSubmissionBundle["pages"]>();
  for (const page of bundle.pages) {
    const pages = pagesByKey.get(page.questionKey) ?? [];
    pages.push(page);
    pagesByKey.set(page.questionKey, pages);
  }
  const responseByKey = new Map(bundle.responses.map((response) => [response.questionKey, response]));
  const scoreByKey = new Map(bundle.scores.map((score) => [score.questionKey, score]));
  const statusByKey = new Map(bundle.questionStatuses?.map((status) => [status.questionKey, status]) ?? []);
  const markSchemeByKey = new Map(markSchemeEntries.map((entry) => [entry.questionKey, entry]));
  return questionKeys.map((questionKey) => ({
    questionKey,
    savedQuestion: savedQuestionByKey.get(questionKey) ?? null,
    pages: pagesByKey.get(questionKey) ?? [],
    response: responseByKey.get(questionKey) ?? null,
    score: scoreByKey.get(questionKey) ?? null,
    questionStatus: statusByKey.get(questionKey) ?? null,
    combinedMarkScheme: markSchemeByKey.get(questionKey) ?? null,
  }));
}

export function statusToneClass(tone: MarkingTone) {
  if (tone === "confirmed") return "border-success/20 bg-success-soft text-success";
  if (tone === "review") return "border-warning/25 bg-warning-soft text-warning";
  if (tone === "failure") return "border-danger/25 bg-danger-soft text-danger";
  if (tone === "active") return "border-accent/20 bg-accent-soft text-accent-deep";
  return "border-text/10 bg-bg-warm text-text-muted";
}
