import { expect, test } from "@playwright/test";

test("switches authentication modes and exposes inline errors", async ({ page }) => {
  await page.goto("/auth");

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByText("Name is required")).toBeVisible();
  await expect(page.getByText("Email is required")).toBeVisible();
  await expect(page.getByText("Password is required")).toBeVisible();
});
