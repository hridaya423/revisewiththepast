import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/mcp/server", () => ({
  paperMakerMcpHandler: { fetch: fetchMock },
}));

vi.mock("@/shared/infrastructure/env/server", () => ({
  getServerEnvironment: () => ({
    MCP_ALLOWED_HOSTS: "example.test",
    SITE_URL: "https://example.test",
    NEXT_PUBLIC_SITE_URL: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
    VERCEL_URL: undefined,
  }),
}));

import { OPTIONS, POST } from "./route";

describe("MCP HTTP route protection", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("passes allowed requests to the MCP handler and exposes CORS headers", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await POST(new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        host: "example.test",
        origin: "https://example.test",
        "content-type": "application/json",
      },
      body: "{}",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://example.test");
    expect(response.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("handles allowed CORS preflight without invoking the MCP handler", async () => {
    const response = await OPTIONS(new Request("https://example.test/mcp", {
      method: "OPTIONS",
      headers: { host: "example.test", origin: "https://example.test" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("Mcp-Protocol-Version");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an untrusted host and origin", async () => {
    const hostResponse = await POST(new Request("https://evil.test/mcp", {
      method: "POST",
      headers: { host: "evil.test", "content-type": "application/json" },
      body: "{}",
    }));
    const originResponse = await POST(new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        host: "example.test",
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      body: "{}",
    }));

    expect(hostResponse.status).toBe(403);
    expect(originResponse.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not keep localhost in the production host allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(new Request("http://localhost:3100/mcp", {
      method: "POST",
      headers: { host: "localhost:3100", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
