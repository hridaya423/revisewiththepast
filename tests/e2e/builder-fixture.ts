import type { Page } from "@playwright/test";

export async function mockBuilderServices(page: Page) {
  await page.route("**/api/auth/**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/paper-maker/subject-detail?*", (route) => {
    const key = new URL(route.request().url()).searchParams.get("subjectKey");
    const topics = key === "aqa-business"
      ? [
        { id: "purpose", label: "3.1.1 The purpose and nature of businesses", leafTopicIds: ["purpose"], questionUnitCount: 8 },
        { id: "ownership", label: "3.1.2 Business ownership", leafTopicIds: ["ownership"], questionUnitCount: 6 },
      ]
      : [{ id: "hazards", label: "Natural hazards", leafTopicIds: ["hazards"], questionUnitCount: 8 }];
    return route.fulfill({
      json: { key, taggedQuestionUnits: 14, benchmarkMinutesPerMark: 1, topics, tiers: [], detailLoaded: true },
    });
  });
}
