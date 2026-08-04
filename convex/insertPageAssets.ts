import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const pageAssetArgs = {
  sourceRelativePath: v.string(),
  pageNumber: v.number(),
  relativePath: v.string(),
  fileName: v.string(),
  cdnUploadId: v.string(),
  cdnUrl: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  ocrText: v.string(),
  detectedSupportLabels: v.array(v.string()),
  uploadedAt: v.number(),
};

export const upsertInsertPageAsset = mutationGeneric({
  args: pageAssetArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("insertPageAssets")
      .withIndex("by_relative_path", (q) => q.eq("relativePath", args.relativePath))
      .unique();

    if (existing) {
      await ctx.db.patch("insertPageAssets", existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("insertPageAssets", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getInsertPageAssetsBySourceRelativePaths = queryGeneric({
  args: { sourceRelativePaths: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePaths = Array.from(new Set(args.sourceRelativePaths));
    const rows = await Promise.all(uniquePaths.map(async (sourceRelativePath) => {
      const assets = await ctx.db
        .query("insertPageAssets")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", sourceRelativePath))
        .collect();
      return assets;
    }));

    return rows.flat();
  },
});
