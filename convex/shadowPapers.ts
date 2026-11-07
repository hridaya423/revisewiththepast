import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ShadowSaveError, planShadowSave } from "./model/shadowSave";
import { shadowSourceValidator } from "./model/shadowSource";
import { requireAuthenticatedUser } from "./model/auth";
import { requireServiceSecret, serviceSecretArg } from "./model/serviceAuth";
import {
  ACTIVE_SHADOW_STATUSES,
  SHADOW_JOB_LIMITS,
  decideCancel,
  decideClaim,
  decideFailure,
  decideProgress,
  decidePublish,
  decideRecovery,
  decideStart,
  publicJobView,
  startPayloadKey,
} from "./model/shadowJobs";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const MAX_SNAPSHOT_CHARS = 200_000;

const artifactKind = v.union(v.literal("paper"), v.literal("mark-scheme"));
const workerStage = v.union(v.literal("generating"), v.literal("validating"), v.literal("rendering"));
const artifactInput = v.object({ storageId: v.id("_storage"), sha256: v.string(), fileSize: v.number(), pageCount: v.number() });

const SOURCE_PAPER_ID = /^[a-z0-9]+(?:-[a-z0-9]+){3,12}$/u;
const MANIFEST_REVISION = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/u;

function randomHex(bytes: number) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function ownedJob(ctx: QueryCtx | MutationCtx, jobId: Id<"shadowGenerationJobs">) {
  const user = await requireAuthenticatedUser(ctx);
  const job = await ctx.db.get("shadowGenerationJobs", jobId);
  if (!job || job.ownerId !== String(user._id)) return null;
  return job;
}

async function ownedVariant(ctx: QueryCtx | MutationCtx, variantId: Id<"shadowPaperVariants">) {
  const user = await requireAuthenticatedUser(ctx);
  const variant = await ctx.db.get("shadowPaperVariants", variantId);
  if (!variant || variant.ownerId !== String(user._id)) return null;
  if (variant.expiresAt !== undefined && variant.expiresAt <= Date.now()) return null;
  return variant;
}

function variantSummary(variant: Doc<"shadowPaperVariants">) {
  return {
    variantId: variant._id,
    displayCode: variant.displayCode,
    title: variant.title,
    sourcePaperId: variant.sourcePaperId,
    manifestRevision: variant.manifestRevision,
    totalMarks: variant.totalMarks,
    durationMinutes: variant.durationMinutes,
    questionCount: variant.questionCount,
    paperPages: variant.paper.pageCount,
    markSchemePages: variant.markScheme.pageCount,
    createdAt: variant.createdAt,
    expiresAt: variant.expiresAt ?? null,
    savedPaperId: variant.savedPaperId ?? null,
  };
}

async function jobView(ctx: QueryCtx | MutationCtx, job: Doc<"shadowGenerationJobs">) {
  const view = publicJobView(job);
  if (job.status !== "ready" || !job.variantId) return { ...view, variant: null };
  const variant = await ctx.db.get("shadowPaperVariants", job.variantId);
  const expired = !variant || (variant.expiresAt !== undefined && variant.expiresAt <= Date.now());
  return { ...view, variant: expired ? null : variantSummary(variant), expired };
}

async function deleteStorage(ctx: MutationCtx, storageIds: Array<Id<"_storage">>) {
  for (const storageId of new Set(storageIds)) {
    try {
      await ctx.storage.delete(storageId);
    } catch {
    }
  }
}

/** Requires the service secret too, so a client cannot bypass the server rate limit by calling Convex directly. */
export const startJob = mutation({
  args: {
    ...serviceSecretArg,
    sourcePaperId: v.string(),
    manifestRevision: v.string(),
    idempotencyKey: v.string(),
    totalUnits: v.number(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const user = await requireAuthenticatedUser(ctx);
    if (!SOURCE_PAPER_ID.test(args.sourcePaperId) || !MANIFEST_REVISION.test(args.manifestRevision) || !IDEMPOTENCY_KEY.test(args.idempotencyKey)) {
      throw new Error("INVALID_REQUEST");
    }
    if (!Number.isInteger(args.totalUnits) || args.totalUnits < 1 || args.totalUnits > 40) throw new Error("INVALID_REQUEST");
    const ownerId = String(user._id);
    const payloadKey = startPayloadKey(args);
    const existing = await ctx.db
      .query("shadowGenerationJobs")
      .withIndex("by_owner_idempotency", (q) => q.eq("ownerId", ownerId).eq("idempotencyKey", args.idempotencyKey))
      .unique();
    let activeJobs = 0;
    for (const status of ACTIVE_SHADOW_STATUSES) {
      const rows = await ctx.db.query("shadowGenerationJobs").withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", status)).take(SHADOW_JOB_LIMITS.activeJobsPerOwner + 1);
      activeJobs += rows.length;
    }
    const decision = decideStart({ existing, payloadKey, activeJobs });
    if (decision.kind === "existing") return { created: false, job: await jobView(ctx, existing!) };
    if (decision.kind !== "create") throw new Error(decision.code);

    const now = Date.now();
    const jobId = await ctx.db.insert("shadowGenerationJobs", {
      ownerId,
      idempotencyKey: args.idempotencyKey,
      payloadKey,
      sourcePaperId: args.sourcePaperId,
      manifestRevision: args.manifestRevision,
      paperSeed: randomHex(32),
      status: "queued",
      attempt: 0,
      cancelRequested: false,
      progress: { completedUnits: 0, totalUnits: args.totalUnits },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.shadowPaperScheduler.dispatch, { jobId, dispatchAttempt: 1 });
    const job = (await ctx.db.get("shadowGenerationJobs", jobId))!;
    return { created: true, job: await jobView(ctx, job) };
  },
});

export const getJob = query({
  args: { jobId: v.id("shadowGenerationJobs") },
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.jobId);
    return job ? await jobView(ctx, job) : null;
  },
});

export const getActiveJob = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    for (const status of ACTIVE_SHADOW_STATUSES) {
      const job = await ctx.db.query("shadowGenerationJobs").withIndex("by_owner_status", (q) => q.eq("ownerId", String(user._id)).eq("status", status)).first();
      if (job) return await jobView(ctx, job);
    }
    return null;
  },
});

export const cancelJob = mutation({
  args: { jobId: v.id("shadowGenerationJobs") },
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.jobId);
    if (!job) return null;
    const decision = decideCancel(job, Date.now());
    if (decision.kind !== "unchanged") await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
    return await jobView(ctx, (await ctx.db.get("shadowGenerationJobs", job._id))!);
  },
});

export const getVariant = query({
  args: { variantId: v.id("shadowPaperVariants") },
  handler: async (ctx, args) => {
    const variant = await ownedVariant(ctx, args.variantId);
    return variant ? variantSummary(variant) : null;
  },
});

export const getVariantArtifact = query({
  args: { variantId: v.id("shadowPaperVariants"), kind: artifactKind },
  handler: async (ctx, args) => {
    const variant = await ownedVariant(ctx, args.variantId);
    if (!variant) return null;
    const artifact = args.kind === "paper" ? variant.paper : variant.markScheme;
    const url = await ctx.storage.getUrl(artifact.storageId);
    if (!url) return null;
    const suffix = args.kind === "paper" ? "paper" : "mark-scheme";
    return {
      url,
      fileName: `shadow-${variant.sourcePaperId}-${variant.displayCode}-${suffix}.pdf`,
      sha256: artifact.sha256,
      fileSize: artifact.fileSize,
      displayCode: variant.displayCode,
    };
  },
});

/**
 * Saves a variant from its stored snapshots. Repeating the call returns the same
 * saved paper; nothing the client sends can change the questions or answers.
 */
export const saveVariant = mutation({
  args: { variantId: v.id("shadowPaperVariants") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const ownerId = String(user._id);
    const variant = await ctx.db.get("shadowPaperVariants", args.variantId);
    if (variant && variant.ownerId === ownerId && variant.savedPaperId) {
      const existing = await ctx.db.get("savedPapers", variant.savedPaperId);
      if (existing && existing.ownerId === ownerId) return { savedPaperId: existing._id, created: false };
    }
    const questions = variant
      ? await ctx.db.query("shadowQuestionVariants").withIndex("by_paper_variant_order", (q) => q.eq("paperVariantId", variant._id)).collect()
      : [];
    let plan: ReturnType<typeof planShadowSave>;
    try {
      plan = planShadowSave({ variant, questions, ownerId, now: Date.now() });
    } catch (error) {
      if (error instanceof ShadowSaveError) throw new Error(error.code);
      throw error;
    }
    const savedPaperId = await ctx.db.insert("savedPapers", { ...plan.savedPaper, shadowVariantId: variant!._id });
    for (const question of plan.questions) {
      await ctx.db.insert("savedPaperQuestions", {
        ...question,
        savedPaperId,
        shadowQuestionVariantId: question.shadowQuestionVariantId as Id<"shadowQuestionVariants">,
      });
    }
    const receipt = await ctx.db
      .query("generationReceipts")
      .withIndex("by_shadow_variant_owner", (q) => q.eq("shadowVariantId", variant!._id).eq("ownerId", ownerId))
      .first();
    if (!receipt) await ctx.db.insert("generationReceipts", { ...plan.receipt, shadowVariantId: variant!._id });
    await ctx.db.patch("shadowPaperVariants", variant!._id, { savedPaperId, expiresAt: undefined });
    return { savedPaperId, created: true };
  },
});

export const claimJob = mutation({
  args: { ...serviceSecretArg, jobId: v.id("shadowGenerationJobs"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    if (!LEASE_TOKEN.test(args.leaseToken)) throw new Error("INVALID_REQUEST");
    const job = await ctx.db.get("shadowGenerationJobs", args.jobId);
    if (!job) return { kind: "missing" as const };
    const decision = decideClaim(job, { now: Date.now(), leaseToken: args.leaseToken });
    if (decision.kind === "terminal" || decision.kind === "busy") return { kind: decision.kind };
    await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
    if (decision.kind !== "claim") return { kind: decision.kind };
    return {
      kind: "claimed" as const,
      job: {
        jobId: job._id,
        ownerId: job.ownerId,
        sourcePaperId: job.sourcePaperId,
        manifestRevision: job.manifestRevision,
        paperSeed: job.paperSeed,
        attempt: job.attempt + 1,
        createdAt: job.createdAt,
      },
    };
  },
});

export const reportProgress = mutation({
  args: { ...serviceSecretArg, jobId: v.id("shadowGenerationJobs"), leaseToken: v.string(), stage: workerStage, completedUnits: v.number() },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const job = await ctx.db.get("shadowGenerationJobs", args.jobId);
    if (!job) return { kind: "lost" as const };
    const decision = decideProgress(job, { now: Date.now(), leaseToken: args.leaseToken, stage: args.stage, completedUnits: args.completedUnits });
    if (decision.kind !== "lost") await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
    return { kind: decision.kind };
  },
});

export const createArtifactUploadUrl = mutation({
  args: { ...serviceSecretArg },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const publishVariant = mutation({
  args: {
    ...serviceSecretArg,
    jobId: v.id("shadowGenerationJobs"),
    leaseToken: v.string(),
    variant: v.object({
      manifestId: v.string(),
      semanticHash: v.string(),
      displayCode: v.string(),
      title: v.string(),
      source: shadowSourceValidator,
      totalMarks: v.number(),
      durationMinutes: v.number(),
      calculator: v.union(v.literal("allowed"), v.literal("not-allowed")),
      rendererVersion: v.string(),
      validation: v.object({ checks: v.number(), failed: v.number() }),
      paper: artifactInput,
      markScheme: artifactInput,
    }),
    questions: v.array(v.object({
      displayOrder: v.number(),
      sourceUnitKey: v.string(),
      templateRevision: v.string(),
      unitSeed: v.string(),
      marks: v.number(),
      partMarks: v.array(v.object({ partId: v.string(), marks: v.number() })),
      promptText: v.string(),
      parametersJson: v.string(),
      questionJson: v.string(),
      solutionJson: v.string(),
      validationJson: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    const uploads = [args.variant.paper.storageId, args.variant.markScheme.storageId];
    const job = await ctx.db.get("shadowGenerationJobs", args.jobId);
    if (!job) {
      await deleteStorage(ctx, uploads);
      return { kind: "lost" as const };
    }
    const now = Date.now();
    const decision = decidePublish(job, { now, leaseToken: args.leaseToken });
    if (decision.kind !== "publish") {
      await deleteStorage(ctx, uploads);
      if (decision.kind === "cancel") await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
      return { kind: decision.kind };
    }

    const { variant, questions } = args;
    if (!SHA256.test(variant.semanticHash) || !SHA256.test(variant.paper.sha256) || !SHA256.test(variant.markScheme.sha256)) throw new Error("INVALID_REQUEST");
    if (!/^SH-[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(variant.displayCode)) throw new Error("INVALID_REQUEST");
    for (const artifact of [variant.paper, variant.markScheme]) {
      if (!Number.isInteger(artifact.fileSize) || artifact.fileSize <= 0 || artifact.fileSize > MAX_ARTIFACT_BYTES) throw new Error("INVALID_REQUEST");
      const metadata = await ctx.db.system.get("_storage", artifact.storageId);
      if (!metadata || metadata.size !== artifact.fileSize) throw new Error("ARTIFACT_MISMATCH");
    }
    if (questions.length !== job.progress.totalUnits) throw new Error("INVALID_REQUEST");
    if (questions.reduce((sum, question) => sum + question.marks, 0) !== variant.totalMarks) throw new Error("INVALID_REQUEST");
    for (const question of questions) {
      if (question.questionJson.length + question.solutionJson.length + question.validationJson.length + question.parametersJson.length > MAX_SNAPSHOT_CHARS) {
        throw new Error("SNAPSHOT_TOO_LARGE");
      }
    }

    const variantId = await ctx.db.insert("shadowPaperVariants", {
      ...variant,
      ownerId: job.ownerId,
      jobId: job._id,
      sourcePaperId: job.sourcePaperId,
      manifestRevision: job.manifestRevision,
      questionCount: questions.length,
      createdAt: now,
      expiresAt: now + SHADOW_JOB_LIMITS.variantRetentionMs,
    });
    for (const question of [...questions].sort((left, right) => left.displayOrder - right.displayOrder)) {
      await ctx.db.insert("shadowQuestionVariants", { ...question, paperVariantId: variantId });
    }
    await ctx.db.patch("shadowGenerationJobs", job._id, { ...decision.patch, variantId });
    return { kind: "published" as const, variantId };
  },
});

export const failJob = mutation({
  args: {
    ...serviceSecretArg,
    jobId: v.id("shadowGenerationJobs"),
    leaseToken: v.string(),
    errorCode: v.string(),
    retryable: v.boolean(),
    orphanStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    if (!/^[A-Z_]{3,40}$/u.test(args.errorCode)) throw new Error("INVALID_REQUEST");
    await deleteStorage(ctx, args.orphanStorageIds ?? []);
    const job = await ctx.db.get("shadowGenerationJobs", args.jobId);
    if (!job) return { kind: "lost" as const };
    const decision = decideFailure(job, { now: Date.now(), leaseToken: args.leaseToken, errorCode: args.errorCode, retryable: args.retryable });
    if (decision.kind === "lost") return { kind: "lost" as const };
    await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
    if (decision.kind === "retry") {
      await ctx.scheduler.runAfter(decision.delayMs, internal.shadowPaperScheduler.dispatch, { jobId: job._id, dispatchAttempt: 1 });
    }
    return { kind: decision.kind };
  },
});

export const markDispatchFailed = internalMutation({
  args: { jobId: v.id("shadowGenerationJobs"), errorCode: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get("shadowGenerationJobs", args.jobId);
    if (!job || job.status !== "queued" || (job.leaseToken && (job.leaseExpiresAt ?? 0) > Date.now())) return;
    await ctx.db.patch("shadowGenerationJobs", job._id, {
      status: job.cancelRequested ? "cancelled" : "failed",
      errorCode: job.cancelRequested ? undefined : args.errorCode,
      updatedAt: Date.now(),
    });
  },
});

export const recoverStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let recovered = 0;
    for (const status of ACTIVE_SHADOW_STATUSES) {
      const stale = await ctx.db
        .query("shadowGenerationJobs")
        .withIndex("by_status_updated", (q) => q.eq("status", status).lt("updatedAt", now - SHADOW_JOB_LIMITS.staleAfterMs))
        .take(50);
      for (const job of stale) {
        const decision = decideRecovery(job, now);
        if (decision.kind === "none") continue;
        await ctx.db.patch("shadowGenerationJobs", job._id, decision.patch);
        if (decision.kind === "redispatch") await ctx.scheduler.runAfter(0, internal.shadowPaperScheduler.dispatch, { jobId: job._id, dispatchAttempt: 1 });
        recovered += 1;
      }
    }
    return { recovered };
  },
});

export const cleanupExpiredVariants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("shadowPaperVariants")
      .withIndex("by_expires_at", (q) => q.gt("expiresAt", 0).lt("expiresAt", now))
      .take(25);
    for (const variant of expired) {
      if (variant.savedPaperId) {
        await ctx.db.patch("shadowPaperVariants", variant._id, { expiresAt: undefined });
        continue;
      }
      const questions = await ctx.db.query("shadowQuestionVariants").withIndex("by_paper_variant_order", (q) => q.eq("paperVariantId", variant._id)).collect();
      for (const question of questions) await ctx.db.delete("shadowQuestionVariants", question._id);
      await deleteStorage(ctx, [variant.paper.storageId, variant.markScheme.storageId]);
      await ctx.db.delete("shadowPaperVariants", variant._id);
    }
    return { deleted: expired.length };
  },
});
