import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuthenticatedUser } from "./model/auth";
import { requireServiceSecret, serviceSecretArg } from "./model/serviceAuth";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

export const findByHash = query({
  args: { ...serviceSecretArg, sha256: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const user = await requireAuthenticatedUser(ctx);
    return ctx.db.query("markingFiles").withIndex("by_owner_hash", (q) => q.eq("ownerId", String(user._id)).eq("sha256", args.sha256)).unique();
  },
});

export const createUploadUrl = mutation({
  args: serviceSecretArg,
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    await requireAuthenticatedUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const record = mutation({
  args: {
    ...serviceSecretArg,
    storageId: v.id("_storage"),
    sha256: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const user = await requireAuthenticatedUser(ctx);
    if (!/^[a-f0-9]{64}$/.test(args.sha256) || !allowedTypes.has(args.contentType) || args.size <= 0 || args.size > 40 * 1024 * 1024) {
      throw new Error("Invalid marking file.");
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata || metadata.size !== args.size || metadata.contentType !== args.contentType) throw new Error("Invalid uploaded file.");
    const ownerId = String(user._id);
    const existing = await ctx.db.query("markingFiles").withIndex("by_owner_hash", (q) => q.eq("ownerId", ownerId).eq("sha256", args.sha256)).unique();
    if (existing) {
      // A concurrent request may have stored these same bytes first.
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return existing;
    }
    const { serviceSecret: _secret, ...file } = args;
    void _secret;
    const id = await ctx.db.insert("markingFiles", { ...file, ownerId, createdAt: Date.now() });
    return (await ctx.db.get("markingFiles", id))!;
  },
});

export const source = query({
  args: { ...serviceSecretArg, fileId: v.id("markingFiles") },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const user = await requireAuthenticatedUser(ctx);
    const file = await ctx.db.get("markingFiles", args.fileId);
    if (!file || file.ownerId !== String(user._id)) return null;
    const url = await ctx.storage.getUrl(file.storageId);
    return url ? { url, fileName: file.fileName, contentType: file.contentType } : null;
  },
});
