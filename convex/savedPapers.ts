import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import { authComponent } from "./auth";

async function requireOwner(ctx: any) {
  return await authComponent.getAuthUser(ctx);
}

async function requireOwnedPaper(ctx: any, savedPaperId: any) {
  const user = await authComponent.getAuthUser(ctx);
  const savedPaper = await ctx.db.get(savedPaperId);
  if (!savedPaper || savedPaper.ownerId !== String(user._id)) {
    throw new Error("Unauthorized");
  }
  return { user, savedPaper };
}

export const createSavedPaper = mutation({
  args: {
    subjectKey: v.string(),
    boardCode: v.string(),
    subjectSlug: v.string(),
    tier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
    title: v.string(),
    targetMarks: v.number(),
    totalMarks: v.number(),
    timeMinutes: v.number(),
    pdfFileName: v.string(),
    pdfContentType: v.string(),
    pdfFileSize: v.number(),
    pdfCdnUploadId: v.string(),
    pdfUrl: v.string(),
    questions: v.array(v.object({
      displayOrder: v.number(),
      unitKey: v.string(),
      sourceQuestionKey: v.string(),
      sourceRelativePath: v.string(),
      paperCode: v.string(),
      year: v.optional(v.number()),
      session: v.optional(v.string()),
      questionNumber: v.string(),
      questionPartNumber: v.optional(v.union(v.string(), v.null())),
      totalMarks: v.number(),
      promptText: v.string(),
      contextText: v.optional(v.union(v.string(), v.null())),
    })),
  },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    const now = Date.now();
    const savedPaperId = await ctx.db.insert("savedPapers", {
      ownerId: String(user._id),
      subjectKey: args.subjectKey,
      boardCode: args.boardCode,
      subjectSlug: args.subjectSlug,
      tier: args.tier,
      title: args.title,
      targetMarks: args.targetMarks,
      totalMarks: args.totalMarks,
      timeMinutes: args.timeMinutes,
      pdfFileName: args.pdfFileName,
      pdfContentType: args.pdfContentType,
      pdfFileSize: args.pdfFileSize,
      pdfCdnUploadId: args.pdfCdnUploadId,
      pdfUrl: args.pdfUrl,
      questionCount: args.questions.length,
      createdAt: now,
      updatedAt: now,
    });

    for (const question of args.questions) {
      await ctx.db.insert("savedPaperQuestions", {
        savedPaperId,
        ...question,
        createdAt: now,
      });
    }

    return savedPaperId;
  },
});

export const listSavedPapers = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const savedPapers = await ctx.db
      .query("savedPapers")
      .withIndex("by_owner", (q) => q.eq("ownerId", String(user._id)))
      .collect();

    return savedPapers.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getSavedPaper = query({
  args: {
    savedPaperId: v.id("savedPapers"),
  },
  handler: async (ctx, args) => {
    const { savedPaper } = await requireOwnedPaper(ctx, args.savedPaperId);
    const questions = await ctx.db
      .query("savedPaperQuestions")
      .withIndex("by_saved_paper_order", (q) => q.eq("savedPaperId", args.savedPaperId))
      .collect();

    return {
      savedPaper,
      questions: questions.sort((a, b) => a.displayOrder - b.displayOrder),
    };
  },
});
