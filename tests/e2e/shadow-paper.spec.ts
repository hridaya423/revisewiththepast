import { expect, test, type Page, type Route } from "@playwright/test";

import type { ShadowJob } from "../../features/papers/shadow/presentation/state";

// Needs the dev server started with SHADOW_PAPERS_ENABLED=1 and SHADOW_PAPERS_ALLOW_DRAFT=1 until the pilot manifest is approved.
const PAPER = "edexcel-gcse-mathematics-higher-2019-june-paper-1";
const JOB = "k57a2b3c4d5e6f7g8h9j0kmnpqrs";
const VARIANT = "j97a2b3c4d5e6f7g8h9j0kmnpqrs";
const now = Date.now();

test.describe.configure({ timeout: 90_000 });

const variant = {
  variantId: VARIANT, displayCode: "SH-ABCD-EFGH", title: "Shadow of Edexcel June 2019 Paper 1H", totalMarks: 80, durationMinutes: 90,
  questionCount: 22, paperPages: 23, markSchemePages: 14, createdAt: now, expiresAt: now + 7 * 86_400_000, savedPaperId: null,
};

function job(overrides: Partial<ShadowJob> = {}): ShadowJob {
  return {
    jobId: JOB, status: "queued", sourcePaperId: PAPER, manifestRevision: "2026-11-01.1",
    progress: { completedUnits: 0, totalUnits: 22 }, cancelRequested: false, createdAt: now, updatedAt: now, variant: null, ...overrides,
  };
}

async function signIn(page: Page) {
  await page.route("**/api/auth/**", (route) => route.fulfill({
    json: {
      session: { id: "s", userId: "u", token: "t", expiresAt: new Date(now + 86_400_000).toISOString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
      user: { id: "u", name: "Sam Student", email: "sam@example.com", emailVerified: true, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
    },
  }));
}

async function openShadowPage(page: Page, query = "") {
  await page.goto(`/paper-maker?mode=shadow${query}`);
  const heading = page.getByRole("heading", { name: "Shadow paper", level: 1 });
  const enabled = await heading.waitFor({ timeout: 30_000 }).then(() => true, () => false);
  test.skip(!enabled, "Shadow papers are not enabled on this server.");
}

test("signed-out students keep their selection through sign-in", async ({ page }) => {
  await page.route("**/api/auth/**", (route) => route.fulfill({ json: null }));
  await openShadowPage(page);
  await expect(page.getByRole("radio", { name: /June 2019/ })).toBeChecked();
  await expect(page.getByRole("link", { name: "Sign in to generate" })).toHaveAttribute("href", `/auth?redirect=${encodeURIComponent(`/paper-maker?mode=shadow&paper=${PAPER}`)}`);
});

test("generates, survives a refresh, downloads, saves once and makes another version", async ({ page }) => {
  await signIn(page);
  const starts: string[] = [];
  let polls = 0;
  let saves = 0;
  await page.route("**/api/paper-maker/shadow-jobs", (route: Route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string; sourcePaperId: string };
    expect(body.sourcePaperId).toBe(PAPER);
    starts.push(body.idempotencyKey);
    return route.fulfill({ status: 202, json: { job: job() } });
  });
  await page.route("**/api/paper-maker/shadow-jobs/active", (route) => route.fulfill({ json: { job: null } }));
  await page.route(`**/api/paper-maker/shadow-jobs/${JOB}`, (route) => {
    polls += 1;
    if (polls < 2) return route.fulfill({ json: { job: job({ status: "generating", progress: { completedUnits: 9, totalUnits: 22 } }) } });
    return route.fulfill({ json: { job: job({ status: "ready", progress: { completedUnits: 22, totalUnits: 22 }, variant }) } });
  });
  await page.route(`**/api/paper-maker/shadow-variants/${VARIANT}/save`, (route) => {
    saves += 1;
    return route.fulfill({ status: 201, json: { savedPaperId: "saved-1", created: true } });
  });

  await openShadowPage(page, `&paper=${PAPER}`);
  await page.getByRole("button", { name: "Generate shadow paper" }).click();
  await expect(page).toHaveURL(new RegExp(`job=${JOB}`));
  await expect(page.getByText(/Writing new questions · 9 of 22|ready/u)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Your shadow paper is ready/ })).toBeVisible();
  await expect(page.getByText("SH-ABCD-EFGH")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download paper" })).toHaveAttribute("href", `/api/paper-maker/shadow-variants/${VARIANT}/download?kind=paper`);
  await expect(page.getByRole("link", { name: "Download mark scheme" })).toHaveAttribute("href", `/api/paper-maker/shadow-variants/${VARIANT}/download?kind=mark-scheme`);
  expect(starts).toHaveLength(1);

  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByRole("button", { name: "Saved to your papers" })).toBeDisabled();
  expect(saves).toBe(1);

  await page.getByRole("button", { name: "Generate another version" }).click();
  await expect.poll(() => starts.length).toBe(2);
  expect(starts[1]).not.toBe(starts[0]);
});

test("cancelling lands on a cancelled state and returns to the chooser", async ({ page }) => {
  await signIn(page);
  let cancelled = false;
  await page.route(`**/api/paper-maker/shadow-jobs/${JOB}`, (route) => route.fulfill({
    json: { job: cancelled ? job({ status: "cancelled", cancelRequested: true }) : job({ status: "rendering" }) },
  }));
  await page.route(`**/api/paper-maker/shadow-jobs/${JOB}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({ json: { job: job({ status: "cancelled", cancelRequested: true }) } });
  });
  await openShadowPage(page, `&paper=${PAPER}&job=${JOB}`);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Generation cancelled" })).toBeVisible();
  await page.getByRole("button", { name: "Choose another paper" }).click();
  await expect(page).not.toHaveURL(/job=/u);
});

test("a job owned by someone else shows the chooser, not their paper", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/paper-maker/shadow-jobs/active", (route) => route.fulfill({ json: { job: null } }));
  await page.route(`**/api/paper-maker/shadow-jobs/${JOB}`, (route) => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } }));
  await openShadowPage(page, `&paper=${PAPER}&job=${JOB}`);
  await expect(page.getByText(/could not find that generation/u)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download paper" })).toHaveCount(0);
});
