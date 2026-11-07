import { expect, it, vi } from "vitest";

import { createMarkingSubmission } from "./marking";
import type { MutationCtx } from "./_generated/server";

vi.mock("./model/auth", () => ({
  requireAuthenticatedUser: vi.fn().mockResolvedValue({ _id: "student" }),
  requireOwnedSubmission: vi.fn(),
}));

function context() {
  const insert = vi.fn().mockResolvedValue("new-attempt");
  const ctx = {
    db: {
      get: vi.fn().mockResolvedValue({ ownerId: "student", title: "Paper", questionCount: 8 }),
      query: vi.fn(() => ({ withIndex: () => ({ collect: vi.fn().mockResolvedValue([
        { _id: "reviewed", ownerId: "student", updatedAt: 200, summary: { confirmedCount: 8 } },
        { _id: "unfinished", ownerId: "student", updatedAt: 100, summary: { confirmedCount: 2 } },
      ]) }) })),
      insert,
    },
  } as unknown as MutationCtx;
  return { ctx, insert };
}

const handler = (createMarkingSubmission as unknown as { _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<string> })._handler;
const input = { savedPaperId: "paper", boardCode: "aqa", subjectSlug: "business", subjectKey: "aqa-business", importSource: "saved_paper" };

it("resumes unfinished work by default without creating another attempt", async () => {
  const { ctx, insert } = context();
  expect(await handler(ctx, input)).toBe("unfinished");
  expect(insert).not.toHaveBeenCalled();
});

it("creates another attempt only when explicitly requested", async () => {
  const { ctx, insert } = context();
  expect(await handler(ctx, { ...input, newAttempt: true })).toBe("new-attempt");
  expect(insert.mock.calls[0][1]).not.toHaveProperty("newAttempt");
});
