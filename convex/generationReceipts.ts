import { mutation } from "./_generated/server";
import { v } from "convex/values";

import { requireAuthenticatedUser } from "./model/auth";
import { requireServiceSecret, serviceSecretArg } from "./model/serviceAuth";

export const recordGeneration = mutation({
  args: {
    ...serviceSecretArg,
    pdfSha256: v.string(),
    subjectKey: v.string(),
    subjectTier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
    selectedUnitKeys: v.array(v.string()),
    targetMarks: v.number(),
    totalMarks: v.number(),
    timeMinutes: v.number(),
    questionCount: v.number(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const existing = await ctx.db
      .query("generationReceipts")
      .withIndex("by_pdf_sha256", (q) => q.eq("pdfSha256", args.pdfSha256))
      .first();
    if (existing) return existing._id;

    const { serviceSecret, ...receipt } = args;
    void serviceSecret;
    return await ctx.db.insert("generationReceipts", {
      ...receipt,
      createdAt: Date.now(),
    });
  },
});

export const claimGenerationReceipt = mutation({
  args: {
    receiptId: v.id("generationReceipts"),
    pdfSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const receipt = await ctx.db.get("generationReceipts", args.receiptId);
    if (!receipt || receipt.pdfSha256 !== args.pdfSha256) {
      throw new Error("This file was not produced by the paper generator. Generate the paper again, then save it.");
    }
    const ownerId = String(user._id);
    if (receipt.ownerId && receipt.ownerId !== ownerId) {
      throw new Error("Unauthorized");
    }
    if (!receipt.ownerId) {
      await ctx.db.patch("generationReceipts", receipt._id, {
        ownerId,
        claimedAt: Date.now(),
      });
    }
    return {
      subjectKey: receipt.subjectKey,
      subjectTier: receipt.subjectTier,
      selectedUnitKeys: receipt.selectedUnitKeys,
      targetMarks: receipt.targetMarks,
      totalMarks: receipt.totalMarks,
      timeMinutes: receipt.timeMinutes,
      questionCount: receipt.questionCount,
    };
  },
});
