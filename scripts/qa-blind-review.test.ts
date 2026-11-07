import { describe, expect, it } from "vitest";

import { blindPairMetadata, decideBlindReviewGate, pairEveryGeneratedPage } from "./qa-blind-review";

describe("QA blind review", () => {
  it("pairs every generated page across the full reference document", () => {
    expect(pairEveryGeneratedPage(4, 6)).toEqual([
      { generatedPage: 1, referencePage: 1 },
      { generatedPage: 2, referencePage: 3 },
      { generatedPage: 3, referencePage: 4 },
      { generatedPage: 4, referencePage: 6 },
    ]);
  });

  it("keeps the reviewer record free of the answer key", () => {
    const pair = blindPairMetadata({
      pairId: "0012",
      artifact: "mark-scheme",
      generatedPage: 3,
      referencePage: 8,
      oursFirst: false,
      reviewMode: "visual",
    });

    expect(pair.review).toEqual({
      pairId: "0012",
      artifact: "mark-scheme",
      generatedPage: 3,
      referencePage: 8,
      reviewMode: "visual",
      status: "pending",
    });
    expect(JSON.stringify(pair.review)).not.toContain("ours");
    expect(pair.key).toEqual({ pairId: "0012", oursSide: "B" });
  });

  it("passes only when every page has an accepted review", () => {
    const reviewed = [
      { pairId: "0001", artifact: "question-paper", generatedPage: 1, referencePage: 1, reviewMode: "visual", status: "pass" },
      { pairId: "0002", artifact: "mark-scheme", generatedPage: 1, referencePage: 1, reviewMode: "visual", status: "pass" },
    ] as const;

    expect(decideBlindReviewGate(reviewed)).toEqual({ ok: true, failures: [] });
    expect(decideBlindReviewGate([{ ...reviewed[0], status: "pending" }])).toEqual({
      ok: false,
      failures: ["visual-review-pending:0001"],
    });
    expect(decideBlindReviewGate([{ ...reviewed[0], status: "fail" }])).toEqual({
      ok: false,
      failures: ["visual-review-failed:0001"],
    });
    expect(decideBlindReviewGate([])).toEqual({ ok: false, failures: ["visual-review-empty"] });
  });
});
