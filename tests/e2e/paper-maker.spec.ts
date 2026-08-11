import { expect, test } from "@playwright/test";

test("loads the subject stage and supports keyboard selection", async ({ page }) => {
  await page.goto("/paper-maker");

  await expect(page.getByRole("heading", { name: "Build a practice paper" })).toBeVisible();
  const geography = page.getByRole("button", { name: /Geography/ }).first();
  await geography.focus();
  await expect(geography).toBeFocused();
  await geography.press("Enter");
  await expect(page).toHaveURL(/subject=aqa-geography/);
  await expect(page.getByRole("heading", { name: "Choose focus topics" })).toBeFocused();
});
