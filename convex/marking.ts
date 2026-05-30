import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import { authComponent } from "./auth";

async function requireOwner(ctx: any) {
  return await authComponent.getAuthUser(ctx);
}

async function requireOwnedSubmission(ctx: any, submissionId: any) {
  const user = await authComponent.getAuthUser(ctx);
  const submission = await ctx.db.get(submissionId);
  if (!submission || !submission.ownerId || submission.ownerId !== String(user._id)) {
    throw new Error("Unauthorized");
  }
  return { user, submission };
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
    const savedPaper = submission.savedPaperId ? await ctx.db.get(submission.savedPaperId) : null;
    const savedPaperQuestions = submission.savedPaperId
      ? await ctx.db
        .query("savedPaperQuestions")
        .withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", submission.savedPaperId))
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

    return {
      submission,
      savedPaper,
      savedPaperQuestions: savedPaperQuestions.sort((a, b) => a.displayOrder - b.displayOrder),
      pages: pages.sort((a, b) => a.createdAt - b.createdAt),
      responses,
      scores,
      moderations,
      insights: {
        questionCount: new Set([
          ...savedPaperQuestions.map((question) => question.unitKey),
          ...pages.map((page) => page.questionKey),
          ...responses.map((response) => response.questionKey),
          ...scores.map((score) => score.questionKey),
        ]).size,
        uploadedPageCount: pages.length,
        ocrCompletedCount: responses.length,
        scoredCount: scores.length,
        reviewRequiredCount: scores.filter((score) => score.needsReview).length,
        totalAwardedMarks: scores.reduce((sum, score) => sum + score.awardedMarks, 0),
        totalMaxMarks: scores.reduce((sum, score) => sum + score.maxMarks, 0),
        averageConfidence: scores.length > 0
          ? scores.reduce((sum, score) => sum + score.confidence, 0) / scores.length
          : null,
      },
    };
  },
});

export const listMarkingSubmissions = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const submissions = await ctx.db
      .query("markingSubmissions")
      .withIndex("by_owner", (q) => q.eq("ownerId", String(user._id)))
      .collect();

    const summaries = await Promise.all(submissions.map(async (submission) => {
      const savedPaper = submission.savedPaperId ? await ctx.db.get(submission.savedPaperId) : null;
      const pages = await ctx.db
        .query("markingResponsePages")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      const scores = await ctx.db
        .query("markingScores")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      return {
        ...submission,
        savedPaperTitle: savedPaper?.title ?? null,
        uploadedPageCount: pages.length,
        scoredCount: scores.length,
        totalAwardedMarks: scores.reduce((sum, score) => sum + score.awardedMarks, 0),
        totalMaxMarks: scores.reduce((sum, score) => sum + score.maxMarks, 0),
        reviewRequiredCount: scores.filter((score) => score.needsReview).length,
      };
    }));

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
