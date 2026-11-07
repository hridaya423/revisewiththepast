export const SHADOW_JOB_STATUSES = ["queued", "generating", "validating", "rendering", "ready", "failed", "cancelled"] as const;
export type ShadowJobStatus = (typeof SHADOW_JOB_STATUSES)[number];
export const ACTIVE_SHADOW_STATUSES: readonly ShadowJobStatus[] = ["queued", "generating", "validating", "rendering"];
export const WORKER_STAGES = ["generating", "validating", "rendering"] as const;
export type ShadowWorkerStage = (typeof WORKER_STAGES)[number];

export const SHADOW_JOB_LIMITS = {
  maxAttempts: 3,
  leaseMs: 3 * 60 * 1000,
  activeJobsPerOwner: 1,
  /** Unsaved variants and their PDFs are deleted after this long. */
  variantRetentionMs: 7 * 24 * 60 * 60 * 1000,
  /** A queued or leased job with no progress for this long is recovered by the cron. */
  staleAfterMs: 10 * 60 * 1000,
  retryDelaysMs: [5_000, 30_000, 120_000],
} as const;

export type ShadowJobRecord = {
  ownerId: string;
  idempotencyKey: string;
  payloadKey: string;
  status: ShadowJobStatus;
  attempt: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  cancelRequested: boolean;
  progress: { completedUnits: number; totalUnits: number };
  errorCode?: string;
  variantId?: string;
  createdAt: number;
  updatedAt: number;
};

/** Patches never set `variantId`; publication attaches the typed ID itself. */
export type JobPatch = Omit<Partial<ShadowJobRecord>, "variantId">;

export const isActive = (status: ShadowJobStatus) => ACTIVE_SHADOW_STATUSES.includes(status);
export const isTerminal = (status: ShadowJobStatus) => !isActive(status);

export type StartDecision =
  | { kind: "existing" }
  | { kind: "conflict"; code: "IDEMPOTENCY_CONFLICT" }
  | { kind: "limited"; code: "ACTIVE_JOB_LIMIT" }
  | { kind: "create" };

export function decideStart(input: { existing: Pick<ShadowJobRecord, "payloadKey"> | null; payloadKey: string; activeJobs: number }): StartDecision {
  if (input.existing) {
    return input.existing.payloadKey === input.payloadKey ? { kind: "existing" } : { kind: "conflict", code: "IDEMPOTENCY_CONFLICT" };
  }
  if (input.activeJobs >= SHADOW_JOB_LIMITS.activeJobsPerOwner) return { kind: "limited", code: "ACTIVE_JOB_LIMIT" };
  return { kind: "create" };
}

export type ClaimDecision =
  | { kind: "terminal" }
  | { kind: "cancel"; patch: JobPatch }
  | { kind: "busy" }
  | { kind: "exhausted"; patch: JobPatch }
  | { kind: "claim"; patch: JobPatch };

export function decideClaim(job: ShadowJobRecord, input: { now: number; leaseToken: string }): ClaimDecision {
  if (isTerminal(job.status)) return { kind: "terminal" };
  if (job.cancelRequested) return { kind: "cancel", patch: cancelledPatch(input.now) };
  if (job.leaseToken && job.leaseToken !== input.leaseToken && (job.leaseExpiresAt ?? 0) > input.now) return { kind: "busy" };
  if (job.attempt >= SHADOW_JOB_LIMITS.maxAttempts) {
    return { kind: "exhausted", patch: { status: "failed", errorCode: "WORKER_RETRIES_EXHAUSTED", leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: input.now } };
  }
  return {
    kind: "claim",
    patch: {
      status: "generating",
      attempt: job.attempt + 1,
      leaseToken: input.leaseToken,
      leaseExpiresAt: input.now + SHADOW_JOB_LIMITS.leaseMs,
      progress: { completedUnits: 0, totalUnits: job.progress.totalUnits },
      errorCode: undefined,
      updatedAt: input.now,
    },
  };
}

export function holdsLease(job: ShadowJobRecord, leaseToken: string, now: number) {
  return isActive(job.status) && job.status !== "queued" && job.leaseToken === leaseToken && (job.leaseExpiresAt ?? 0) > now;
}

export type ProgressDecision =
  | { kind: "lost" }
  | { kind: "cancel"; patch: JobPatch }
  | { kind: "progress"; patch: JobPatch };

export function decideProgress(job: ShadowJobRecord, input: { now: number; leaseToken: string; stage: ShadowWorkerStage; completedUnits: number }): ProgressDecision {
  if (!holdsLease(job, input.leaseToken, input.now)) return { kind: "lost" };
  if (job.cancelRequested) return { kind: "cancel", patch: cancelledPatch(input.now) };
  const stage = WORKER_STAGES[Math.max(WORKER_STAGES.indexOf(input.stage), WORKER_STAGES.indexOf(job.status as ShadowWorkerStage))]!;
  const completedUnits = Math.max(0, Math.min(job.progress.totalUnits, Math.floor(input.completedUnits)));
  return {
    kind: "progress",
    patch: {
      status: stage,
      progress: { completedUnits, totalUnits: job.progress.totalUnits },
      leaseExpiresAt: input.now + SHADOW_JOB_LIMITS.leaseMs,
      updatedAt: input.now,
    },
  };
}

export type PublishDecision =
  | { kind: "lost" }
  | { kind: "cancel"; patch: JobPatch }
  | { kind: "publish"; patch: JobPatch };

/** Publication is the only way to reach `ready`, and only the current lease holder can do it. */
export function decidePublish(job: ShadowJobRecord, input: { now: number; leaseToken: string }): PublishDecision {
  if (!holdsLease(job, input.leaseToken, input.now)) return { kind: "lost" };
  if (job.cancelRequested) return { kind: "cancel", patch: cancelledPatch(input.now) };
  return {
    kind: "publish",
    patch: {
      status: "ready",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      progress: { completedUnits: job.progress.totalUnits, totalUnits: job.progress.totalUnits },
      updatedAt: input.now,
    },
  };
}

export type CancelDecision =
  | { kind: "unchanged" }
  | { kind: "cancel"; patch: JobPatch }
  | { kind: "request"; patch: JobPatch };

/** A queued job cancels immediately; a running one records intent for the worker to observe. */
export function decideCancel(job: ShadowJobRecord, now: number): CancelDecision {
  if (isTerminal(job.status)) return { kind: "unchanged" };
  if (job.status === "queued" && !(job.leaseToken && (job.leaseExpiresAt ?? 0) > now)) return { kind: "cancel", patch: cancelledPatch(now) };
  if (job.cancelRequested) return { kind: "unchanged" };
  return { kind: "request", patch: { cancelRequested: true, updatedAt: now } };
}

export type FailureDecision =
  | { kind: "lost" }
  | { kind: "cancel"; patch: JobPatch }
  | { kind: "retry"; patch: JobPatch; delayMs: number }
  | { kind: "fail"; patch: JobPatch };

export function decideFailure(job: ShadowJobRecord, input: { now: number; leaseToken: string; errorCode: string; retryable: boolean }): FailureDecision {
  if (!holdsLease(job, input.leaseToken, input.now)) return { kind: "lost" };
  if (job.cancelRequested) return { kind: "cancel", patch: cancelledPatch(input.now) };
  const release = { leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: input.now };
  if (input.retryable && job.attempt < SHADOW_JOB_LIMITS.maxAttempts) {
    const delayMs = SHADOW_JOB_LIMITS.retryDelaysMs[Math.min(job.attempt - 1, SHADOW_JOB_LIMITS.retryDelaysMs.length - 1)] ?? 5_000;
    return { kind: "retry", delayMs, patch: { ...release, status: "queued", errorCode: input.errorCode, progress: { completedUnits: 0, totalUnits: job.progress.totalUnits } } };
  }
  return { kind: "fail", patch: { ...release, status: "failed", errorCode: input.errorCode } };
}

export type RecoveryDecision =
  | { kind: "none" }
  | { kind: "redispatch"; patch: JobPatch }
  | { kind: "fail"; patch: JobPatch };

/** Recovers jobs whose worker or dispatcher disappeared without reporting back. */
export function decideRecovery(job: ShadowJobRecord, now: number): RecoveryDecision {
  if (isTerminal(job.status)) return { kind: "none" };
  const leaseLive = job.leaseToken !== undefined && (job.leaseExpiresAt ?? 0) > now;
  if (leaseLive || now - job.updatedAt < SHADOW_JOB_LIMITS.staleAfterMs) return { kind: "none" };
  if (job.cancelRequested) return { kind: "fail", patch: cancelledPatch(now) };
  if (job.attempt >= SHADOW_JOB_LIMITS.maxAttempts) {
    return { kind: "fail", patch: { status: "failed", errorCode: "WORKER_TIMEOUT", leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now } };
  }
  return { kind: "redispatch", patch: { status: "queued", leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now } };
}

function cancelledPatch(now: number): JobPatch {
  return { status: "cancelled", cancelRequested: true, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now };
}

/** Fields safe to show the owner: no seed, lease, payload hash or solution data. */
export function publicJobView<T extends ShadowJobRecord & { _id: string; sourcePaperId: string; manifestRevision: string }>(job: T) {
  return {
    jobId: job._id,
    status: job.status,
    sourcePaperId: job.sourcePaperId,
    manifestRevision: job.manifestRevision,
    progress: job.progress,
    cancelRequested: job.cancelRequested,
    ...(job.errorCode && job.status === "failed" ? { errorCode: job.errorCode } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    variantId: job.status === "ready" ? job.variantId : undefined,
  };
}

export function startPayloadKey(input: { sourcePaperId: string; manifestRevision: string }) {
  return `shadow-start-v1\u0000${input.sourcePaperId}\u0000${input.manifestRevision}`;
}
