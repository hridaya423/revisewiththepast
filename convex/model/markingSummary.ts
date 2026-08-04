import type { Doc } from "../_generated/dataModel";
import { deriveQuestionProgressState, deriveSubmissionStatus, type QuestionProgressState } from "../../shared/domain/marking";

export function isConfirmedScore(score: Doc<"markingScores">) {
  return score.scoreStatus !== "ai_suggested";
}

function latestModeratedMarks(moderations: Doc<"markingModerations">[]) {
  const byQuestion = new Map<string, Doc<"markingModerations">>();
  for (const moderation of moderations) {
    const current = byQuestion.get(moderation.questionKey);
    if (!current || moderation.createdAt > current.createdAt) byQuestion.set(moderation.questionKey, moderation);
  }
  return byQuestion;
}

function buildQuestionProgress(
  savedPaperQuestions: Doc<"savedPaperQuestions">[],
  pages: Doc<"markingResponsePages">[],
  responses: Doc<"markingResponses">[],
  scores: Doc<"markingScores">[],
  statuses: Doc<"markingQuestionStatuses">[],
) {
  const orderedKeys = new Set(savedPaperQuestions.map((question) => question.unitKey));
  const activityRows = [
    ...pages.sort((left, right) => (left.scriptPageNumber ?? Number.MAX_SAFE_INTEGER) - (right.scriptPageNumber ?? Number.MAX_SAFE_INTEGER) || left.createdAt - right.createdAt),
    ...responses.sort((left, right) => left.createdAt - right.createdAt),
    ...scores.sort((left, right) => left.createdAt - right.createdAt),
    ...statuses.sort((left, right) => left.createdAt - right.createdAt),
  ];
  for (const row of activityRows) orderedKeys.add(row.questionKey);
  const scoreByQuestion = new Map(scores.map((score) => [score.questionKey, score]));
  const statusByQuestion = new Map(statuses.map((status) => [status.questionKey, status]));
  const progress: Array<{ key: string; label: string; state: QuestionProgressState }> = Array.from(orderedKeys).map((questionKey, index) => {
    const score = scoreByQuestion.get(questionKey);
    const status = statusByQuestion.get(questionKey)?.status;
    const state = deriveQuestionProgressState({
      hasPages: pages.some((page) => page.questionKey === questionKey),
      hasResponse: responses.some((response) => response.questionKey === questionKey),
      hasScore: Boolean(score),
      scoreConfirmed: Boolean(score && isConfirmedScore(score)),
      scoreNeedsReview: Boolean(score?.needsReview),
      status,
    });
    return { key: questionKey, label: String(index + 1).padStart(2, "0"), state };
  });
  const current = progress.find((item) => item.state === "ready") ?? progress.find((item) => item.state === "waiting");
  if (current) current.state = "current";
  return progress;
}

export function summarizeMarking(
  savedPaper: Doc<"savedPapers"> | null,
  savedPaperQuestions: Doc<"savedPaperQuestions">[],
  pages: Doc<"markingResponsePages">[],
  responses: Doc<"markingResponses">[],
  scores: Doc<"markingScores">[],
  moderations: Doc<"markingModerations">[],
  statuses: Doc<"markingQuestionStatuses">[],
) {
  const confirmedScores = scores.filter(isConfirmedScore);
  const suggestedScores = scores.filter((score) => !isConfirmedScore(score));
  const moderatedMarks = latestModeratedMarks(moderations);
  const awardedMarks = (score: Doc<"markingScores">) => moderatedMarks.get(score.questionKey)?.moderatedAwardedMarks ?? score.awardedMarks;
  const reviewQuestionKeys = new Set([
    ...scores.filter((score) => score.needsReview).map((score) => score.questionKey),
    ...statuses.filter((status) => status.status === "needs_manual_review" || status.status === "failed").map((status) => status.questionKey),
  ]);
  const questionProgress = buildQuestionProgress(savedPaperQuestions, pages, responses, scores, statuses);
  const questionByKey = new Map(savedPaperQuestions.map((question) => [question.unitKey, question]));
  const missedMarksByTopic = new Map<string, number>();
  for (const score of confirmedScores) {
    const missedMarks = Math.max(0, score.maxMarks - awardedMarks(score));
    if (missedMarks === 0) continue;
    for (const label of questionByKey.get(score.questionKey)?.topicLabels ?? []) {
      const normalizedLabel = label.trim();
      if (normalizedLabel) missedMarksByTopic.set(normalizedLabel, (missedMarksByTopic.get(normalizedLabel) ?? 0) + missedMarks);
    }
  }
  const gapTopics = Array.from(missedMarksByTopic)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, missedMarks]) => ({ label, missedMarks }));
  const confirmedAwardedMarks = confirmedScores.reduce((sum, score) => sum + awardedMarks(score), 0);
  const confirmedMaxMarks = confirmedScores.reduce((sum, score) => sum + score.maxMarks, 0);
  const knownQuestionKeys = new Set(questionProgress.map((item) => item.key));

  return {
    status: deriveSubmissionStatus({
      questionCount: knownQuestionKeys.size,
      reviewRequiredCount: reviewQuestionKeys.size,
      confirmedCount: confirmedScores.length,
      ocrCompletedCount: new Set(responses.map((response) => response.questionKey)).size,
    }),
    questionCount: knownQuestionKeys.size,
    uploadedPageCount: pages.length,
    ocrCompletedCount: new Set(responses.map((response) => response.questionKey)).size,
    scoredCount: confirmedScores.length,
    confirmedCount: confirmedScores.length,
    aiSuggestedCount: suggestedScores.length,
    reviewRequiredCount: reviewQuestionKeys.size,
    totalAwardedMarks: confirmedAwardedMarks,
    totalMaxMarks: confirmedMaxMarks,
    confirmedAwardedMarks,
    confirmedMaxMarks,
    paperMaxMarks: savedPaper?.totalMarks ?? Math.max(confirmedMaxMarks, scores.reduce((sum, score) => sum + score.maxMarks, 0)),
    aiSuggestedAwardedMarks: suggestedScores.reduce((sum, score) => sum + score.awardedMarks, 0),
    aiSuggestedMaxMarks: suggestedScores.reduce((sum, score) => sum + score.maxMarks, 0),
    averageConfidence: scores.length > 0 ? scores.reduce((sum, score) => sum + score.confidence, 0) / scores.length : null,
    questionProgress,
    gapTopics,
  };
}
