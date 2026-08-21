import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

const artifactKind = v.union(v.literal("paper"), v.literal("mark-scheme"));
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function secretsMatch(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function requireServiceSecret(serviceSecret: string) {
  const expected = process.env.MCP_SERVICE_SECRET;
  if (!expected || !secretsMatch(serviceSecret, expected)) throw new Error("Unauthorized");
}

function assertExpiry(expiresAt: number) {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Artifact expiry must be in the future.");
  }
  if (expiresAt > Date.now() + 7 * 24 * 60 * 60 * 1000) {
    throw new Error("Artifact expiry is too far in the future.");
  }
}

export const createUploadUrl = mutation({
  args: { serviceSecret: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    serviceSecret: v.string(),
    bundleId: v.string(),
    kind: artifactKind,
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    assertExpiry(args.expiresAt);
    if (!args.fileName || args.fileName.length > 255 || args.fileName.includes("/") || args.fileName.includes("\\")) {
      throw new Error("Invalid artifact file name.");
    }
    if (args.contentType !== "application/pdf") throw new Error("Invalid artifact content type.");
    if (!Number.isInteger(args.fileSize) || args.fileSize <= 0 || args.fileSize > MAX_ARTIFACT_BYTES) {
      throw new Error("Invalid artifact file size.");
    }

    const existing = await ctx.db
      .query("mcpArtifacts")
      .withIndex("by_bundle_kind", (q) => q.eq("bundleId", args.bundleId).eq("kind", args.kind))
      .unique();
    if (existing) {
      if (existing.expiresAt <= Date.now()) {
        await ctx.storage.delete(existing.storageId);
        await ctx.db.delete(existing._id);
      } else {
        if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
        const existingUrl = await ctx.storage.getUrl(existing.storageId);
        if (!existingUrl) throw new Error("Registered artifact is no longer available.");
        return { ...existing, url: existingUrl };
      }
    }

    const createdAt = Date.now();
    const [url, artifactId] = await Promise.all([
      ctx.storage.getUrl(args.storageId),
      ctx.db.insert("mcpArtifacts", {
        bundleId: args.bundleId,
        kind: args.kind,
        storageId: args.storageId,
        fileName: args.fileName,
        contentType: args.contentType,
        fileSize: args.fileSize,
        createdAt,
        expiresAt: args.expiresAt,
      }),
    ]);
    if (!url) {
      await ctx.db.delete(artifactId);
      await ctx.storage.delete(args.storageId);
      throw new Error("Could not create an artifact download URL.");
    }
    return {
      _id: artifactId,
      bundleId: args.bundleId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      fileSize: args.fileSize,
      createdAt,
      expiresAt: args.expiresAt,
      url,
    };
  },
});

export const deleteStorage = mutation({
  args: {
    serviceSecret: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const metadata = await ctx.db
      .query("mcpArtifacts")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .collect();
    for (const artifact of metadata) await ctx.db.delete(artifact._id);
    await ctx.storage.delete(args.storageId);
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("mcpArtifacts")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const artifact of expired) {
      await ctx.storage.delete(artifact.storageId);
      await ctx.db.delete(artifact._id);
    }
    return { deletedCount: expired.length };
  },
});
