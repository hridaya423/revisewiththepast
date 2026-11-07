import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancel, checkpoint, create, heartbeat, read, retryScheme } from "./generationJobs";
import type { MutationCtx } from "./_generated/server";

vi.mock("./model/auth", () => ({ requireAuthenticatedUser: vi.fn().mockResolvedValue({ _id: "student-b" }) }));
vi.mock("./mcpRateLimits", () => ({ reserveQuota: vi.fn().mockResolvedValue({ allowed: true, retryAt: 100 }) }));

const secret = "test-service-secret-for-local-tests";
const guestHash = "a".repeat(64);
const snapshot = { jobId: "job", status: "succeeded", totalPapers: 1, papers: [], progress: 1 };
const handler = (registered: unknown) => (registered as { _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<unknown> })._handler;

function context(row: Record<string, unknown> | null, workerSeenAt?: number) {
  const unique = vi.fn().mockResolvedValue(row);
  const patch = vi.fn();
  const insert = vi.fn();
  const first = vi.fn().mockResolvedValue(workerSeenAt ? { seenAt: workerSeenAt } : null);
  const dbQuery = vi.fn(() => ({ withIndex: () => ({ unique, order: () => ({ first }) }) }));
  return {
    ctx: {
      db: { query: dbQuery, patch, insert },
      auth: { getUserIdentity: vi.fn().mockResolvedValue({ subject: "student-b" }) },
      storage: { delete: vi.fn() },
    } as unknown as MutationCtx,
    patch, insert, dbQuery,
  };
}

beforeEach(() => { vi.stubEnv("MCP_SERVICE_SECRET", secret); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("persisted generation transitions", () => {
  it("does not accept or charge work when there is no live executor", async () => {
    const { ctx, insert } = context(null);
    const result = await handler(create)(ctx, {
      serviceSecret: secret, guestHash, jobId: "new-job", requestKey: "new", callerKey: "b".repeat(64),
      requestJson: JSON.stringify({ subjectKey: "aqa-geography" }), paperCount: 1, includeMarkScheme: false,
    });
    expect(result).toEqual({ workerUnavailable: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("accepts a new request when the executor has checked in recently", async () => {
    const { ctx, insert } = context(null, Date.now());
    const result = await handler(create)(ctx, {
      serviceSecret: secret, guestHash, jobId: "new-job", requestKey: "new", callerKey: "b".repeat(64),
      requestJson: JSON.stringify({ subjectKey: "aqa-geography" }), paperCount: 1, includeMarkScheme: false,
    });
    expect(result).toHaveProperty("job.status", "queued");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("returns an existing request before charging another generation allowance", async () => {
    const { ctx, insert, dbQuery } = context({ guestHash, expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(snapshot) });
    const result = await handler(create)(ctx, {
      serviceSecret: secret, guestHash, jobId: "new-job", requestKey: "existing", callerKey: "b".repeat(64),
      requestJson: JSON.stringify({ subjectKey: "aqa-geography" }), paperCount: 1, includeMarkScheme: false,
    });
    expect(result).toEqual({ job: snapshot });
    expect(insert).not.toHaveBeenCalled();
    expect(dbQuery).toHaveBeenCalledTimes(1);
  });

  it("does not reveal an owned job when another account replays its request key", async () => {
    const { ctx, insert } = context({ guestHash, ownerId: "student-a", expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(snapshot) });
    const result = await handler(create)(ctx, {
      serviceSecret: secret, guestHash, jobId: "new-job", requestKey: "existing", callerKey: "b".repeat(64),
      requestJson: JSON.stringify({ subjectKey: "aqa-geography" }), paperCount: 1, includeMarkScheme: false,
    });
    expect(result).not.toHaveProperty("job");
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps completed work when a late cancellation arrives", async () => {
    const { ctx, patch } = context({ guestHash, expiresAt: Date.now() + 60_000, status: "succeeded", snapshotJson: JSON.stringify(snapshot) });
    expect(await handler(cancel)(ctx, { serviceSecret: secret, guestHash, jobId: "job" })).toEqual(snapshot);
    expect(patch).not.toHaveBeenCalled();
  });

  it("retries only the failed scheme while retaining question identity", async () => {
    const paper = { index: 0, selectedUnitKeys: ["original-question"], markSchemeGenerated: false, markSchemeWarning: "Unavailable" };
    const current = { ...snapshot, completedPapers: 1, runVersion: 0, papers: [paper] };
    const { ctx } = context({ _id: "document", guestHash, expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(current) }, Date.now());
    const result = await handler(retryScheme)(ctx, { serviceSecret: secret, guestHash, jobId: "job", callerKey: "b".repeat(64), paperIndex: 0, runVersion: 0, requestKey: "retry-request" });
    expect(result).toHaveProperty("job.runVersion", 1);
    expect(result).toHaveProperty("job.status", "queued");
    expect(result).toHaveProperty("job.papers.0.selectedUnitKeys", ["original-question"]);
    expect(result).toHaveProperty("job.papers.0.markSchemeWarning", null);
  });

  it("does not reserve another retry after a repeated request was acknowledged", async () => {
    const current = { ...snapshot, runVersion: 1, lastRetryRequestKey: "retry-request" };
    const { ctx, patch } = context({ guestHash, expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(current) });
    expect(await handler(retryScheme)(ctx, { serviceSecret: secret, guestHash, jobId: "job", callerKey: "b".repeat(64), paperIndex: 0, runVersion: 0, requestKey: "retry-request" })).toEqual({ job: current });
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not let an old Stop request cancel a new scheme retry", async () => {
    const current = { ...snapshot, status: "queued", runVersion: 1 };
    const { ctx, patch } = context({ guestHash, expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(current) });
    expect(await handler(cancel)(ctx, { serviceSecret: secret, guestHash, jobId: "job", runVersion: 0 })).toEqual(current);
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects a former guest capability after another account owns the job", async () => {
    const { ctx } = context({ guestHash, ownerId: "student-a", expiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(snapshot) });
    expect(await handler(read)(ctx, { serviceSecret: secret, guestHash, jobId: "job" })).toBeNull();
  });

  it("does not renew a lease for a worker that lost ownership", async () => {
    const { ctx, patch } = context({ workerId: "worker-a", leaseExpiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify({ ...snapshot, status: "generating" }) });
    expect(await handler(heartbeat)(ctx, { serviceSecret: secret, workerId: "worker-b", jobId: "job" })).toEqual({ active: false, cancelled: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it("refuses a checkpoint that would overwrite terminal success", async () => {
    const { ctx, patch } = context({ workerId: "worker-a", leaseExpiresAt: Date.now() + 60_000, snapshotJson: JSON.stringify(snapshot) });
    expect(await handler(checkpoint)(ctx, {
      serviceSecret: secret, workerId: "worker-a", jobId: "job",
      snapshotJson: JSON.stringify({ ...snapshot, status: "cancelled" }),
    })).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });
});
