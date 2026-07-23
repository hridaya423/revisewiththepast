import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { authComponent } from "./auth";

type QuestionProgressState = "confirmed" | "current" | "review" | "ready" | "waiting" | "failed";

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  return await authComponent.getAuthUser(ctx);
}

async function requireOwnedSubmission(ctx: QueryCtx | MutationCtx, submissionId: Id<"markingSubmissions">) {
  const user = await authComponent.getAuthUser(ctx);
  const submission = await ctx.db.get(submissionId);
  if (!submission || !submission.ownerId || submission.ownerId !== String(user._id)) {
    throw new Error("Unauthorized");
  }
  return { user, submission };
}

function isConfirmedScore(score: Doc<"markingScores">) {
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
  const progress = Array.from(orderedKeys).map<{ key: string; label: string; state: QuestionProgressState }>((questionKey, index) => {
    const score = scoreByQuestion.get(questionKey);
    const status = statusByQuestion.get(questionKey)?.status;
    let state: QuestionProgressState = "waiting";
    if (status === "failed") state = "failed";
    else if (score?.needsReview || status === "needs_manual_review") state = "review";
    else if (score && isConfirmedScore(score)) state = "confirmed";
    else if (score || status === "ai_scored" || status === "mark_scheme_ready" || status === "ocr_ready") state = "ready";
    return {
      key: questionKey,
      label: String(index + 1).padStart(2, "0"),
      state,
    };
  });
  const current = progress.find((item) => item.state === "ready") ?? progress.find((item) => item.state === "waiting");
  if (current) current.state = "current";
  return progress;
}

function summarizeMarking(
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
    averageConfidence: scores.length > 0
      ? scores.reduce((sum, score) => sum + score.confidence, 0) / scores.length
      : null,
    questionProgress,
    gapTopics,
  };
}

export const createMarkingSubmission = mutation({
  args: {
    savedPaperId: v.optional(v.id("savedPapers")),
    boardCode: v.string(),
    subjectSlug: v.string(),
    subjectKey: v.string(),
    paperCode: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
    year: v.optional(v.number()),
    session: v.optional(v.string()),
    rubricVersion: v.optional(v.string()),
    studentLabel: v.optional(v.string()),
    importSource: v.optional(v.union(
      v.literal("manual_upload"),
      v.literal("imported_pdf"),
      v.literal("saved_paper"),
    )),
    detectedPaperIdentity: v.optional(v.object({
      paperCode: v.string(),
      year: v.number(),
      session: v.string(),
      tier: v.union(v.literal("none"), v.literal("foundation"), v.literal("higher")),
      sourceRelativePath: v.optional(v.string()),
      examReference: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    if (args.savedPaperId) {
      const savedPaper = await ctx.db.get(args.savedPaperId);
      if (!savedPaper || savedPaper.ownerId !== String(user._id)) {
        throw new Error("Unauthorized");
      }
    }
    const now = Date.now();
    return await ctx.db.insert("markingSubmissions", {
      ownerId: String(user._id),
      savedPaperId: args.savedPaperId,
      ...args,
      status: "uploaded",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setMarkingSubmissionStatus = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    status: v.union(
      v.literal("uploaded"),
      v.literal("ocr_complete"),
      v.literal("scored"),
      v.literal("review_required"),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    await ctx.db.patch(args.submissionId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return args.submissionId;
  },
});

export const updateMarkingSubmissionMetadata = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    importSource: v.optional(v.union(
      v.literal("manual_upload"),
      v.literal("imported_pdf"),
      v.literal("saved_paper"),
    )),
    detectedPaperIdentity: v.optional(v.object({
      paperCode: v.string(),
      year: v.number(),
      session: v.string(),
      tier: v.union(v.literal("none"), v.literal("foundation"), v.literal("higher")),
      sourceRelativePath: v.optional(v.string()),
      examReference: v.optional(v.string()),
    })),
    paperCode: v.optional(v.string()),
    year: v.optional(v.number()),
    session: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    const { submissionId, ...patch } = args;
    await ctx.db.patch(submissionId, {
      ...patch,
      updatedAt: Date.now(),
    });
    return submissionId;
  },
});

export const upsertMarkingResponse = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    questionNumber: v.optional(v.string()),
    questionPartNumber: v.optional(v.string()),
    sourceImageUrl: v.optional(v.string()),
    ocrText: v.string(),
    ocrProvider: v.string(),
    ocrModel: v.string(),
    ocrConfidence: v.optional(v.number()),
    ocrRawJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    const now = Date.now();
    const existing = await ctx.db
      .query("markingResponses")
      .withIndex("by_submission_question", (q) => q.eq("submissionId", args.submissionId))
      .filter((q) => q.eq(q.field("questionKey"), args.questionKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("markingResponses", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertMarkingScore = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    awardedMarks: v.number(),
    maxMarks: v.number(),
    confidence: v.number(),
    needsReview: v.boolean(),
    rationale: v.string(),
    evidenceJson: v.string(),
    scorerProvider: v.string(),
    scorerModel: v.string(),
    scoreStatus: v.optional(v.union(v.literal("ai_suggested"), v.literal("confirmed"))),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    const now = Date.now();
    const existing = await ctx.db
      .query("markingScores")
      .withIndex("by_submission_question", (q) => q.eq("submissionId", args.submissionId))
      .filter((q) => q.eq(q.field("questionKey"), args.questionKey))
      .unique();

    if (existing) {
      if (isConfirmedScore(existing) && args.scoreStatus === "ai_suggested") return existing._id;
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("markingScores", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addMarkingResponsePage = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    questionNumber: v.optional(v.string()),
    questionPartNumber: v.optional(v.string()),
    pageLabel: v.optional(v.string()),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    cdnUploadId: v.string(),
    sourceImageUrl: v.string(),
    scriptPageNumber: v.optional(v.number()),
    ocrText: v.optional(v.string()),
    uploadedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    return await ctx.db.insert("markingResponsePages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const upsertMarkingQuestionStatus = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    status: v.union(
      v.literal("unmapped"),
      v.literal("pages_assigned"),
      v.literal("ocr_pending"),
      v.literal("ocr_ready"),
      v.literal("mark_scheme_ready"),
      v.literal("ai_scored"),
      v.literal("saved"),
      v.literal("needs_manual_review"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    const now = Date.now();
    const existing = await ctx.db
      .query("markingQuestionStatuses")
      .withIndex("by_submission_question", (q) => q.eq("submissionId", args.submissionId))
      .filter((q) => q.eq(q.field("questionKey"), args.questionKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        failureReason: args.failureReason,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("markingQuestionStatuses", {
      submissionId: args.submissionId,
      questionKey: args.questionKey,
      status: args.status,
      failureReason: args.failureReason,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addMarkingModeration = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    originalAwardedMarks: v.number(),
    moderatedAwardedMarks: v.number(),
    moderatorLabel: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    return await ctx.db.insert("markingModerations", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getMarkingSubmissionBundle = query({
  args: {
    submissionId: v.id("markingSubmissions"),
  },
  handler: async (ctx, args) => {
    const { submission } = await requireOwnedSubmission(ctx, args.submissionId);
    const savedPaperId = submission.savedPaperId;
    const savedPaper = savedPaperId ? await ctx.db.get(savedPaperId) : null;
    const savedPaperQuestions = savedPaperId
      ? await ctx.db
        .query("savedPaperQuestions")
        .withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", savedPaperId))
        .collect()
      : [];

    const responses = await ctx.db
      .query("markingResponses")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();

    const pages = await ctx.db
      .query("markingResponsePages")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();

    const scores = await ctx.db
      .query("markingScores")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();

    const moderations = await ctx.db
      .query("markingModerations")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();

    const questionStatuses = await ctx.db
      .query("markingQuestionStatuses")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();

    const orderedSavedPaperQuestions = savedPaperQuestions.sort((a, b) => a.displayOrder - b.displayOrder);

    return {
      submission,
      savedPaper,
      savedPaperQuestions: orderedSavedPaperQuestions,
      pages: pages.sort((a, b) => (a.scriptPageNumber ?? 0) - (b.scriptPageNumber ?? 0) || a.createdAt - b.createdAt),
      responses,
      scores,
      moderations,
      questionStatuses,
      insights: summarizeMarking(savedPaper, orderedSavedPaperQuestions, pages, responses, scores, moderations, questionStatuses),
    };
  },
});

export const listMarkingSubmissions = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const submissions = (await ctx.db
      .query("markingSubmissions")
      .withIndex("by_owner", (q) => q.eq("ownerId", String(user._id)))
      .collect())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 20);

    const summaries = await Promise.all(submissions.map(async (submission) => {
      const savedPaperId = submission.savedPaperId;
      const [savedPaper, pages, scores, responses, moderations, questionStatuses, savedPaperQuestions] = await Promise.all([
        savedPaperId ? ctx.db.get(savedPaperId) : Promise.resolve(null),
        ctx.db.query("markingResponsePages").withIndex("by_submission", (q) => q.eq("submissionId", submission._id)).collect(),
        ctx.db.query("markingScores").withIndex("by_submission", (q) => q.eq("submissionId", submission._id)).collect(),
        ctx.db.query("markingResponses").withIndex("by_submission", (q) => q.eq("submissionId", submission._id)).collect(),
        ctx.db.query("markingModerations").withIndex("by_submission", (q) => q.eq("submissionId", submission._id)).collect(),
        ctx.db.query("markingQuestionStatuses").withIndex("by_submission", (q) => q.eq("submissionId", submission._id)).collect(),
        savedPaperId
          ? ctx.db.query("savedPaperQuestions").withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", savedPaperId)).collect()
          : Promise.resolve([]),
      ]);
      const orderedSavedPaperQuestions = savedPaperQuestions.sort((a, b) => a.displayOrder - b.displayOrder);
      const summary = summarizeMarking(savedPaper, orderedSavedPaperQuestions, pages, responses, scores, moderations, questionStatuses);
      return {
        ...submission,
        savedPaperTitle: savedPaper?.title ?? null,
        savedPaperPdfUrl: savedPaper?.pdfUrl ?? null,
        savedPaperQuestionCount: savedPaper?.questionCount ?? summary.questionCount,
        ...summary,
      };
    }));

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
