import { expect, test, type Page } from "@playwright/test";

async function createAccount(page: Page) {
  const email = `navigation-${Date.now()}-${test.info().workerIndex}@example.com`;
  await page.goto("/auth?redirect=/paper-maker");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Navigation Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("revision-test-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page).toHaveURL(/\/paper-maker/, { timeout: 10_000 });
}

test("top navigation preserves the shell and updates the active section", async ({ page }) => {
  await createAccount(page);

  const build = page.getByRole("navigation", { name: "Product navigation" }).getByRole("link", { name: "Build" });
  const mark = page.getByRole("navigation", { name: "Product navigation" }).getByRole("link", { name: "Mark" });
  await expect(build).toHaveAttribute("aria-current", "page");

  await mark.click();
  await expect(page.getByRole("heading", { name: "Mark your papers" })).toBeVisible();
  await expect(mark).toHaveAttribute("aria-current", "page");

  await build.click();
  await expect(page.getByRole("heading", { name: "Build a practice paper" })).toBeVisible();
  await expect(build).toHaveAttribute("aria-current", "page");
});

test("navigation remains usable with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/paper-maker");
  await page.getByRole("navigation", { name: "Product navigation" }).getByRole("link", { name: "Mark" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("account menu supports arrow keys, Escape, and focus return", async ({ page }) => {
  await createAccount(page);

  const trigger = page.getByRole("button", { name: "Open account menu" });
  await trigger.click();
  const markingItem = page.getByRole("menuitem", { name: "Self-mark your papers" });
  const signOutItem = page.getByRole("menuitem", { name: "Sign out" });
  await expect(markingItem).toBeFocused();
  await markingItem.press("ArrowDown");
  await expect(signOutItem).toBeFocused();
  await signOutItem.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toBeHidden();
});
