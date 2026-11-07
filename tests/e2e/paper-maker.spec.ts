import { expect, test } from "@playwright/test";
import { mockBuilderServices } from "./builder-fixture";

test.beforeEach(async ({ page }) => {
  await mockBuilderServices(page);
});

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

test("restores topics and paper length after refresh and supports browser Back", async ({ page }) => {
  await page.goto("/paper-maker?subject=aqa-business");
  await page.getByRole("checkbox", { name: /Select 3\.1\.1/ }).click();
  await page.getByRole("button", { name: "Continue to paper setup" }).first().click();
  await page.getByRole("button", { name: "20 min", exact: true }).click();
  await expect(page.getByLabel("Estimated minutes")).toHaveValue("20");
  await page.reload();
  await expect(page.getByLabel("Estimated minutes")).toHaveValue("20");
  await expect(page.getByText("Your saved paper settings are restored.")).toBeVisible();
  await page.getByRole("button", { name: "Back to topics" }).click();
  await expect(page.getByRole("checkbox", { name: /Deselect 3\.1\.1/ })).toBeChecked();
  await page.goBack();
  await expect(page.getByLabel("Estimated minutes")).toHaveValue("20");
});

test("keeps selected topics when filtering and explains empty search results", async ({ page }) => {
  await page.goto("/paper-maker?subject=aqa-business");
  await page.getByRole("checkbox", { name: /Select 3\.1\.1/ }).click();
  await page.getByRole("searchbox", { name: "Search topics" }).fill("no matching topic");
  await expect(page.getByText(/No topics match/)).toBeVisible();
  await page.getByRole("button", { name: "Clear topic search" }).click();
  await expect(page.getByRole("checkbox", { name: /Deselect 3\.1\.1/ })).toBeChecked();
});

test("recovers a failed course request without restarting the builder", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/paper-maker/subject-detail?*", async (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, body: "The course service is temporarily unavailable." });
    return route.fallback();
  });
  await page.goto("/paper-maker?subject=aqa-business");
  await expect(page.getByRole("alert").filter({ hasText: "We could not load" })).toBeVisible();
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(page.getByRole("checkbox", { name: /Select 3\.1\.1/ })).toBeVisible();
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
