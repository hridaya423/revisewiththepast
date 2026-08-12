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

test("aligns the topic actions on one footer baseline", async ({ page }) => {
  await page.goto("/paper-maker?subject=aqa-business");
  await page.getByRole("checkbox", { name: /Select 3\.1\.1 The purpose and nature of businesses/ }).click();

  const clear = page.getByRole("button", { name: "Clear selected topics" });
  const continueButton = page.getByRole("button", { name: "Continue to paper setup" }).first();
  await expect(clear).toBeVisible();
  await expect(continueButton).toBeVisible();

  const clearBox = await clear.boundingBox();
  const continueBox = await continueButton.boundingBox();
  expect(clearBox).not.toBeNull();
  expect(continueBox).not.toBeNull();
  expect(Math.abs((clearBox!.y + clearBox!.height / 2) - (continueBox!.y + continueBox!.height / 2))).toBeLessThan(2);
});
