import { expect, test } from "@playwright/test";

test("shows the landing promise and primary action immediately", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Build a paper from what you’ve studied." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Build a paper" }).first()).toBeVisible();
});

test("includes the landing promise in the server response", async ({ request }) => {
  const response = await request.get("/");

  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Build a paper from what you’ve studied.");
});
