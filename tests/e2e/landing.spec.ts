import { expect, test } from "@playwright/test";

test("shows the landing promise and primary action immediately", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Build a paper from what you’ve studied." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Build a paper" }).first()).toBeVisible();
  const heroBox = await page.locator("[data-landing-hero]").boundingBox();
  expect(heroBox?.height).toBeGreaterThanOrEqual(650);
});

test("shows the handwritten response with marking annotations", async ({ page }) => {
  await page.goto("/#marking-proof");

  await expect(page.getByText("Explain how flood defences can reduce the impact of flooding.")).toBeVisible();
  await expect(page.getByRole("img", { name: /handwritten flood defence response/i })).toBeVisible();
  await expect(page.locator("[data-rough-target], [data-rough-annotation]")).toHaveCount(0);
  await expect(page.locator("[data-answer-highlight]")).toHaveCount(2);
  await expect(page.locator("[data-evidence-connectors]")).toBeVisible();
  await expect(page.locator("[data-evidence-connector]")).toHaveCount(3);
  await expect(page.locator("[data-score-emphasis]")).toBeVisible();
  const evidenceRows = page.locator("[data-proof-evidence] > div");
  await expect(evidenceRows.nth(0)).toContainText("Assertion only — no credit");
  await expect(evidenceRows.nth(1)).toContainText("AO1 · 2/2");
  await expect(evidenceRows.nth(2)).toContainText("AO2 · 2/4");
  await expect(page.getByText("Why this stops at 4/6")).toBeVisible();
  await expect(page.getByText("Student response")).toHaveCount(0);
  await expect(page.getByText("03 · Link")).toHaveCount(0);
});
