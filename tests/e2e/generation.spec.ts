import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import type { GenerationJobSnapshot } from "../../features/papers/builder/domain/generation-job";
import { mockBuilderServices } from "./builder-fixture";

const jobId = "3d3d793b-5ba2-42eb-9292-0be4d22b617a";
function readyJob(): GenerationJobSnapshot {
  return {
    jobId, subjectKey: "aqa-business", status: "succeeded", message: "Your paper is ready.",
    progress: 1, totalPapers: 1, completedPapers: 1, includeMarkScheme: true,
    resultFileName: "practice-pack.pdf", error: null, createdAt: Date.now(), updatedAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
    papers: [{
      index: 0, fileName: "practice-paper.pdf", questionCount: 8, totalMarks: 20,
      timeMinutes: 20, coveredTopics: 1, selectedUnitKeys: ["example"],
      selectedUnitMarks: [20], generationReceiptId: null,
      markSchemeGenerated: false, markSchemeWarning: "The mark scheme is unavailable. Your question paper is ready.",
    }],
  };
}

test.beforeEach(async ({ page }) => {
  await mockBuilderServices(page);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Original interface test paper");
  const bytes = Buffer.from(await pdf.save());
  await page.route("**/api/paper-maker/generation-jobs/download?*", (route) => route.fulfill({
    contentType: "application/pdf", body: bytes,
    headers: { "Content-Disposition": "attachment; filename=practice-paper.pdf" },
  }));
});

test("restores an existing result without starting another job and keeps partial success useful", async ({ page }) => {
  let starts = 0;
  await page.route("**/api/paper-maker/generation-jobs", (route) => { starts += 1; return route.fulfill({ json: readyJob() }); });
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => route.fulfill({ json: readyJob() }));
  await page.goto(`/paper-maker?job=${jobId}`);
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeVisible();
  await expect(page.getByText("The mark scheme is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download paper", exact: true })).toBeEnabled();
  await expect(page.locator("object")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to keep paper" })).toHaveAttribute("href", `/auth?redirect=${encodeURIComponent(`/paper-maker?job=${jobId}`)}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeVisible();
  expect(starts).toBe(0);
});

test("returns to a paper after leaving its result and restores focus to settings", async ({ page }) => {
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => route.fulfill({ json: readyJob() }));
  await page.goto(`/paper-maker?job=${jobId}`);
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeFocused();
  await page.getByRole("button", { name: "Back to paper settings" }).click();
  await expect(page.getByRole("heading", { name: "Choose your course", exact: true })).toBeFocused();
  await page.goto("/paper-maker");
  await page.getByRole("button", { name: "Continue recent paper" }).click();
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeFocused();
});

test("a failed first-page image leaves the real paper available", async ({ page }) => {
  const job = readyJob();
  job.papers[0].previewReady = true;
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => route.fulfill({ json: job }));
  await page.route("**/api/paper-maker/generation-jobs/download?*part=preview-0*", (route) => route.fulfill({ status: 404 }));
  await page.goto(`/paper-maker?job=${jobId}`);
  await expect(page.getByText("Open the paper to read, print or share", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: "First page of your generated paper" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download paper", exact: true })).toBeEnabled();
});

test("retries a failed scheme without creating a second question paper", async ({ page }) => {
  let retries = 0;
  let starts = 0;
  let current = readyJob();
  await page.route("**/api/paper-maker/generation-jobs", (route) => { starts += 1; return route.fulfill({ json: readyJob() }); });
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => route.fulfill({ json: current }));
  await page.route("**/api/paper-maker/generation-jobs/retry-scheme", (route) => {
    retries += 1;
    expect(route.request().postDataJSON()).toMatchObject({ jobId, paperIndex: 0, runVersion: 0 });
    current = { ...readyJob(), runVersion: 1, papers: [{ ...readyJob().papers[0], markSchemeGenerated: true, markSchemeWarning: null }] };
    return route.fulfill({ json: current });
  });
  await page.goto(`/paper-maker?job=${jobId}`);
  await page.getByRole("button", { name: "Retry mark scheme", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download mark scheme", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download paper", exact: true })).toBeEnabled();
  expect(retries).toBe(1);
  expect(starts).toBe(0);
});

test("starts once, resumes after refresh and does not claim the browser downloaded a file", async ({ page }) => {
  let starts = 0;
  let polls = 0;
  await page.route("**/api/paper-maker/generation-jobs", (route) => {
    starts += 1;
    expect(route.request().postDataJSON().requestKey).toMatch(/^[a-f0-9-]{36}$/);
    return route.fulfill({ json: { ...readyJob(), status: "queued", papers: [], completedPapers: 0 } });
  });
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => {
    polls += 1;
    return route.fulfill({ json: polls < 3 ? { ...readyJob(), status: "generating", papers: [], completedPapers: 0 } : readyJob() });
  });
  await page.goto("/paper-maker?subject=aqa-business");
  await page.getByRole("checkbox", { name: /Select 3\.1\.1/ }).click();
  await page.getByRole("button", { name: "Continue to paper setup" }).first().click();
  await page.getByRole("button", { name: "Create paper", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`job=${jobId}`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeVisible();
  await expect(page.getByText("generated and downloaded", { exact: false })).toHaveCount(0);
  expect(starts).toBe(1);
});

test("shows authoritative completion when Stop races with a finished job", async ({ page }) => {
  let finished = false;
  await page.route("**/api/paper-maker/generation-jobs?*", (route) => route.fulfill({
    json: finished ? readyJob() : { ...readyJob(), status: "generating", papers: [], completedPapers: 0 },
  }));
  await page.route("**/api/paper-maker/generation-jobs/cancel", (route) => {
    finished = true;
    return route.fulfill({ json: readyJob() });
  });
  await page.goto(`/paper-maker?job=${jobId}`);
  await page.getByRole("button", { name: "Stop preparation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your paper is ready." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download paper", exact: true })).toBeEnabled();
});
