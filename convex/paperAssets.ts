import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const assetArgs = {
  boardCode: v.string(),
  subjectSlug: v.string(),
  tier: v.union(v.literal("none"), v.literal("foundation"), v.literal("higher")),
  year: v.number(),
  session: v.string(),
  paperCode: v.string(),
  paperName: v.string(),
  kind: v.union(v.literal("question_paper"), v.literal("mark_scheme"), v.literal("insert")),
  source: v.union(v.literal("pmt"), v.literal("revisionworld"), v.literal("manual")),
  relativePath: v.string(),
  fileName: v.string(),
  cdnUploadId: v.string(),
  cdnUrl: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
};

export const upsertPaperAsset = mutationGeneric({
  args: assetArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("paperAssets")
      .withIndex("by_relative_path", (q) => q.eq("relativePath", args.relativePath))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("paperAssets", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getPaperAssetByRelativePath = queryGeneric({
  args: { relativePath: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paperAssets")
      .withIndex("by_relative_path", (q) => q.eq("relativePath", args.relativePath))
      .unique();
  },
});

export const getPaperAssetsByBoardSubject = queryGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paperAssets")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .collect();
  },
});
