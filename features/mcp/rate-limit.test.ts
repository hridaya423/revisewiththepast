import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  getMcpServiceSecret: vi.fn(() => "s".repeat(32)),
}));

vi.mock("./infrastructure/convex-client", () => ({
  getMcpConvexClient: () => ({ mutation: mocks.mutation }),
  getMcpServiceSecret: mocks.getMcpServiceSecret,
}));

import { getCallerKey, reservePaperGeneration } from "./rate-limit";

describe("MCP paper-generation rate limit", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("HMACs trusted caller identity without exposing the address", () => {
    vi.stubEnv("VERCEL", "1");
    const first = getCallerKey(new Request("https://example.test/mcp", { headers: { "x-vercel-forwarded-for": "192.0.2.10" } }));
    const same = getCallerKey(new Request("https://example.test/mcp", { headers: { "x-vercel-forwarded-for": "192.0.2.10" } }));
    const different = getCallerKey(new Request("https://example.test/mcp", { headers: { "x-vercel-forwarded-for": "192.0.2.11" } }));

    expect(first).toHaveLength(64);
    expect(first).toBe(same);
    expect(first).not.toBe(different);
    expect(first).not.toContain("192.0.2.10");
  });

  it("ignores proxy headers outside Vercel", () => {
    vi.stubEnv("VERCEL", "0");
    const first = getCallerKey(new Request("https://example.test/mcp", { headers: { "x-vercel-forwarded-for": "192.0.2.10" } }));
    const different = getCallerKey(new Request("https://example.test/mcp", { headers: { "x-forwarded-for": "192.0.2.11" } }));

    expect(first).toBe(different);
  });

  it("prefers Vercel's trusted address when multiple proxy headers are present", () => {
    vi.stubEnv("VERCEL", "1");
    const caller = getCallerKey(new Request("https://example.test/mcp", {
      headers: {
        "x-vercel-forwarded-for": "192.0.2.10",
        "x-real-ip": "192.0.2.99",
      },
    }));
    const expected = getCallerKey(new Request("https://example.test/mcp", {
      headers: { "x-vercel-forwarded-for": "192.0.2.10" },
    }));

    expect(caller).toBe(expected);
  });

  it("sends limit overrides under the argument names the Convex mutation declares", async () => {
    mocks.mutation.mockResolvedValue({
      allowed: true,
      retryAt: 0,
      remainingForCaller: 59,
      remainingGlobal: 1999,
    });

    await reservePaperGeneration(undefined, "marking-ocr", { callerLimit: 60, globalLimit: 2000 });

    const payload = mocks.mutation.mock.calls[0][1];
    expect(payload).toMatchObject({ scope: "marking-ocr", callerLimit: 60, globalLimitOverride: 2000 });
  });

  it("turns an atomic Convex denial into a retryable application error", async () => {
    mocks.mutation.mockResolvedValue({
      allowed: false,
      retryAt: 1_800_000_000_000,
      remainingForCaller: 0,
      remainingGlobal: 4,
    });

    await expect(reservePaperGeneration(new Request("https://example.test/mcp"))).rejects.toMatchObject({
      status: 429,
      retryAt: 1_800_000_000_000,
    });
    expect(mocks.mutation).toHaveBeenCalledOnce();
  });
});
