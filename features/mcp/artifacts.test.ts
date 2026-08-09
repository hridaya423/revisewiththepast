import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  getMcpServiceSecret: vi.fn(() => "s".repeat(32)),
}));

vi.mock("./infrastructure/convex-client", () => ({
  getMcpConvexClient: () => ({ mutation: mocks.mutation }),
  getMcpServiceSecret: mocks.getMcpServiceSecret,
}));

import { uploadMcpArtifact } from "./artifacts";

describe("MCP artifact storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("uploads and registers a PDF with its temporary HTTPS URL", async () => {
    mocks.mutation
      .mockResolvedValueOnce("https://convex.example/upload")
      .mockResolvedValueOnce({
        fileName: "paper.pdf",
        url: "https://convex.example/storage/paper",
         fileSize: 5,
        contentType: "application/pdf",
      });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ storageId: "storage-1" }), { status: 200 }));

    const result = await uploadMcpArtifact({
      bundleId: "bundle_1",
      kind: "paper",
      fileName: "paper.pdf",
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      expiresAt: Date.now() + 60_000,
    });

    expect(result).toEqual({
      fileName: "paper.pdf",
      url: "https://convex.example/storage/paper",
      size: 5,
      mimeType: "application/pdf",
    });
    expect(fetch).toHaveBeenCalledWith("https://convex.example/upload", expect.objectContaining({ method: "POST" }));
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
  });

  it("cleans an uploaded object when metadata registration fails", async () => {
    mocks.mutation
      .mockResolvedValueOnce("https://convex.example/upload")
      .mockRejectedValueOnce(new Error("registration failed"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ storageId: "storage-2" }), { status: 200 }));

    await expect(uploadMcpArtifact({
      bundleId: "bundle_2",
      kind: "paper",
      fileName: "paper.pdf",
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      expiresAt: Date.now() + 60_000,
    })).rejects.toThrow("Artifact registration failed.");
    expect(mocks.mutation).toHaveBeenCalledTimes(3);
  });

  it("rejects non-PDF bytes before creating an upload URL", async () => {
    await expect(uploadMcpArtifact({
      bundleId: "bundle_3",
      kind: "paper",
      fileName: "paper.pdf",
      bytes: new Uint8Array([1, 2, 3]),
      expiresAt: Date.now() + 60_000,
    })).rejects.toThrow("valid PDF");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
