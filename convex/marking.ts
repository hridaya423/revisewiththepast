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
    const now = Date.now();
    return await ctx.db.insert("markingSubmissions", {
      ownerId: String(user._id),
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

    const responses = await ctx.db
      .query("markingResponses")
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
      responses,
      scores,
      moderations,
    };
  },
});
