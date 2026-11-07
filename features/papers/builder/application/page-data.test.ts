import { describe, expect, it, vi } from "vitest";

import { getPaperMakerPageData } from "./page-data";

vi.mock("../../infrastructure/question-bank", () => ({
  getTaggingCountsFromConvex: vi.fn().mockRejectedValue(new Error("Deployment is disabled")),
}));

describe("builder page data", () => {
  it("serves the course catalogue without requiring a running database", async () => {
    const page = await getPaperMakerPageData({ requestedSubject: "aqa-geography" });
    expect(page.initialSubjectKey).toBe("aqa-geography");
    expect(page.subjectOptions.length).toBeGreaterThan(0);
    expect(page.subjectOptions.every((subject) => subject.generationEnabled)).toBe(true);
    expect(page.subjectOptions.find((subject) => subject.key === "aqa-geography")).toMatchObject({
      detailLoaded: false,
      topics: [],
    });
  });

  it("ignores unknown courses and tiers without losing an explicit topic request", async () => {
    const page = await getPaperMakerPageData({
      requestedSubject: "missing",
      requestedTier: "unknown",
      requestedTopics: ["topic"],
    });
    expect(page.initialSubjectKey).toBeUndefined();
    expect(page.initialTier).toBeUndefined();
    expect(page.initialTopicIds).toEqual(["topic"]);
  });
});
