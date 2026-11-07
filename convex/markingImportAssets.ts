import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import { requireAuthenticatedUser } from "./model/auth";

const keyFields = {
  importKey: v.string(),
  pageNumber: v.number(),
};

export const get = query({
  args: keyFields,
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    return await ctx.db
      .query("markingImportAssets")
      .withIndex("by_owner_import_page", (q) => q
        .eq("ownerId", String(user._id))
        .eq("importKey", args.importKey)
        .eq("pageNumber", args.pageNumber))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    ...keyFields,
    fileName: v.string(),
    fileSize: v.number(),
    cdnUploadId: v.optional(v.string()),
    fileId: v.optional(v.id("markingFiles")),
    sourceImageUrl: v.string(),
    ocrText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const ownerId = String(user._id);
    if (args.fileId) {
      const file = await ctx.db.get("markingFiles", args.fileId);
      if (!file || file.ownerId !== ownerId) throw new Error("Unauthorized");
      args.sourceImageUrl = `/api/marking/files/${args.fileId}`;
    }
    const existing = await ctx.db
      .query("markingImportAssets")
      .withIndex("by_owner_import_page", (q) => q
        .eq("ownerId", ownerId)
        .eq("importKey", args.importKey)
        .eq("pageNumber", args.pageNumber))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("markingImportAssets", existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("markingImportAssets", {
      ownerId,
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
