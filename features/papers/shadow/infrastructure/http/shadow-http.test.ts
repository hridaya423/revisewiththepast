import { describe, expect, it, vi } from "vitest";

import { RateLimitError } from "@/shared/application/errors";
import { SHADOW_MANIFESTS } from "../../content/catalog";
import type { ShadowManifest } from "../../contracts/shadow-paper";
import { matchShadowRoute, type ShadowHttpDeps, type ShadowJobView } from "./shadow-routes";
import { createShadowWorkerHandler, hasServiceAuthorization } from "./shadow-worker";

const pilot = SHADOW_MANIFESTS[0]!;
const approved: ShadowManifest = { ...pilot, publicationStatus: "approved" };
const JOB_ID = "jd7abcdefghijklmnopqrstuvwxyz012";
const OTHER_JOB = "jd7zzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const VARIANT_ID = "kh7abcdefghijklmnopqrstuvwxyz012";

function view(overrides: Partial<ShadowJobView> = {}): ShadowJobView {
  return {
    jobId: JOB_ID,
    status: "queued",
    sourcePaperId: pilot.source.sourcePaperId,
    manifestRevision: pilot.revision,
    progress: { completedUnits: 0, totalUnits: 22 },
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
    variant: null,
    ...overrides,
  };
}

function deps(overrides: Partial<ShadowHttpDeps> = {}): ShadowHttpDeps {
  return {
    enabled: () => true,
    manifests: () => [approved],
    authToken: async (request) => request.headers.get("x-test-token"),
    reserve: async () => undefined,
    startJob: async () => ({ created: true, job: view() }),
    getJob: async (token, jobId) => (token === "owner" && jobId === JOB_ID ? view() : null),
    getActiveJob: async () => null,
    cancelJob: async (token, jobId) => (token === "owner" && jobId === JOB_ID ? view({ status: "cancelled" }) : null),
    getVariant: async (token) => (token === "owner" ? { variantId: VARIANT_ID } : null),
    getArtifact: async (token, _id, kind) => (token === "owner" ? { url: `https://storage.test/${kind}`, fileName: `shadow-${kind}.pdf`, sha256: "a".repeat(64), fileSize: 4, displayCode: "SH-ABCD-EFGH" } : null),
    saveVariant: async () => ({ savedPaperId: "saved1", created: true }),
    fetchArtifact: async () => new Response(new Uint8Array([37, 80, 68, 70])),
    worker: async () => Response.json({ outcome: { kind: "ready" } }),
    ...overrides,
  };
}

async function call(method: "GET" | "POST", path: string, options: { token?: string; body?: unknown; deps?: ShadowHttpDeps } = {}) {
  const url = new URL(`https://app.test/api/paper-maker/${path}`);
  const segments = url.pathname.replace("/api/paper-maker/", "").split("/");
  const match = matchShadowRoute(method, segments);
  if (!match) return new Response("Not found", { status: 404 });
  const request = new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(options.token ? { "x-test-token": options.token } : {}) },
    ...(options.body !== undefined ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) } : {}),
  });
  return match.handler(request, match.params, options.deps ?? deps());
}

const startBody = { sourcePaperId: pilot.source.sourcePaperId, manifestRevision: pilot.revision, idempotencyKey: "abcdefghijklmnop1234" };

describe("route matching", () => {
  it("keeps the worker path out of the public job routes", () => {
    expect(matchShadowRoute("POST", ["shadow-jobs", "worker"])?.params).toEqual({});
    expect(matchShadowRoute("GET", ["shadow-jobs", "worker"])?.params).toEqual({ jobId: "worker" });
    expect(matchShadowRoute("GET", ["shadow-jobs", "active"])?.params).toEqual({});
    expect(matchShadowRoute("DELETE", ["shadow-jobs"])).toBeNull();
    expect(matchShadowRoute("GET", ["shadow-jobs", JOB_ID, "cancel"])).toBeNull();
  });

  it("returns 404 for the reserved worker segment on the public status route", async () => {
    expect((await call("GET", "shadow-jobs/worker", { token: "owner" })).status).toBe(404);
  });
});

describe("catalogue", () => {
  it("lists only visible manifests without answer data", async () => {
    const response = await call("GET", "shadow-papers");
    const body = await response.json();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0]).toMatchObject({ sourcePaperId: pilot.source.sourcePaperId, totalMarks: 80, questionCount: 22, calculator: "not-allowed", unchangedQuestionCount: 0 });
    expect(JSON.stringify(body)).not.toMatch(/templateRevision|solution|answer/iu);
  });

  it("returns 404 for unknown or malformed papers", async () => {
    expect((await call("GET", "shadow-papers/unknown-paper-id-here")).status).toBe(404);
    expect((await call("GET", "shadow-papers/..%2Fetc")).status).toBe(404);
  });

  it("deduplicates manifests for the same sitting", async () => {
    const older = { ...approved, revision: "2026-10-01.1" };
    const body = await (await call("GET", "shadow-papers", { deps: deps({ manifests: () => [older, approved] }) })).json();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0].manifestRevision).toBe(approved.revision);
  });
});

describe("starting jobs", () => {
  it("accepts a valid request with 202 and a status URL", async () => {
    const startJob = vi.fn(async () => ({ created: true, job: view() }));
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ startJob }) });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ job: { jobId: JOB_ID }, statusUrl: `/api/paper-maker/shadow-jobs/${JOB_ID}` });
    expect(startJob).toHaveBeenCalledWith("owner", { ...startBody, totalUnits: 22 });
  });

  it("returns 200 for a replayed idempotent request", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ startJob: async () => ({ created: false, job: view() }) }) });
    expect(response.status).toBe(200);
  });

  it.each([
    ["extra fields", { ...startBody, seed: "1234" }],
    ["a client seed in place of the key", { sourcePaperId: startBody.sourcePaperId, manifestRevision: startBody.manifestRevision, seed: "x" }],
    ["a malformed key", { ...startBody, idempotencyKey: "short" }],
    ["a source URL", { ...startBody, sourcePaperId: "https://evil.test/paper.pdf" }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await call("POST", "shadow-jobs", { token: "owner", body })).status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await call("POST", "shadow-jobs", { token: "owner", body: "{" })).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await call("POST", "shadow-jobs", { body: startBody })).status).toBe(401);
  });

  it("returns 409 with the current paper when the manifest is stale", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: { ...startBody, manifestRevision: "2020-01-01.1" } });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("MANIFEST_STALE");
    expect(body.paper.manifestRevision).toBe(pilot.revision);
  });

  it("returns 404 for papers that are not published", async () => {
    expect((await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ manifests: () => [] }) })).status).toBe(404);
  });

  it("maps an idempotency conflict to 409", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ startJob: async () => { throw new Error("[CONVEX M(shadowPapers:startJob)] Uncaught Error: IDEMPOTENCY_CONFLICT"); } }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("enforces the hourly rate limit with 429 and Retry-After", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ reserve: async () => { throw new RateLimitError("limited", Date.now() + 60_000); } }) });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("enforces one active job per owner with 429", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ startJob: async () => { throw new Error("Uncaught Error: ACTIVE_JOB_LIMIT"); } }) });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("ACTIVE_JOB_LIMIT");
  });

  it("refuses new generation when the kill switch is off", async () => {
    const response = await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ enabled: () => false }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("SHADOW_DISABLED");
  });

  it("runs the optional inline kick only for newly created jobs", async () => {
    const afterStart = vi.fn();
    await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ afterStart }) });
    await call("POST", "shadow-jobs", { token: "owner", body: startBody, deps: deps({ afterStart, startJob: async () => ({ created: false, job: view() }) }) });
    expect(afterStart).toHaveBeenCalledTimes(1);
  });
});

describe("owner-scoped job access", () => {
  it("returns the owner's job and 404 for anyone else's", async () => {
    expect((await call("GET", `shadow-jobs/${JOB_ID}`, { token: "owner" })).status).toBe(200);
    expect((await call("GET", `shadow-jobs/${JOB_ID}`, { token: "intruder" })).status).toBe(404);
    expect((await call("GET", `shadow-jobs/${OTHER_JOB}`, { token: "owner" })).status).toBe(404);
    expect((await call("GET", `shadow-jobs/${JOB_ID}`)).status).toBe(401);
  });

  it("does not expose solutions or seeds in status responses", async () => {
    const body = await (await call("GET", `shadow-jobs/${JOB_ID}`, { token: "owner" })).json();
    expect(JSON.stringify(body)).not.toMatch(/seed|lease|solution|payload/iu);
  });

  it("cancels only the owner's job", async () => {
    expect((await (await call("POST", `shadow-jobs/${JOB_ID}/cancel`, { token: "owner" })).json()).job.status).toBe("cancelled");
    expect((await call("POST", `shadow-jobs/${JOB_ID}/cancel`, { token: "intruder" })).status).toBe(404);
  });
});

describe("downloads and saving", () => {
  it("streams the owner's stored PDF from a server-owned reference", async () => {
    const fetchArtifact = vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70])));
    const response = await call("GET", `shadow-variants/${VARIANT_ID}/download?kind=mark-scheme`, { token: "owner", deps: deps({ fetchArtifact }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("shadow-mark-scheme.pdf");
    expect(fetchArtifact).toHaveBeenCalledWith("https://storage.test/mark-scheme");
  });

  it("rejects invalid artifact kinds with 400 and other owners with 404", async () => {
    expect((await call("GET", `shadow-variants/${VARIANT_ID}/download?kind=answers`, { token: "owner" })).status).toBe(400);
    expect((await call("GET", `shadow-variants/${VARIANT_ID}/download?kind=paper`, { token: "intruder" })).status).toBe(404);
    expect((await call("GET", `shadow-variants/${VARIANT_ID}/download?kind=paper`)).status).toBe(401);
  });

  it("saves without accepting client-authored content", async () => {
    expect((await call("POST", `shadow-variants/${VARIANT_ID}/save`, { token: "owner", body: {} })).status).toBe(201);
    expect((await call("POST", `shadow-variants/${VARIANT_ID}/save`, { token: "owner", body: { questions: [{ answer: "1" }] } })).status).toBe(400);
  });

  it("maps expired and foreign variants on save", async () => {
    const expired = deps({ saveVariant: async () => { throw new Error("Uncaught Error: EXPIRED"); } });
    expect((await call("POST", `shadow-variants/${VARIANT_ID}/save`, { token: "owner", body: {}, deps: expired })).status).toBe(410);
    const foreign = deps({ saveVariant: async () => { throw new Error("Uncaught Error: NOT_FOUND"); } });
    expect((await call("POST", `shadow-variants/${VARIANT_ID}/save`, { token: "intruder", body: {}, deps: foreign })).status).toBe(404);
  });
});

describe("worker endpoint", () => {
  it("authenticates before reading the job", async () => {
    process.env.MCP_SERVICE_SECRET = "s".repeat(40);
    const run = vi.fn(async () => ({ kind: "ready" as const }));
    const handler = createShadowWorkerHandler(run);
    const unauthorised = await handler(new Request("https://app.test/w", { method: "POST", headers: { authorization: "Bearer wrong" }, body: JSON.stringify({ jobId: JOB_ID }) }));
    expect(unauthorised.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    const ok = await handler(new Request("https://app.test/w", { method: "POST", headers: { authorization: `Bearer ${"s".repeat(40)}` }, body: JSON.stringify({ jobId: JOB_ID }) }));
    expect(ok.status).toBe(200);
    expect(run).toHaveBeenCalledWith(JOB_ID);
  });

  it("signals busy leases with 409 and dependency failures with 503", async () => {
    process.env.MCP_SERVICE_SECRET = "s".repeat(40);
    const headers = { authorization: `Bearer ${"s".repeat(40)}` };
    const busy = createShadowWorkerHandler(async () => ({ kind: "skipped", reason: "busy" }));
    expect((await busy(new Request("https://app.test/w", { method: "POST", headers, body: JSON.stringify({ jobId: JOB_ID }) }))).status).toBe(409);
    const down = createShadowWorkerHandler(async () => { throw new Error("convex down"); });
    expect((await down(new Request("https://app.test/w", { method: "POST", headers, body: JSON.stringify({ jobId: JOB_ID }) }))).status).toBe(503);
  });

  it("compares service secrets exactly", () => {
    expect(hasServiceAuthorization("Bearer abc", "abc")).toBe(true);
    expect(hasServiceAuthorization("Bearer abcd", "abc")).toBe(false);
    expect(hasServiceAuthorization("abc", "abc")).toBe(false);
    expect(hasServiceAuthorization("Bearer abc", undefined)).toBe(false);
  });
});
