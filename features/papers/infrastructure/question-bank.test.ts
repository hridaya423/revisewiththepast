import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
  },
}));

vi.mock("@/shared/infrastructure/env/server", () => ({
  getConvexUrl: () => "https://example.convex.cloud",
  getServerEnvironment: () => ({}),
}));

import { getPaperMakerQuestionBankFromConvex } from "./question-bank";

describe("question bank cache", () => {
  beforeEach(() => query.mockReset());

  it("coalesces concurrent cached reads for the same subject", async () => {
    query.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { questionParts: [{ partKey: "part-1" }] };
    });

    const reads = await Promise.all([
      getPaperMakerQuestionBankFromConvex("test-board", "test-subject", { cache: true }),
      getPaperMakerQuestionBankFromConvex("test-board", "test-subject", { cache: true }),
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(reads[0]).toBe(reads[1]);
  });
});
