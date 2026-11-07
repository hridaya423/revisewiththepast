import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelJob, jobDownload, jobStatus, startJob } from "./generation-jobs";

const { query, mutation } = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("./generation-access", async (original) => ({
  ...await original<typeof import("./generation-access")>(),
  generationAccess: vi.fn().mockResolvedValue({ client: { query, mutation }, secret: "server-secret", guestHash: "hash", capability: "a".repeat(64) }),
}));
vi.mock("@/features/mcp/rate-limit", () => ({ getCallerKey: () => "b".repeat(64) }));

const jobId = "3d3d793b-5ba2-42eb-9292-0be4d22b617a";
const body = { request: { subjectKey: "aqa-geography" }, paperCount: 1, includeMarkScheme: false, requestKey: jobId };
const request = (path: string, input?: unknown, origin?: string) => new NextRequest(`http://localhost${path}`, {
  ...(input ? { method: "POST", body: JSON.stringify(input) } : {}),
  headers: { ...(input ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) },
});

beforeEach(() => { query.mockReset(); mutation.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("private generation endpoints", () => {
  it("rejects a cross-origin start without reserving or creating a job", async () => {
    const response = await startJob(request("/api/paper-maker/generation-jobs", body, "https://another-site.example"));
    expect(response.status).toBe(403);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("returns a private job without exposing the guest capability in JSON", async () => {
    mutation.mockResolvedValue({ job: { jobId, status: "queued" } });
    const response = await startJob(request("/api/paper-maker/generation-jobs", body));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.json()).toEqual({ jobId, status: "queued" });
    expect(mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestKey: jobId, guestHash: "hash" }));
  });

  it("returns the same not-found result for unavailable or unauthorised status", async () => {
    query.mockResolvedValue(null);
    const response = await jobStatus(request(`/api/paper-maker/generation-jobs?jobId=${jobId}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.text()).not.toContain("secret");
  });

  it("does not permit a cross-origin cancellation", async () => {
    const response = await cancelJob(request("/api/paper-maker/generation-jobs/cancel", { jobId }, "https://another-site.example"));
    expect(response.status).toBe(403);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("proxies an authorised artifact without exposing its storage URL", async () => {
    query.mockResolvedValue({ url: "https://private-storage.example/file", fileName: "Practice paper.pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-test")));
    const response = await jobDownload(request(`/api/paper-maker/generation-jobs/download?jobId=${jobId}&part=scheme-0`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("Practice%20paper.pdf");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("%PDF-test");
  });

  it("does not access storage for an invalid artifact selector", async () => {
    expect((await jobDownload(request(`/api/paper-maker/generation-jobs/download?jobId=${jobId}&part=../../file`))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps actual preview images behind the same private download boundary", async () => {
    query.mockResolvedValue({ url: "https://private-storage.example/preview", fileName: "preview.png", contentType: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]))));
    const response = await jobDownload(request(`/api/paper-maker/generation-jobs/download?jobId=${jobId}&part=preview-0&view=1`));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("inline");
  });
});
