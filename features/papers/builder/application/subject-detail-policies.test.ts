import { describe, expect, it } from "vitest";
import { PAPER_MAKER_SUBJECTS } from "../domain/subjects";
import { buildSubjectDetailParts } from "./subject-detail-policies";

describe("subject detail policies", () => {
  it("has a policy shape for every registered subject", () => {
    for (const subject of PAPER_MAKER_SUBJECTS) {
      const result = buildSubjectDetailParts(subject, []);
      expect(result.topics).toEqual(expect.any(Array));
      expect(result.tiers).toHaveLength(subject.tiers.length);
      if (subject.tiers.length > 0) {
        expect(result.topicsByTier).toEqual(expect.objectContaining({ foundation: expect.any(Array), higher: expect.any(Array) }));
      }
    }
  });
});
