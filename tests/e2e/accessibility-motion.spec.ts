import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("reduced motion keeps core landing and builder content available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Practise the topics you need." })).toBeVisible();

  await page.goto("/paper-maker");
  await expect(page.getByRole("heading", { name: "Build a practice paper" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Geography/ }).first()).toBeVisible();
});
