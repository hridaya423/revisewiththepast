import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAuthenticatedUser } from "./model/auth";
import { requireServiceSecret, serviceSecretArg } from "./model/serviceAuth";
import { reserveQuota } from "./mcpRateLimits";
import { generatePaperRequestSchema } from "../features/papers/builder/contracts/generate-paper";
import { hasGenerationAccess, isGenerationTerminal, mayUpdateGeneration, type GenerationJobSnapshot } from "../features/papers/builder/domain/generation-job";

const accessArgs = { ...serviceSecretArg, jobId: v.string(), guestHash: v.string() };
const workerArgs = { ...serviceSecretArg, jobId: v.string(), workerId: v.string() };
const artifact = v.object({ part: v.string(), storageId: v.id("_storage"), fileName: v.string(), contentType: v.optional(v.union(v.literal("application/pdf"), v.literal("image/png"))) });
const LEASE_MS = 90_000;
const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000;

async function findJob(ctx: QueryCtx | MutationCtx, jobId: string) {
  return await ctx.db.query("generationJobs").withIndex("by_job_id", (q) => q.eq("jobId", jobId)).unique();
}

async function owner(ctx: QueryCtx | MutationCtx) {
  if (!await ctx.auth.getUserIdentity()) return undefined;
  return String((await requireAuthenticatedUser(ctx))._id);
}

async function workerAvailable(ctx: QueryCtx | MutationCtx) {
  const latest = await ctx.db.query("generationWorkers").withIndex("by_seen_at").order("desc").first();
  return Boolean(latest && latest.seenAt > Date.now() - LEASE_MS);
}

async function recordWorker(ctx: MutationCtx, workerId: string) {
  const existing = await ctx.db.query("generationWorkers").withIndex("by_worker_id", (q) => q.eq("workerId", workerId)).unique();
  if (existing) await ctx.db.patch(existing._id, { seenAt: Date.now() });
  else await ctx.db.insert("generationWorkers", { workerId, seenAt: Date.now() });
}

async function permitted(ctx: QueryCtx | MutationCtx, job: Doc<"generationJobs"> | null, guestHash: string) {
  return job && job.expiresAt > Date.now() && hasGenerationAccess(job, { guestHash, ownerId: job.ownerId ? await owner(ctx) : undefined });
}

function snapshot(job: Doc<"generationJobs">): GenerationJobSnapshot {
  return JSON.parse(job.snapshotJson);
}

async function update(ctx: MutationCtx, job: Doc<"generationJobs">, patch: Partial<GenerationJobSnapshot>) {
  const next = { ...snapshot(job), ...patch, updatedAt: Date.now() };
  await ctx.db.patch(job._id, { status: next.status, snapshotJson: JSON.stringify(next), updatedAt: next.updatedAt });
  return next;
}

export const create = mutation({
  args: {
    ...serviceSecretArg,
    jobId: v.string(),
    requestKey: v.string(),
    guestHash: v.string(),
    callerKey: v.string(),
    requestJson: v.string(),
    paperCount: v.number(),
    includeMarkScheme: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    if (!/^[a-f0-9]{64}$/.test(args.guestHash) || args.requestKey.length > 100) throw new Error("Invalid generation access.");
    const existing = await ctx.db.query("generationJobs").withIndex("by_guest_request", (q) => q.eq("guestHash", args.guestHash).eq("requestKey", args.requestKey)).unique();
    if (existing) {
      if (!await permitted(ctx, existing, args.guestHash)) return { unavailable: true };
      return { job: snapshot(existing) };
    }
    if (!await workerAvailable(ctx)) return { workerUnavailable: true };
    const request = generatePaperRequestSchema.parse(JSON.parse(args.requestJson));
    const quota = await reserveQuota(ctx, { serviceSecret: args.serviceSecret, callerKey: args.callerKey, scope: "paper" });
    if (!quota.allowed) return { retryAt: quota.retryAt };
    const now = Date.now();
    const job: GenerationJobSnapshot = {
      jobId: args.jobId, subjectKey: request.subjectKey, subjectTier: request.subjectTier,
      status: "queued", message: "Waiting to prepare your paper", progress: 0,
      totalPapers: Math.max(1, Math.min(3, Math.round(args.paperCount))), completedPapers: 0,
      includeMarkScheme: args.includeMarkScheme, papers: [], resultFileName: null, error: null,
      createdAt: now, updatedAt: now, expiresAt: now + JOB_LIFETIME_MS, runVersion: 0,
    };
    await ctx.db.insert("generationJobs", {
      jobId: job.jobId, requestKey: args.requestKey, guestHash: args.guestHash, ownerId: await owner(ctx),
      requestJson: JSON.stringify(request), snapshotJson: JSON.stringify(job), status: job.status,
      leaseExpiresAt: 0, attempts: 0, cancelRequested: false, artifacts: [],
      createdAt: now, updatedAt: now, expiresAt: job.expiresAt,
    });
    return { job };
  },
});

export const read = query({
  args: accessArgs,
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    return await permitted(ctx, job, args.guestHash) && job ? snapshot(job) : null;
  },
});

export const cancel = mutation({
  args: { ...accessArgs, runVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!await permitted(ctx, job, args.guestHash) || !job) return null;
    if ((args.runVersion ?? 0) !== (snapshot(job).runVersion ?? 0)) return snapshot(job);
    if (isGenerationTerminal(snapshot(job).status)) return snapshot(job);
    await ctx.db.patch(job._id, { cancelRequested: true });
    return await update(ctx, job, job.status === "queued"
      ? { status: "cancelled", message: "Preparation stopped." }
      : { message: "Stopping after the current step" });
  },
});

export const retryScheme = mutation({
  args: { ...accessArgs, paperIndex: v.number(), callerKey: v.string(), requestKey: v.string(), runVersion: v.number() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!await permitted(ctx, job, args.guestHash) || !job) return { unavailable: true };
    const current = snapshot(job);
    if (current.lastRetryRequestKey === args.requestKey || (current.runVersion ?? 0) !== args.runVersion) return { job: current };
    const paper = current.papers.find((entry) => entry.index === args.paperIndex);
    if (!isGenerationTerminal(current.status) || !paper?.markSchemeWarning || current.completedPapers !== current.totalPapers) return { job: current };
    if (!await workerAvailable(ctx)) return { workerUnavailable: true };
    const quota = await reserveQuota(ctx, { serviceSecret: args.serviceSecret, callerKey: args.callerKey, scope: "mark-scheme" });
    if (!quota.allowed) return { retryAt: quota.retryAt };
    await ctx.db.patch(job._id, { leaseExpiresAt: 0, workerId: undefined, attempts: 0, cancelRequested: false });
    return { job: await update(ctx, job, {
      status: "queued", message: "Waiting to retry your mark scheme", error: null, progress: 0.5,
      runVersion: (current.runVersion ?? 0) + 1, lastRetryRequestKey: args.requestKey,
      papers: current.papers.map((entry) => entry.index === args.paperIndex ? { ...entry, markSchemeWarning: null } : entry),
    }) };
  },
});

export const claim = mutation({
  args: accessArgs,
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!await permitted(ctx, job, args.guestHash) || !job) return null;
    const ownerId = await owner(ctx);
    if (!ownerId || (job.ownerId && job.ownerId !== ownerId)) return null;
    await ctx.db.patch(job._id, { ownerId });
    return snapshot(job);
  },
});

export const download = query({
  args: { ...accessArgs, part: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!await permitted(ctx, job, args.guestHash) || !job) return null;
    const file = job.artifacts.find((entry) => entry.part === args.part);
    if (!file) return null;
    const url = await ctx.storage.getUrl(file.storageId);
    return url ? { url, fileName: file.fileName, contentType: file.contentType ?? "application/pdf" } : null;
  },
});

export const claimNext = mutation({
  args: { ...serviceSecretArg, workerId: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    await recordWorker(ctx, args.workerId);
    const now = Date.now();
    const candidates = await Promise.all(["queued", "generating", "mark-schemes", "assembling"].map((status) =>
      ctx.db.query("generationJobs").withIndex("by_status_lease", (q) => q.eq("status", status).lt("leaseExpiresAt", now)).first(),
    ));
    const job = candidates.filter((entry): entry is Doc<"generationJobs"> => entry !== null).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!job) return null;
    if (job.cancelRequested || job.expiresAt <= now || job.attempts >= 3) {
      await update(ctx, job, job.cancelRequested
        ? { status: "cancelled", message: "Preparation stopped." }
        : { status: "failed", message: "Preparation could not finish.", error: "Please create another paper from your saved settings." });
      return null;
    }
    await ctx.db.patch(job._id, { workerId: args.workerId, leaseExpiresAt: now + LEASE_MS, attempts: job.attempts + 1 });
    const state = await update(ctx, job, { status: "generating", message: "Preparing your paper" });
    return { snapshot: state, requestJson: job.requestJson, artifacts: job.artifacts };
  },
});

export const heartbeat = mutation({
  args: workerArgs,
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!job || !mayUpdateGeneration({ ...job, status: snapshot(job).status }, args.workerId, Date.now())) return { active: false, cancelled: true };
    await recordWorker(ctx, args.workerId);
    await ctx.db.patch(job._id, { leaseExpiresAt: Date.now() + LEASE_MS });
    return { active: true, cancelled: job.cancelRequested };
  },
});

export const createUploadUrl = mutation({
  args: workerArgs,
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!job || !mayUpdateGeneration({ ...job, status: snapshot(job).status }, args.workerId, Date.now())) throw new Error("Generation lease expired.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const checkpoint = mutation({
  args: { ...workerArgs, snapshotJson: v.string(), artifact: v.optional(artifact) },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!job || !mayUpdateGeneration({ ...job, status: snapshot(job).status }, args.workerId, Date.now())) {
      if (args.artifact) await ctx.storage.delete(args.artifact.storageId);
      return false;
    }
    const next: GenerationJobSnapshot = JSON.parse(args.snapshotJson);
    if (next.jobId !== job.jobId || next.totalPapers !== snapshot(job).totalPapers) throw new Error("Invalid generation checkpoint.");
    if (args.artifact) {
      const meta = await ctx.db.system.get(args.artifact.storageId);
      if (!meta || meta.contentType !== "application/pdf" || meta.size > 80 * 1024 * 1024) throw new Error("Invalid generation artifact.");
      const artifacts = job.artifacts.filter((entry) => entry.part !== args.artifact!.part);
      const previous = job.artifacts.find((entry) => entry.part === args.artifact!.part);
      if (previous && previous.storageId !== args.artifact.storageId) await ctx.storage.delete(previous.storageId);
      artifacts.push(args.artifact);
      await ctx.db.patch(job._id, { artifacts });
    }
    await update(ctx, job, next);
    return true;
  },
});

export const workerDownload = query({
  args: { ...workerArgs, part: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await findJob(ctx, args.jobId);
    if (!job || !mayUpdateGeneration({ ...job, status: snapshot(job).status }, args.workerId, Date.now())) return null;
    const file = job.artifacts.find((entry) => entry.part === args.part);
    return file ? await ctx.storage.getUrl(file.storageId) : null;
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("generationJobs").withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now())).take(100);
    for (const job of expired) {
      if (job.leaseExpiresAt > Date.now()) continue;
      for (const file of job.artifacts) await ctx.storage.delete(file.storageId);
      await ctx.db.delete(job._id);
    }
  },
});
