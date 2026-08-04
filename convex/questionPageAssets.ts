import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const pageAssetArgs = {
  sourceRelativePath: v.string(),
  assetId: v.string(),
  pageNumber: v.number(),
  relativePath: v.string(),
  fileName: v.string(),
  cdnUploadId: v.string(),
  cdnUrl: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
};

export const upsertQuestionPageAsset = mutationGeneric({
  args: pageAssetArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("questionPageAssets")
      .withIndex("by_relative_path", (q) => q.eq("relativePath", args.relativePath))
      .unique();

    if (existing) {
      await ctx.db.patch("questionPageAssets", existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("questionPageAssets", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteQuestionPageAssetsNotInBoardSubject = mutationGeneric({
  args: {
    keepBoardCode: v.string(),
    keepSubjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const allAssets = await ctx.db.query("questionPageAssets").collect();
    let deleted = 0;

    for (const asset of allAssets) {
      const papers = await ctx.db
        .query("taggedPapers")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", asset.sourceRelativePath))
        .collect();

      const shouldDelete = papers.length === 0 || papers.every(
        (p) => p.boardCode !== args.keepBoardCode || p.subjectSlug !== args.keepSubjectSlug
      );

      if (shouldDelete) {
        await ctx.db.delete("questionPageAssets", asset._id);
        deleted += 1;
      }
    }

    return { deleted };
  },
});

export const getQuestionPageAssetsBySourceRelativePath = queryGeneric({
  args: { sourceRelativePath: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("questionPageAssets")
      .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", args.sourceRelativePath))
      .collect();
  },
});

export const getQuestionPageAssetsBySourceRelativePaths = queryGeneric({
  args: { sourceRelativePaths: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePaths = Array.from(new Set(args.sourceRelativePaths));
    const rows = await Promise.all(uniquePaths.map(async (sourceRelativePath) => {
      const assets = await ctx.db
        .query("questionPageAssets")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", sourceRelativePath))
        .collect();
      return assets;
    }));

    return rows.flat();
  },
});
