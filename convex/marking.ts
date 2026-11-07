import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { requireAuthenticatedUser, requireOwnedSubmission } from "./model/auth";
import { isConfirmedScore, summarizeMarking } from "./model/markingSummary";
import { getResponsePageQuestionKeys } from "../shared/domain/marking";

async function requirePageTargets(ctx: MutationCtx | QueryCtx, submissionId: Id<"markingSubmissions">, keys: string[]) {
  const owned = await requireOwnedSubmission(ctx, submissionId);
  if (!keys.length || keys.length > 80 || keys.some((key) => !key.trim() || key.length > 512)) throw new Error("Invalid page mapping.");
  if (owned.submission.savedPaperId) {
    const paper = await ctx.db.get("savedPapers", owned.submission.savedPaperId);
    const questions = await ctx.db.query("savedPaperQuestions").withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", owned.submission.savedPaperId!)).collect();
    const allowed = new Set(questions.map((question) => question.unitKey));
    if (!paper || paper.subjectKey !== owned.submission.subjectKey || keys.some((key) => !allowed.has(key))) throw new Error("Unauthorized");
  }
  return owned;
}

export const validateResponsePageTargets = query({
  args: { submissionId: v.id("markingSubmissions"), questionKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requirePageTargets(ctx, args.submissionId, args.questionKeys);
    return null;
  },
});

export const mergeResponsePageTargets = mutation({
  args: { submissionId: v.id("markingSubmissions"), pageId: v.id("markingResponsePages"), questionKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requirePageTargets(ctx, args.submissionId, args.questionKeys);
    const page = await ctx.db.get("markingResponsePages", args.pageId);
    if (!page || page.submissionId !== args.submissionId) throw new Error("Unauthorized");
    const questionKeys = Array.from(new Set([...getResponsePageQuestionKeys(page), ...args.questionKeys]));
    const added = questionKeys.filter((key) => !getResponsePageQuestionKeys(page).includes(key));
    if (!added.length) return questionKeys;
    await ctx.db.patch("markingResponsePages", page._id, { questionKeys });
    await notePageChanges(ctx, args.submissionId, added, Date.now());
    await touchSubmission(ctx, args.submissionId, Date.now());
    return questionKeys;
  },
});

export const setResponsePageTargets = mutation({
  args: { submissionId: v.id("markingSubmissions"), pageId: v.id("markingResponsePages"), questionKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.questionKeys.length) await requirePageTargets(ctx, args.submissionId, args.questionKeys);
    else await requireOwnedSubmission(ctx, args.submissionId);
    const page = await ctx.db.get("markingResponsePages", args.pageId);
    if (!page || page.submissionId !== args.submissionId) throw new Error("Unauthorized");
    const previous = getResponsePageQuestionKeys(page);
    const questionKeys = Array.from(new Set(args.questionKeys));
    const changed = Array.from(new Set([...previous, ...questionKeys])).filter((key) => previous.includes(key) !== questionKeys.includes(key));
    if (changed.length) {
      await ctx.db.patch("markingResponsePages", page._id, { questionKeys });
      await notePageChanges(ctx, args.submissionId, changed, Date.now());
      await touchSubmission(ctx, args.submissionId, Date.now());
    }
    return questionKeys;
  },
});

async function touchSubmission(ctx: MutationCtx, submissionId: Id<"markingSubmissions">, updatedAt: number) {
  const submission = await ctx.db.get("markingSubmissions", submissionId);
  if (!submission) return;
  const savedPaperId = submission.savedPaperId;
  const [savedPaper, savedPaperQuestions, pages, responses, scores, moderations, questionStatuses] = await Promise.all([
    savedPaperId ? ctx.db.get("savedPapers", savedPaperId) : Promise.resolve(null),
    savedPaperId
      ? ctx.db.query("savedPaperQuestions").withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", savedPaperId)).collect()
      : Promise.resolve([]),
    ctx.db.query("markingResponsePages").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
    ctx.db.query("markingResponses").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
    ctx.db.query("markingScores").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
    ctx.db.query("markingModerations").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
    ctx.db.query("markingQuestionStatuses").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
  ]);
  const summary = summarizeMarking(savedPaper, savedPaperQuestions, pages, responses, scores, moderations, questionStatuses);
  return ctx.db.patch("markingSubmissions", submissionId, { updatedAt, summary });
}

export const createMarkingSubmission = mutation({
  args: {
    idempotencyKey: v.optional(v.string()),
    newAttempt: v.optional(v.boolean()),
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
    const { newAttempt, ...details } = args;
    const user = await requireAuthenticatedUser(ctx);
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("markingSubmissions")
        .withIndex("by_owner_idempotency_key", (q) => q.eq("ownerId", String(user._id)).eq("idempotencyKey", args.idempotencyKey))
        .unique();
      if (existing) return existing._id;
    }
    let savedPaper: Doc<"savedPapers"> | null = null;
    if (args.savedPaperId) {
      savedPaper = await ctx.db.get("savedPapers", args.savedPaperId);
      if (!savedPaper || savedPaper.ownerId !== String(user._id)) {
        throw new Error("Unauthorized");
      }
      if (savedPaper.generationKind === "shadow") throw new Error("SHADOW_MARKING_UNSUPPORTED");
      if (args.importSource === "saved_paper" && !newAttempt) {
        const questionCount = savedPaper.questionCount;
        const attempts = (await ctx.db.query("markingSubmissions").withIndex("by_saved_paper", (q) => q.eq("savedPaperId", args.savedPaperId!)).collect())
          .filter((attempt) => attempt.ownerId === String(user._id))
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const unfinished = attempts.find((attempt) => (attempt.summary?.confirmedCount ?? 0) < questionCount || (attempt.summary?.reviewRequiredCount ?? 0) > 0);
        const resume = unfinished ?? attempts[0];
        if (resume) return resume._id;
      }
    }
    const now = Date.now();
    return await ctx.db.insert("markingSubmissions", {
      ownerId: String(user._id),
      savedPaperId: args.savedPaperId,
      ...details,
      boardCode: savedPaper?.boardCode ?? details.boardCode,
      subjectSlug: savedPaper?.subjectSlug ?? details.subjectSlug,
      subjectKey: savedPaper?.subjectKey ?? details.subjectKey,
      savedPaperTitle: savedPaper?.title,
      savedPaperPdfUrl: savedPaper?.pdfUrl,
      savedPaperQuestionCount: savedPaper?.questionCount,
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

async function assertScoreMaxMarks(
  ctx: MutationCtx,
  submission: { savedPaperId?: Id<"savedPapers"> },
  questionKey: string,
  maxMarks: number,
) {
  if (!submission.savedPaperId) return;
  const savedQuestion = (await ctx.db
    .query("savedPaperQuestions")
    .withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", submission.savedPaperId!))
    .collect())
    .find((question) => question.unitKey === questionKey);
  if (savedQuestion && savedQuestion.totalMarks !== maxMarks) {
    throw new Error("Maximum marks for this question are fixed by the mark scheme.");
  }
}

async function findMarkingScore(ctx: MutationCtx, submissionId: Id<"markingSubmissions">, questionKey: string) {
  return await ctx.db
    .query("markingScores")
    .withIndex("by_submission_question", (q) => q.eq("submissionId", submissionId))
    .filter((q) => q.eq(q.field("questionKey"), questionKey))
    .unique();
}

async function findQuestionStatus(ctx: MutationCtx, submissionId: Id<"markingSubmissions">, questionKey: string) {
  return await ctx.db
    .query("markingQuestionStatuses")
    .withIndex("by_submission_question", (q) => q.eq("submissionId", submissionId))
    .filter((q) => q.eq(q.field("questionKey"), questionKey))
    .unique();
}

async function writeQuestionStatus(
  ctx: MutationCtx,
  submissionId: Id<"markingSubmissions">,
  questionKey: string,
  status: "unmapped" | "pages_assigned" | "ocr_pending" | "ocr_ready" | "mark_scheme_ready" | "ai_scored" | "saved" | "needs_manual_review" | "failed",
  failureReason: string | undefined,
  now: number,
) {
  const existing = await findQuestionStatus(ctx, submissionId, questionKey);
  now = Math.max(now, (existing?.updatedAt ?? 0) + 1);
  if (existing) {
    await ctx.db.patch("markingQuestionStatuses", existing._id, { status, failureReason, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("markingQuestionStatuses", {
    submissionId,
    questionKey,
    status,
    failureReason,
    createdAt: now,
    updatedAt: now,
  });
}

async function notePageChanges(ctx: MutationCtx, submissionId: Id<"markingSubmissions">, keys: string[], now: number) {
  for (const key of keys) {
    const status = await findQuestionStatus(ctx, submissionId, key);
    const needsReview = status && !["unmapped", "pages_assigned", "failed"].includes(status.status);
    await writeQuestionStatus(ctx, submissionId, key, needsReview ? "needs_manual_review" : "pages_assigned", undefined, now);
  }
}

const markingQuestionStatusValidator = v.union(
  v.literal("unmapped"),
  v.literal("pages_assigned"),
  v.literal("ocr_pending"),
  v.literal("ocr_ready"),
  v.literal("mark_scheme_ready"),
  v.literal("ai_scored"),
  v.literal("saved"),
  v.literal("needs_manual_review"),
  v.literal("failed"),
);

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
    const { submission } = await requireOwnedSubmission(ctx, args.submissionId);
    await assertScoreMaxMarks(ctx, submission, args.questionKey, args.maxMarks);
    const now = Date.now();
    const existing = await findMarkingScore(ctx, args.submissionId, args.questionKey);

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

export const recordQuestionScore = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    score: v.optional(v.object({
      awardedMarks: v.number(),
      maxMarks: v.number(),
      confidence: v.number(),
      needsReview: v.boolean(),
      rationale: v.string(),
      evidenceJson: v.string(),
      scorerProvider: v.string(),
      scorerModel: v.string(),
      scoreStatus: v.optional(v.union(v.literal("ai_suggested"), v.literal("confirmed"))),
    })),
    status: markingQuestionStatusValidator,
    failureReason: v.optional(v.string()),
    /** Revision the caller last saw: `null` means "no score yet". Omitted for automated writers. */
    expectedUpdatedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { expectedUpdatedAt, ...args }) => {
    const { submission } = await requireOwnedSubmission(ctx, args.submissionId);
    const now = Date.now();

    if (args.score) {
      await assertScoreMaxMarks(ctx, submission, args.questionKey, args.score.maxMarks);
      const existing = await findMarkingScore(ctx, args.submissionId, args.questionKey);
      if (expectedUpdatedAt !== undefined && existing && (existing.updatedAt ?? null) !== expectedUpdatedAt) {
        const same = isConfirmedScore(existing) && args.score.scoreStatus === "confirmed"
          && existing.awardedMarks === args.score.awardedMarks && existing.maxMarks === args.score.maxMarks
          && existing.needsReview === args.score.needsReview && existing.rationale === args.score.rationale;
        // A repeated confirmation of identical values is a success, not a conflict.
        if (same) return { scoreId: existing._id, updatedAt: existing.updatedAt, conflict: null };
        return {
          scoreId: existing._id,
          updatedAt: existing.updatedAt,
          conflict: {
            awardedMarks: existing.awardedMarks,
            maxMarks: existing.maxMarks,
            needsReview: existing.needsReview,
            rationale: existing.rationale,
            scoreStatus: existing.scoreStatus ?? "ai_suggested",
            updatedAt: existing.updatedAt,
          },
        };
      }
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && !existing) {
        throw new Error("This score was removed. Reload the paper and try again.");
      }
      const blocked = existing && isConfirmedScore(existing) && args.score.scoreStatus === "ai_suggested";
      let scoreId = existing?._id ?? null;
      if (!blocked) {
        const score = { ...args.score, questionKey: args.questionKey, submissionId: args.submissionId };
        if (existing) {
          await ctx.db.patch("markingScores", existing._id, { ...score, updatedAt: now });
        } else {
          scoreId = await ctx.db.insert("markingScores", { ...score, createdAt: now, updatedAt: now });
        }
        await writeQuestionStatus(ctx, args.submissionId, args.questionKey, args.status, args.failureReason, now);
      }
      await touchSubmission(ctx, args.submissionId, now);
      return { scoreId, updatedAt: blocked && existing ? existing.updatedAt : now, conflict: null };
    }

    await writeQuestionStatus(ctx, args.submissionId, args.questionKey, args.status, args.failureReason, now);
    await touchSubmission(ctx, args.submissionId, now);
    return { scoreId: null, updatedAt: null, conflict: null };
  },
});

export const addMarkingResponsePage = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    uploadKey: v.optional(v.string()),
    questionKey: v.string(),
    questionKeys: v.optional(v.array(v.string())),
    questionNumber: v.optional(v.string()),
    questionPartNumber: v.optional(v.string()),
    pageLabel: v.optional(v.string()),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    cdnUploadId: v.optional(v.string()),
    fileId: v.optional(v.id("markingFiles")),
    sourceImageUrl: v.string(),
    scriptPageNumber: v.optional(v.number()),
    ocrText: v.optional(v.string()),
    uploadedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const keys = getResponsePageQuestionKeys(args);
    const { user } = await requirePageTargets(ctx, args.submissionId, keys);
    args.questionKey = keys[0];
    const file = args.fileId ? await ctx.db.get("markingFiles", args.fileId) : null;
    if (!file || file.ownerId !== String(user._id)) throw new Error("Unauthorized");
    args.sourceImageUrl = `/api/marking/files/${file._id}`;
    if (args.uploadKey) {
      const existingUpload = await ctx.db
        .query("markingResponsePages")
        .withIndex("by_submission_upload_key", (q) => q.eq("submissionId", args.submissionId).eq("uploadKey", args.uploadKey))
        .unique();
      if (existingUpload) {
        await ctx.db.patch("markingResponsePages", existingUpload._id, {
          fileId: file._id, sourceImageUrl: args.sourceImageUrl,
          questionKeys: Array.from(new Set([...getResponsePageQuestionKeys(existingUpload), ...keys])),
        });
        await notePageChanges(ctx, args.submissionId, keys.filter((key) => !getResponsePageQuestionKeys(existingUpload).includes(key)), Date.now());
        await touchSubmission(ctx, args.submissionId, Date.now());
        return existingUpload._id;
      }
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

    await notePageChanges(ctx, args.submissionId, keys, now);

    await touchSubmission(ctx, args.submissionId, now);
    return pageId;
  },
});

export const upsertMarkingQuestionStatus = mutation({
  args: {
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    status: markingQuestionStatusValidator,
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId);
    const statusId = await writeQuestionStatus(ctx, args.submissionId, args.questionKey, args.status, args.failureReason, Date.now());
    await touchSubmission(ctx, args.submissionId, Date.now());
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
      .withIndex("by_owner_updated_at", (q) => q.eq("ownerId", String(user._id)))
      .order("desc")
      .take(20));

    const summaries = await Promise.all(submissions.map(async (submission) => {
      const needsSavedPaperFallback = submission.savedPaperId
        && (submission.savedPaperTitle === undefined || submission.savedPaperPdfUrl === undefined || submission.savedPaperQuestionCount === undefined);
      const needsSummaryFallback = submission.summary === undefined;
      if (!needsSavedPaperFallback && !needsSummaryFallback) {
        const { summary: storedSummary, savedPaperTitle, savedPaperPdfUrl, savedPaperQuestionCount, ...rest } = submission;
        return {
          ...rest,
          savedPaperTitle: savedPaperTitle ?? null,
          savedPaperPdfUrl: savedPaperPdfUrl ?? null,
          savedPaperQuestionCount: savedPaperQuestionCount ?? 0,
          ...storedSummary,
        };
      }

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
      const summary = submission.summary ?? summarizeMarking(savedPaper, orderedSavedPaperQuestions, pages, responses, scores, moderations, questionStatuses);
      const { summary: storedSummary, savedPaperTitle, savedPaperPdfUrl, savedPaperQuestionCount, ...rest } = submission;
      return {
        ...rest,
        savedPaperTitle: savedPaperTitle ?? savedPaper?.title ?? null,
        savedPaperPdfUrl: savedPaperPdfUrl ?? savedPaper?.pdfUrl ?? null,
        savedPaperQuestionCount: savedPaperQuestionCount ?? savedPaper?.questionCount ?? summary.questionCount,
        ...(storedSummary ?? summary),
      };
    }));

    return summaries;
  },
});
