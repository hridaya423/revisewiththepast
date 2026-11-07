import { describe, expect, it } from "vitest";

import {
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
  type JobPatch,
  type ShadowJobRecord,
} from "./model/shadowJobs";
import { dispatchOutcome } from "./shadowPaperScheduler";

const NOW = 1_800_000_000_000;

function job(overrides: Partial<ShadowJobRecord> = {}): ShadowJobRecord {
  return {
    ownerId: "owner-a",
    idempotencyKey: "key-aaaaaaaaaaaaaaaa",
    payloadKey: startPayloadKey({ sourcePaperId: "edexcel-gcse-mathematics-higher-2019-june-paper-1", manifestRevision: "2026-11-01.1" }),
    status: "queued",
    attempt: 0,
    cancelRequested: false,
    progress: { completedUnits: 0, totalUnits: 22 },
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...overrides,
  };
}

const apply = (record: ShadowJobRecord, patch: JobPatch): ShadowJobRecord => ({ ...record, ...patch });

function claimed(token = "lease-aaaaaaaaaaaaaaaa") {
  const decision = decideClaim(job(), { now: NOW, leaseToken: token });
  if (decision.kind !== "claim") throw new Error("expected claim");
  return apply(job(), decision.patch);
}

describe("starting jobs", () => {
  const payloadKey = job().payloadKey;

  it("creates a job when the key is new and the owner has no active job", () => {
    expect(decideStart({ existing: null, payloadKey, activeJobs: 0 })).toEqual({ kind: "create" });
  });

  it("returns the existing job for a repeated identical request", () => {
    expect(decideStart({ existing: job(), payloadKey, activeJobs: 1 })).toEqual({ kind: "existing" });
  });

  it("rejects an idempotency key reused with a different payload", () => {
    const other = startPayloadKey({ sourcePaperId: "edexcel-gcse-mathematics-higher-2019-june-paper-1", manifestRevision: "2026-11-02.1" });
    expect(decideStart({ existing: job(), payloadKey: other, activeJobs: 0 })).toEqual({ kind: "conflict", code: "IDEMPOTENCY_CONFLICT" });
  });

  it("limits each owner to one active job", () => {
    expect(decideStart({ existing: null, payloadKey, activeJobs: 1 })).toEqual({ kind: "limited", code: "ACTIVE_JOB_LIMIT" });
  });
});

describe("leases", () => {
  it("claims a queued job and starts generating with a lease", () => {
    const record = claimed();
    expect(record).toMatchObject({ status: "generating", attempt: 1, leaseToken: "lease-aaaaaaaaaaaaaaaa", leaseExpiresAt: NOW + SHADOW_JOB_LIMITS.leaseMs });
  });

  it("refuses a second worker while the lease is live", () => {
    expect(decideClaim(claimed(), { now: NOW + 1000, leaseToken: "lease-bbbbbbbbbbbbbbbb" })).toEqual({ kind: "busy" });
  });

  it("lets a new worker take over an expired lease", () => {
    const decision = decideClaim(claimed(), { now: NOW + SHADOW_JOB_LIMITS.leaseMs + 1, leaseToken: "lease-bbbbbbbbbbbbbbbb" });
    expect(decision.kind).toBe("claim");
    if (decision.kind === "claim") expect(decision.patch).toMatchObject({ attempt: 2, leaseToken: "lease-bbbbbbbbbbbbbbbb" });
  });

  it("stops after the attempt budget", () => {
    const decision = decideClaim(job({ attempt: SHADOW_JOB_LIMITS.maxAttempts }), { now: NOW, leaseToken: "lease-cccccccccccccccc" });
    expect(decision).toMatchObject({ kind: "exhausted", patch: { status: "failed", errorCode: "WORKER_RETRIES_EXHAUSTED" } });
  });

  it("does not reclaim terminal jobs", () => {
    for (const status of ["ready", "failed", "cancelled"] as const) {
      expect(decideClaim(job({ status }), { now: NOW, leaseToken: "lease-aaaaaaaaaaaaaaaa" })).toEqual({ kind: "terminal" });
    }
  });

  it("honours a cancellation recorded before the claim", () => {
    expect(decideClaim(job({ cancelRequested: true }), { now: NOW, leaseToken: "lease-aaaaaaaaaaaaaaaa" })).toMatchObject({ kind: "cancel", patch: { status: "cancelled" } });
  });
});

describe("progress and publication", () => {
  it("advances stages monotonically and clamps progress", () => {
    let record = claimed();
    const validating = decideProgress(record, { now: NOW + 10, leaseToken: record.leaseToken!, stage: "validating", completedUnits: 99 });
    expect(validating.kind).toBe("progress");
    if (validating.kind === "progress") record = apply(record, validating.patch);
    expect(record.status).toBe("validating");
    expect(record.progress.completedUnits).toBe(22);
    const backwards = decideProgress(record, { now: NOW + 20, leaseToken: record.leaseToken!, stage: "generating", completedUnits: 3 });
    if (backwards.kind === "progress") expect(backwards.patch.status).toBe("validating");
  });

  it("ignores progress from a worker that lost its lease", () => {
    expect(decideProgress(claimed(), { now: NOW, leaseToken: "lease-zzzzzzzzzzzzzzzz", stage: "rendering", completedUnits: 22 })).toEqual({ kind: "lost" });
  });

  it("publishes once, for the lease holder only", () => {
    const record = claimed();
    const decision = decidePublish(record, { now: NOW + 100, leaseToken: record.leaseToken! });
    expect(decision.kind).toBe("publish");
    if (decision.kind !== "publish") return;
    const ready = apply(record, decision.patch);
    expect(ready).toMatchObject({ status: "ready", leaseToken: undefined });
    expect(decidePublish(ready, { now: NOW + 200, leaseToken: record.leaseToken! })).toEqual({ kind: "lost" });
  });

  it("rejects a stale worker publishing after takeover", () => {
    const first = claimed("lease-aaaaaaaaaaaaaaaa");
    const takeover = decideClaim(first, { now: NOW + SHADOW_JOB_LIMITS.leaseMs + 1, leaseToken: "lease-bbbbbbbbbbbbbbbb" });
    if (takeover.kind !== "claim") throw new Error("expected takeover");
    const second = apply(first, takeover.patch);
    expect(decidePublish(second, { now: NOW + SHADOW_JOB_LIMITS.leaseMs + 2, leaseToken: "lease-aaaaaaaaaaaaaaaa" })).toEqual({ kind: "lost" });
    expect(decidePublish(second, { now: NOW + SHADOW_JOB_LIMITS.leaseMs + 2, leaseToken: "lease-bbbbbbbbbbbbbbbb" }).kind).toBe("publish");
  });

  it("lets a cancellation immediately before publication win", () => {
    const record = claimed();
    const cancel = decideCancel(record, NOW + 50);
    expect(cancel.kind).toBe("request");
    if (cancel.kind !== "request") return;
    const cancelling = apply(record, cancel.patch);
    expect(decidePublish(cancelling, { now: NOW + 60, leaseToken: record.leaseToken! })).toMatchObject({ kind: "cancel", patch: { status: "cancelled" } });
  });
});

describe("cancellation", () => {
  it("cancels a queued job immediately", () => {
    expect(decideCancel(job(), NOW)).toMatchObject({ kind: "cancel", patch: { status: "cancelled" } });
  });

  it("keeps terminal results unchanged, including ready ones", () => {
    for (const status of ["ready", "failed", "cancelled"] as const) expect(decideCancel(job({ status }), NOW)).toEqual({ kind: "unchanged" });
  });
});

describe("failures and recovery", () => {
  it("retries infrastructure failures with backoff, then fails", () => {
    let record = claimed();
    const retry = decideFailure(record, { now: NOW + 1, leaseToken: record.leaseToken!, errorCode: "STORAGE_UNAVAILABLE", retryable: true });
    expect(retry).toMatchObject({ kind: "retry", delayMs: SHADOW_JOB_LIMITS.retryDelaysMs[0], patch: { status: "queued" } });
    record = job({ status: "rendering", attempt: SHADOW_JOB_LIMITS.maxAttempts, leaseToken: "lease-aaaaaaaaaaaaaaaa", leaseExpiresAt: NOW + 1000 });
    expect(decideFailure(record, { now: NOW, leaseToken: "lease-aaaaaaaaaaaaaaaa", errorCode: "STORAGE_UNAVAILABLE", retryable: true })).toMatchObject({ kind: "fail", patch: { status: "failed" } });
  });

  it("treats validation failures as terminal", () => {
    const record = claimed();
    expect(decideFailure(record, { now: NOW + 1, leaseToken: record.leaseToken!, errorCode: "NO_VALID_VARIANT", retryable: false })).toMatchObject({ kind: "fail", patch: { status: "failed", errorCode: "NO_VALID_VARIANT" } });
  });

  it("re-dispatches jobs abandoned by a crashed worker and gives up after the budget", () => {
    const abandoned = job({ status: "rendering", attempt: 1, leaseToken: "lease-aaaaaaaaaaaaaaaa", leaseExpiresAt: NOW - 1, updatedAt: NOW - SHADOW_JOB_LIMITS.staleAfterMs - 1 });
    expect(decideRecovery(abandoned, NOW)).toMatchObject({ kind: "redispatch", patch: { status: "queued" } });
    expect(decideRecovery({ ...abandoned, attempt: SHADOW_JOB_LIMITS.maxAttempts }, NOW)).toMatchObject({ kind: "fail", patch: { errorCode: "WORKER_TIMEOUT" } });
    expect(decideRecovery({ ...abandoned, leaseExpiresAt: NOW + 5 }, NOW)).toEqual({ kind: "none" });
    expect(decideRecovery({ ...abandoned, updatedAt: NOW - 5 }, NOW)).toEqual({ kind: "none" });
  });
});

describe("public views and dispatch", () => {
  it("never exposes seeds, leases or payload keys", () => {
    const view = publicJobView({ ...claimed(), _id: "job1", sourcePaperId: "s", manifestRevision: "r", paperSeed: "secret-seed" } as ShadowJobRecord & { _id: string; sourcePaperId: string; manifestRevision: string; paperSeed: string });
    const text = JSON.stringify(view);
    expect(text).not.toContain("secret-seed");
    expect(text).not.toContain("lease-");
    expect(text).not.toContain("shadow-start");
  });

  it("only reports the variant once ready", () => {
    expect(publicJobView({ ...job({ variantId: "v1" }), _id: "j", sourcePaperId: "s", manifestRevision: "r" }).variantId).toBeUndefined();
    expect(publicJobView({ ...job({ status: "ready", variantId: "v1" }), _id: "j", sourcePaperId: "s", manifestRevision: "r" }).variantId).toBe("v1");
  });

  it("retries dispatch only on server or transport errors", () => {
    expect(dispatchOutcome(200)).toBe("done");
    expect(dispatchOutcome(409)).toBe("done");
    expect(dispatchOutcome(401)).toBe("done");
    expect(dispatchOutcome(502)).toBe("retry");
  });
});
