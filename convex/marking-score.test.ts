import { beforeEach, expect, it, vi } from "vitest";

import { recordQuestionScore } from "./marking";
import { requireOwnedSubmission } from "./model/auth";
import type { MutationCtx } from "./_generated/server";

vi.mock("./model/auth", () => ({
  requireAuthenticatedUser: vi.fn(),
  requireOwnedSubmission: vi.fn(),
}));

type Handler = (ctx: MutationCtx, args: Record<string, unknown>) => Promise<{ scoreId: string | null; updatedAt: number | null; conflict: Record<string, unknown> | null }>;
const handler = (recordQuestionScore as unknown as { _handler: Handler })._handler;

const existing = { _id: "score_1", awardedMarks: 2, maxMarks: 4, needsReview: false, rationale: "Other tab", scoreStatus: "confirmed", updatedAt: 200 };
const score = { awardedMarks: 3, maxMarks: 4, confidence: 1, needsReview: false, rationale: "Mine", evidenceJson: "{}", scorerProvider: "manual", scorerModel: "manual", scoreStatus: "confirmed" };

function context(stored: typeof existing | null) {
  const patch = vi.fn();
  const insert = vi.fn().mockResolvedValue("inserted");
  const chain = (table: string) => {
    const self = { withIndex: () => self, filter: () => self, unique: async () => (table === "markingScores" ? stored : null), collect: async () => [] };
    return self;
  };
  const ctx = { db: { query: vi.fn(chain), get: vi.fn().mockResolvedValue(null), patch, insert } } as unknown as MutationCtx;
  return { ctx, patch, insert };
}

beforeEach(() => {
  vi.mocked(requireOwnedSubmission).mockResolvedValue({ submission: {} } as never);
});

it("refuses a confirmation made against a stale revision and returns the current score", async () => {
  const { ctx, patch } = context(existing);
  const result = await handler(ctx, { submissionId: "sub", questionKey: "q1", score, status: "saved", expectedUpdatedAt: 100 });
  expect(result.conflict).toMatchObject({ awardedMarks: 2, rationale: "Other tab", updatedAt: 200 });
  expect(patch).not.toHaveBeenCalled();
});

it("treats a repeated identical confirmation as success without writing again", async () => {
  const { ctx, patch } = context(existing);
  const result = await handler(ctx, { submissionId: "sub", questionKey: "q1", score: { ...score, awardedMarks: 2, rationale: "Other tab" }, status: "saved", expectedUpdatedAt: 100 });
  expect(result).toEqual({ scoreId: "score_1", updatedAt: 200, conflict: null });
  expect(patch).not.toHaveBeenCalled();
});

it("writes when the expected revision matches", async () => {
  const { ctx, patch } = context(existing);
  const result = await handler(ctx, { submissionId: "sub", questionKey: "q1", score, status: "saved", expectedUpdatedAt: 200 });
  expect(result.conflict).toBeNull();
  expect(patch).toHaveBeenCalledWith("markingScores", "score_1", expect.objectContaining({ awardedMarks: 3 }));
});

it("keeps automated writers unconditional but never lets them replace a confirmed score", async () => {
  const { ctx, patch } = context(existing);
  await handler(ctx, { submissionId: "sub", questionKey: "q1", score: { ...score, scoreStatus: "ai_suggested" }, status: "ai_scored" });
  expect(patch).not.toHaveBeenCalledWith("markingScores", expect.anything(), expect.anything());
});
