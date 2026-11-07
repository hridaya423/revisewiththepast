import { describe, expect, it } from "vitest";

import {
  downloadHref,
  initialShadowState,
  newIdempotencyKey,
  pollDelay,
  progressLabel,
  shadowReducer,
  signInHref,
  type ShadowEvent,
  type ShadowJob,
  type ShadowState,
} from "./state";

const PAPER = "edexcel-gcse-mathematics-higher-2019-june-paper-1";

function job(overrides: Partial<ShadowJob> = {}): ShadowJob {
  return {
    jobId: "job-1",
    status: "queued",
    sourcePaperId: PAPER,
    manifestRevision: "2026-11-01.1",
    progress: { completedUnits: 0, totalUnits: 22 },
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
    variant: null,
    ...overrides,
  };
}

const variant = { variantId: "variant-1", displayCode: "SH-ABCD-EFGH", title: "Shadow paper", totalMarks: 80, durationMinutes: 90, questionCount: 22, paperPages: 23, markSchemePages: 14, createdAt: 1, expiresAt: 10, savedPaperId: null };

const run = (events: ShadowEvent[], state: ShadowState = initialShadowState({ sourcePaperId: null, jobId: null })) => events.reduce(shadowReducer, state);

describe("shadow workspace state", () => {
  it("selects a source and starts generation", () => {
    const state = run([{ type: "select", sourcePaperId: PAPER }, { type: "start", idempotencyKey: "k".repeat(20) }]);
    expect(state).toEqual({ phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
  });

  it("cannot start without a selected source", () => {
    expect(run([{ type: "start", idempotencyKey: "k".repeat(20) }]).phase).toBe("choose");
  });

  it("preserves the selection through sign-in", () => {
    expect(initialShadowState({ sourcePaperId: PAPER, jobId: null })).toMatchObject({ phase: "choose", sourcePaperId: PAPER });
    expect(decodeURIComponent(signInHref(PAPER))).toBe(`/auth?redirect=/paper-maker?mode=shadow&paper=${PAPER}`);
  });

  it("shows running progress and restores a job after refresh", () => {
    const restored = initialShadowState({ sourcePaperId: PAPER, jobId: "job-1" });
    expect(restored.phase).toBe("restoring");
    const running = shadowReducer(restored, { type: "job", job: job({ status: "generating", progress: { completedUnits: 8, totalUnits: 22 } }) });
    expect(running.phase).toBe("running");
    if (running.phase === "running") expect(progressLabel(running.job)).toBe("Writing new questions · 8 of 22");
  });

  it("returns to the chooser when a restored job is missing or belongs to someone else", () => {
    const state = run([{ type: "job-missing" }], initialShadowState({ sourcePaperId: PAPER, jobId: "job-9" }));
    expect(state).toMatchObject({ phase: "choose", sourcePaperId: PAPER });
    if (state.phase === "choose") expect(state.notice).toMatch(/could not find/u);
  });

  it("keeps the last known state while offline and resumes on reconnect", () => {
    const running = run([{ type: "select", sourcePaperId: PAPER }, { type: "start", idempotencyKey: "k".repeat(20) }, { type: "job", job: job({ status: "generating" }) }, { type: "offline" }]);
    expect(running).toMatchObject({ phase: "running", offline: true, job: { status: "generating" } });
    expect(pollDelay(0, true)).toBeGreaterThan(pollDelay(0, false));
    expect(shadowReducer(running, { type: "online" })).toMatchObject({ phase: "running", offline: false });
  });

  it("ignores status for a different job", () => {
    const running = run([{ type: "job", job: job({ status: "generating" }) }], { phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
    expect(shadowReducer(running, { type: "job", job: job({ jobId: "job-2", status: "ready", variant }) })).toBe(running);
  });

  it("records cancellation intent and lands on cancelled", () => {
    let state = run([{ type: "job", job: job({ status: "rendering" }) }], { phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
    state = shadowReducer(state, { type: "cancel" });
    expect(state).toMatchObject({ phase: "running", cancelling: true });
    state = shadowReducer(state, { type: "job", job: job({ status: "cancelled", cancelRequested: true }) });
    expect(state).toEqual({ phase: "cancelled", sourcePaperId: PAPER });
    expect(shadowReducer(state, { type: "back" })).toMatchObject({ phase: "choose", sourcePaperId: PAPER });
  });

  it("explains failures without solver internals and keeps the selection", () => {
    const state = run([{ type: "job", job: job({ status: "failed", errorCode: "NO_VALID_VARIANT" }) }], { phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
    expect(state).toMatchObject({ phase: "failed", sourcePaperId: PAPER, retryable: true });
    if (state.phase === "failed") expect(state.message).not.toMatch(/NO_VALID|constraint|seed/u);
  });

  it("maps start failures to clear notices", () => {
    const state = shadowReducer({ phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) }, { type: "start-failed", code: "ACTIVE_JOB_LIMIT", message: "x" });
    expect(state).toMatchObject({ phase: "choose", sourcePaperId: PAPER });
    if (state.phase === "choose") expect(state.notice).toMatch(/already have/u);
  });

  it("is ready with stable downloads, and retrying save never requests a new variant", () => {
    let state = run([{ type: "job", job: job({ status: "ready", variant }) }], { phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
    expect(state.phase).toBe("ready");
    expect(downloadHref("variant-1", "paper")).toBe(downloadHref("variant-1", "paper"));
    state = shadowReducer(state, { type: "save" });
    state = shadowReducer(state, { type: "save-failed" });
    expect(state).toMatchObject({ phase: "ready", save: { status: "error" }, variant: { variantId: "variant-1" } });
    state = shadowReducer(state, { type: "save" });
    state = shadowReducer(state, { type: "saved", savedPaperId: "saved-1" });
    expect(state).toMatchObject({ phase: "ready", save: { status: "saved", savedPaperId: "saved-1" }, variant: { variantId: "variant-1" } });
    expect(shadowReducer(state, { type: "save" })).toBe(state);
  });

  it("keeps save state across status refreshes of the same job", () => {
    let state = run([{ type: "job", job: job({ status: "ready", variant }) }, { type: "save" }], { phase: "starting", sourcePaperId: PAPER, idempotencyKey: "k".repeat(20) });
    state = shadowReducer(state, { type: "job", job: job({ status: "ready", variant }) });
    expect(state).toMatchObject({ save: { status: "pending" } });
  });

  it("shows an expired state for results that aged out", () => {
    const state = run([{ type: "job", job: job({ status: "ready", variant: null, expired: true }) }], initialShadowState({ sourcePaperId: PAPER, jobId: "job-1" }));
    expect(state).toEqual({ phase: "expired", sourcePaperId: PAPER });
  });

  it("produces URL-safe idempotency keys", () => {
    const key = newIdempotencyKey(new Uint8Array(32).map((_, index) => index * 7));
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(() => newIdempotencyKey(new Uint8Array(8))).toThrow();
  });
});
