import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decideCancel,
  decideClaim,
  decideFailure,
  decideProgress,
  decidePublish,
  startPayloadKey,
  type ShadowJobRecord,
} from "@/convex/model/shadowJobs";
import { SHADOW_TEMPLATE_REGISTRY, findShadowManifest } from "../content/catalog";
import type { ShadowManifest } from "../contracts/shadow-paper";
import { runShadowJob, type ShadowVariantPublication, type ShadowWorkerPorts } from "./generate-shadow-paper";

const manifest = findShadowManifest("edexcel-gcse-mathematics-higher-2019-june-paper-1", { includeDraft: true })!;
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** An in-memory stand-in for the Convex job table that applies the same pure decisions. */
class FakeJobStore {
  job: ShadowJobRecord & { sourcePaperId: string; manifestRevision: string; paperSeed: string };
  storage = new Map<string, Uint8Array>();
  deleted: string[] = [];
  published: ShadowVariantPublication[] = [];
  clock = 1_800_000_000_000;
  onProgress?: (stage: string, completed: number) => void;
  failUploads = 0;

  constructor(seed = "ab".repeat(32)) {
    this.job = {
      ownerId: "owner-a",
      idempotencyKey: "key-aaaaaaaaaaaaaaaa",
      payloadKey: startPayloadKey({ sourcePaperId: manifest.source.sourcePaperId, manifestRevision: manifest.revision }),
      sourcePaperId: manifest.source.sourcePaperId,
      manifestRevision: manifest.revision,
      paperSeed: seed,
      status: "queued",
      attempt: 0,
      cancelRequested: false,
      progress: { completedUnits: 0, totalUnits: manifest.units.length },
      createdAt: this.clock,
      updatedAt: this.clock,
    };
  }

  private patch(patch: Partial<ShadowJobRecord>) {
    this.job = { ...this.job, ...patch };
  }

  private drop(ids: string[]) {
    for (const id of ids) {
      if (this.storage.delete(id)) this.deleted.push(id);
    }
  }

  cancel() {
    const decision = decideCancel(this.job, this.clock);
    if (decision.kind !== "unchanged") this.patch(decision.patch);
  }

  ports(overrides: Partial<ShadowWorkerPorts> = {}): ShadowWorkerPorts {
    return {
      newLeaseToken: () => randomBytes(12).toString("base64url"),
      claim: async (_jobId, leaseToken) => {
        const decision = decideClaim(this.job, { now: this.clock, leaseToken });
        if (decision.kind === "terminal" || decision.kind === "busy") return { kind: decision.kind };
        this.patch(decision.patch);
        if (decision.kind !== "claim") return { kind: decision.kind };
        return { kind: "claimed", job: { jobId: "job-1", sourcePaperId: this.job.sourcePaperId, manifestRevision: this.job.manifestRevision, paperSeed: this.job.paperSeed, attempt: this.job.attempt, createdAt: this.job.createdAt } };
      },
      progress: async (_jobId, leaseToken, stage, completedUnits) => {
        this.onProgress?.(stage, completedUnits);
        const decision = decideProgress(this.job, { now: this.clock, leaseToken, stage, completedUnits });
        if (decision.kind !== "lost") this.patch(decision.patch);
        return { kind: decision.kind };
      },
      upload: async (bytes) => {
        if (this.failUploads > 0) {
          this.failUploads -= 1;
          throw new Error("storage unavailable");
        }
        const id = `storage-${this.storage.size + this.deleted.length + 1}`;
        this.storage.set(id, bytes);
        return id;
      },
      publish: async (_jobId, leaseToken, publication) => {
        const decision = decidePublish(this.job, { now: this.clock, leaseToken });
        if (decision.kind !== "publish") {
          this.drop([publication.variant.paper.storageId, publication.variant.markScheme.storageId]);
          if (decision.kind === "cancel") this.patch(decision.patch);
          return { kind: decision.kind };
        }
        this.published.push(publication);
        this.patch({ ...decision.patch });
        return { kind: "published" };
      },
      fail: async (_jobId, leaseToken, failure) => {
        this.drop(failure.orphanStorageIds);
        const decision = decideFailure(this.job, { now: this.clock, leaseToken, errorCode: failure.errorCode, retryable: failure.retryable });
        if (decision.kind !== "lost") this.patch(decision.patch);
        return { kind: decision.kind };
      },
      findManifest: (id) => (id === manifest.source.sourcePaperId ? manifest : null),
      registry: SHADOW_TEMPLATE_REGISTRY,
      allowDraft: true,
      renderPaper: async (variant) => ({ kind: "paper", bytes: new TextEncoder().encode(`paper ${variant.displayCode}`), pageCount: 20 }),
      renderMarkScheme: async (variant) => ({ kind: "mark-scheme", bytes: new TextEncoder().encode(`scheme ${variant.displayCode}`), pageCount: 14 }),
      rendererVersion: "test-renderer",
      sha256,
      ...overrides,
    };
  }
}

describe("runShadowJob", () => {
  it("generates, validates, renders and publishes one immutable variant", async () => {
    const store = new FakeJobStore();
    const stages: string[] = [];
    store.onProgress = (stage) => stages.push(stage);
    await expect(runShadowJob("job-1", store.ports())).resolves.toEqual({ kind: "ready" });
    expect(store.job.status).toBe("ready");
    expect(new Set(stages)).toEqual(new Set(["generating", "validating", "rendering"]));
    const [publication] = store.published;
    expect(store.published).toHaveLength(1);
    expect(publication!.questions).toHaveLength(22);
    expect(publication!.questions.reduce((sum, question) => sum + question.marks, 0)).toBe(80);
    expect(publication!.variant.displayCode).toMatch(/^SH-/u);
    expect(publication!.variant.validation.failed).toBe(0);
    expect(publication!.variant.paper.sha256).toBe(sha256(store.storage.get(publication!.variant.paper.storageId)!));
    expect(JSON.stringify(publication)).not.toContain(store.job.paperSeed);
    for (const question of publication!.questions) {
      expect(JSON.parse(question.solutionJson).parts.length).toBeGreaterThan(0);
      expect(question.promptText.length).toBeGreaterThan(0);
    }
  });

  it("rejects a manifest that changed after queueing as a terminal failure", async () => {
    const store = new FakeJobStore();
    const stale: ShadowManifest = { ...manifest, revision: "2026-12-01.1" };
    await expect(runShadowJob("job-1", store.ports({ findManifest: () => stale }))).resolves.toEqual({ kind: "failed", errorCode: "MANIFEST_STALE", retryable: false });
    expect(store.job.status).toBe("failed");
    expect(store.published).toHaveLength(0);
  });

  it("fails terminally when rendering fails", async () => {
    const store = new FakeJobStore();
    const result = await runShadowJob("job-1", store.ports({ renderPaper: async () => { throw new Error("layout"); } }));
    expect(result).toEqual({ kind: "failed", errorCode: "RENDER_FAILED", retryable: false });
    expect(store.job).toMatchObject({ status: "failed", errorCode: "RENDER_FAILED" });
  });

  it("retries a transient storage failure with the same seed and reaches the same variant", async () => {
    const store = new FakeJobStore();
    store.failUploads = 2;
    let first = await runShadowJob("job-1", store.ports());
    expect(first).toEqual({ kind: "failed", errorCode: "STORAGE_UNAVAILABLE", retryable: true });
    expect(store.job.status).toBe("queued");
    first = await runShadowJob("job-1", store.ports());
    expect(first.kind).toBe("failed");
    const final = await runShadowJob("job-1", store.ports());
    expect(final).toEqual({ kind: "ready" });
    expect(store.job.attempt).toBe(3);

    const reference = new FakeJobStore();
    await runShadowJob("job-1", reference.ports());
    expect(store.published[0]!.variant.semanticHash).toBe(reference.published[0]!.variant.semanticHash);
    expect(store.storage.size).toBe(2);
  });

  it("stops when the student cancels during generation", async () => {
    const store = new FakeJobStore();
    store.onProgress = (stage) => { if (stage === "generating") store.cancel(); };
    await expect(runShadowJob("job-1", store.ports())).resolves.toEqual({ kind: "cancelled" });
    expect(store.job.status).toBe("cancelled");
    expect(store.published).toHaveLength(0);
  });

  it("discards uploads when cancellation wins immediately before publication", async () => {
    const store = new FakeJobStore();
    const ports = store.ports();
    const publish = ports.publish;
    ports.publish = async (...args) => {
      store.cancel();
      return publish(...args);
    };
    await expect(runShadowJob("job-1", ports)).resolves.toEqual({ kind: "cancelled" });
    expect(store.storage.size).toBe(0);
    expect(store.deleted).toHaveLength(2);
    expect(store.job.status).toBe("cancelled");
  });

  it("ignores a duplicate invocation while another worker holds the lease", async () => {
    const store = new FakeJobStore();
    const ports = store.ports();
    const claim = await ports.claim("job-1", "lease-held-by-other-worker");
    expect(claim.kind).toBe("claimed");
    await expect(runShadowJob("job-1", ports)).resolves.toEqual({ kind: "skipped", reason: "busy" });
    expect(store.published).toHaveLength(0);
  });

  it("does nothing for a job that is already ready", async () => {
    const store = new FakeJobStore();
    await runShadowJob("job-1", store.ports());
    await expect(runShadowJob("job-1", store.ports())).resolves.toEqual({ kind: "skipped", reason: "terminal" });
    expect(store.published).toHaveLength(1);
  });
});
