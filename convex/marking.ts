import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { requireAuthenticatedUser, requireOwnedSubmission } from "./model/auth";
import { isConfirmedScore, summarizeMarking } from "./model/markingSummary";

function touchSubmission(ctx: MutationCtx, submissionId: Id<"markingSubmissions">, updatedAt: number) {
  return ctx.db.patch("markingSubmissions", submissionId, { updatedAt });
}

export const createMarkingSubmission = mutation({
  args: {
    idempotencyKey: v.optional(v.string()),
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
    const user = await requireAuthenticatedUser(ctx);
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("markingSubmissions")
        .withIndex("by_owner_idempotency_key", (q) => q.eq("ownerId", String(user._id)).eq("idempotencyKey", args.idempotencyKey))
        .unique();
      if (existing) return existing._id;
    }
    if (args.savedPaperId) {
      const savedPaper = await ctx.db.get("savedPapers", args.savedPaperId);
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
    await ctx.db.patch("markingSubmissions", submissionId, {
      ...patch,
      updatedAt: Date.now(),
    });
    return submissionId;
  },
});

export const getMarkingResponsePageByUploadKey = query({
  args: {
    submissionId: v.id("markingSubmissions"),
    uploadKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    return await ctx.db
      .query("markingResponsePages")
      .withIndex("by_submission_upload_key", (q) => q.eq("submissionId", args.submissionId).eq("uploadKey", args.uploadKey))
      .unique();
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
      await ctx.db.patch("markingResponses", existing._id, {
        ...args,
        updatedAt: now,
      });
      await touchSubmission(ctx, args.submissionId, now);
      return existing._id;
    }

    const responseId = await ctx.db.insert("markingResponses", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    await touchSubmission(ctx, args.submissionId, now);
    return responseId;
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
      await ctx.db.patch("markingScores", existing._id, {
        ...args,
        updatedAt: now,
      });
      await touchSubmission(ctx, args.submissionId, now);
      return existing._id;
    }

    const scoreId = await ctx.db.insert("markingScores", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    await touchSubmission(ctx, args.submissionId, now);
    return scoreId;
  },
});

export const addMarkingResponsePage = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    uploadKey: v.optional(v.string()),
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
    if (args.uploadKey) {
      const existingUpload = await ctx.db
        .query("markingResponsePages")
        .withIndex("by_submission_upload_key", (q) => q.eq("submissionId", args.submissionId).eq("uploadKey", args.uploadKey))
        .unique();
      if (existingUpload) return existingUpload._id;
    }
    const existingPage = args.scriptPageNumber === undefined
      ? null
      : (await ctx.db
        .query("markingResponsePages")
        .withIndex("by_submission_question", (q) => q.eq("submissionId", args.submissionId))
        .collect())
        .find((page) => page.questionKey === args.questionKey && page.scriptPageNumber === args.scriptPageNumber);
    const now = Date.now();
    const pageId = existingPage
      ? (await ctx.db.patch("markingResponsePages", existingPage._id, args), existingPage._id)
      : await ctx.db.insert("markingResponsePages", { ...args, createdAt: now });

    const existingStatus = await ctx.db
      .query("markingQuestionStatuses")
      .withIndex("by_submission_question", (q) => q.eq("submissionId", args.submissionId))
      .collect()
      .then((statuses) => statuses.find((status) => status.questionKey === args.questionKey));
    if (!existingStatus) {
      await ctx.db.insert("markingQuestionStatuses", {
        submissionId: args.submissionId,
        questionKey: args.questionKey,
        status: "pages_assigned",
        createdAt: now,
        updatedAt: now,
      });
    } else if (existingStatus.status === "failed") {
      await ctx.db.patch("markingQuestionStatuses", existingStatus._id, {
        status: "pages_assigned",
        failureReason: undefined,
        updatedAt: now,
      });
    }

    await touchSubmission(ctx, args.submissionId, now);
    return pageId;
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
      await ctx.db.patch("markingQuestionStatuses", existing._id, {
        status: args.status,
        failureReason: args.failureReason,
        updatedAt: now,
      });
      await touchSubmission(ctx, args.submissionId, now);
      return existing._id;
    }

    const statusId = await ctx.db.insert("markingQuestionStatuses", {
      submissionId: args.submissionId,
      questionKey: args.questionKey,
      status: args.status,
      failureReason: args.failureReason,
      createdAt: now,
      updatedAt: now,
    });
    await touchSubmission(ctx, args.submissionId, now);
    return statusId;
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
    const now = Date.now();
    const moderationId = await ctx.db.insert("markingModerations", {
      ...args,
      createdAt: now,
    });
    await touchSubmission(ctx, args.submissionId, now);
    return moderationId;
  },
});

export const getMarkingSubmissionBundle = query({
  args: {
    submissionId: v.id("markingSubmissions"),
  },
  handler: async (ctx, args) => {
    const { submission } = await requireOwnedSubmission(ctx, args.submissionId);
    const savedPaperId = submission.savedPaperId;
    const savedPaper = savedPaperId ? await ctx.db.get("savedPapers", savedPaperId) : null;
    const savedPaperQuestions = savedPaperId
      ? await ctx.db
        .query("savedPaperQuestions")
        .withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", savedPaperId))
        .collect()
      : [];

    const [responses, pages, scores, moderations, questionStatuses] = await Promise.all([
      ctx.db
        .query("markingResponses")
        .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
        .collect(),
      ctx.db
        .query("markingResponsePages")
        .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
        .collect(),
      ctx.db
        .query("markingScores")
        .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
        .collect(),
      ctx.db
        .query("markingModerations")
        .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
        .collect(),
      ctx.db
        .query("markingQuestionStatuses")
        .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
        .collect(),
    ]);

    const orderedSavedPaperQuestions = savedPaperQuestions.sort((a, b) => a.displayOrder - b.displayOrder);

    const insights = summarizeMarking(savedPaper, orderedSavedPaperQuestions, pages, responses, scores, moderations, questionStatuses);
    return {
      submission: { ...submission, status: insights.status },
      savedPaper,
      savedPaperQuestions: orderedSavedPaperQuestions,
      pages: pages.sort((a, b) => (a.scriptPageNumber ?? 0) - (b.scriptPageNumber ?? 0) || a.createdAt - b.createdAt),
      responses,
      scores,
      moderations,
      questionStatuses,
      insights,
    };
  },
});

export const listMarkingSubmissions = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    const submissions = (await ctx.db
      .query("markingSubmissions")
      .withIndex("by_owner", (q) => q.eq("ownerId", String(user._id)))
      .collect())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 20);

    const summaries = await Promise.all(submissions.map(async (submission) => {
      const savedPaperId = submission.savedPaperId;
      const [savedPaper, pages, scores, responses, moderations, questionStatuses, savedPaperQuestions] = await Promise.all([
        savedPaperId ? ctx.db.get("savedPapers", savedPaperId) : Promise.resolve(null),
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
