import { expect, test } from "@playwright/test";

test("shows the landing promise and primary action immediately", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1, name: "Practise the topics you need." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Build a paper" }).first()).toBeVisible();
  await expect(page.locator("[data-hero-paper]").getByText("Illustrative example")).toBeVisible();
});

test("lists the enabled courses as direct builder links", async ({ page }) => {
  await page.goto("/#subjects");

  const directory = page.locator("[data-course-directory]");
  await expect(directory.getByRole("heading", { name: "Geography" })).toBeVisible();
  await expect(directory.getByRole("link", { name: "Build a AQA Geography paper" })).toHaveAttribute("href", "/paper-maker?subject=aqa-geography");
  expect(await directory.getByRole("link").count()).toBeGreaterThanOrEqual(10);
});

test("labels the marking demonstration as an illustrative example", async ({ page }) => {
  await page.goto("/#marking-proof");

  const proof = page.locator("#marking-proof");
  await expect(proof.getByText("Illustrative example")).toBeVisible();
  await expect(proof.getByText("Suggested marks are yours to check.")).toBeVisible();
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

test("links to support and policy pages that exist", async ({ page }) => {
  for (const [name, heading] of [["Support", "Support"], ["Privacy", "Privacy policy"], ["Terms", "Terms of use"]] as const) {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Footer navigation" }).getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "hridyaagrawal4@gmail.com" }).first()).toHaveAttribute("href", "mailto:hridyaagrawal4@gmail.com");
  }
});
