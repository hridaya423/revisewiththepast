export type ShadowJobStatus = "queued" | "generating" | "validating" | "rendering" | "ready" | "failed" | "cancelled";

export type ShadowVariantSummary = {
  variantId: string;
  displayCode: string;
  title: string;
  totalMarks: number;
  durationMinutes: number;
  questionCount: number;
  paperPages: number;
  markSchemePages: number;
  createdAt: number;
  expiresAt: number | null;
  savedPaperId: string | null;
};

export type ShadowJob = {
  jobId: string;
  status: ShadowJobStatus;
  sourcePaperId: string;
  manifestRevision: string;
  progress: { completedUnits: number; totalUnits: number };
  cancelRequested: boolean;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  variant: ShadowVariantSummary | null;
  expired?: boolean;
};

export type SaveState = { status: "idle" | "pending" | "saved" | "error"; savedPaperId: string | null };

export type ShadowState =
  | { phase: "choose"; sourcePaperId: string | null; notice: string | null }
  | { phase: "starting"; sourcePaperId: string; idempotencyKey: string }
  | { phase: "running"; sourcePaperId: string; job: ShadowJob; offline: boolean; cancelling: boolean }
  | { phase: "ready"; sourcePaperId: string; job: ShadowJob; variant: ShadowVariantSummary; save: SaveState }
  | { phase: "failed"; sourcePaperId: string; message: string; retryable: boolean }
  | { phase: "cancelled"; sourcePaperId: string }
  | { phase: "expired"; sourcePaperId: string }
  | { phase: "restoring"; sourcePaperId: string | null; jobId: string };

export type ShadowEvent =
  | { type: "select"; sourcePaperId: string }
  | { type: "start"; idempotencyKey: string }
  | { type: "job"; job: ShadowJob }
  | { type: "start-failed"; code: string; message: string }
  | { type: "job-missing" }
  | { type: "offline" }
  | { type: "online" }
  | { type: "cancel" }
  | { type: "cancel-failed" }
  | { type: "save" }
  | { type: "saved"; savedPaperId: string }
  | { type: "save-failed" }
  | { type: "back" };

export function initialShadowState(input: { sourcePaperId: string | null; jobId: string | null }): ShadowState {
  if (input.jobId) return { phase: "restoring", sourcePaperId: input.sourcePaperId, jobId: input.jobId };
  return { phase: "choose", sourcePaperId: input.sourcePaperId, notice: null };
}

const FAILURE_MESSAGES: Record<string, string> = {
  MANIFEST_STALE: "This paper was updated while you waited. Generate it again to use the latest version.",
  RENDER_FAILED: "We could not lay out this version. Generate a new version.",
  NO_VALID_VARIANT: "We could not find new numbers that keep every question fair. Generate a new version.",
  VALIDATION_FAILED: "A generated question did not pass our checks, so we stopped. Generate a new version.",
  WORKER_UNAVAILABLE: "Generation is unavailable right now. Try again in a few minutes.",
  WORKER_TIMEOUT: "Generation took too long and was stopped. Try again.",
  WORKER_RETRIES_EXHAUSTED: "Generation kept failing, so we stopped. Try again in a few minutes.",
};

export function failureMessage(code: string | undefined) {
  return (code && FAILURE_MESSAGES[code]) ?? "Generation stopped before your paper was ready. Try again.";
}

const START_MESSAGES: Record<string, string> = {
  MANIFEST_STALE: "This paper was just updated. Check the details and generate again.",
  ACTIVE_JOB_LIMIT: "You already have a shadow paper in progress. Wait for it to finish or cancel it.",
  RATE_LIMITED: "You have generated a lot of papers this hour. Try again later.",
  AUTHENTICATION_REQUIRED: "Sign in to generate a shadow paper.",
  SHADOW_DISABLED: "Shadow paper generation is turned off right now.",
  NOT_FOUND: "This paper is no longer available as a shadow paper.",
};

function fromJob(sourcePaperId: string, job: ShadowJob, previous?: ShadowState): ShadowState {
  switch (job.status) {
    case "ready":
      if (job.expired || !job.variant) return { phase: "expired", sourcePaperId };
      return {
        phase: "ready",
        sourcePaperId,
        job,
        variant: job.variant,
        save: previous?.phase === "ready" && previous.job.jobId === job.jobId
          ? previous.save
          : { status: job.variant.savedPaperId ? "saved" : "idle", savedPaperId: job.variant.savedPaperId },
      };
    case "failed":
      return { phase: "failed", sourcePaperId, message: failureMessage(job.errorCode), retryable: true };
    case "cancelled":
      return { phase: "cancelled", sourcePaperId };
    default:
      return {
        phase: "running",
        sourcePaperId,
        job,
        offline: previous?.phase === "running" ? previous.offline : false,
        cancelling: job.cancelRequested || (previous?.phase === "running" && previous.cancelling),
      };
  }
}

export function shadowReducer(state: ShadowState, event: ShadowEvent): ShadowState {
  switch (event.type) {
    case "select":
      if (state.phase === "starting" || state.phase === "running" || state.phase === "restoring") return state;
      return { phase: "choose", sourcePaperId: event.sourcePaperId, notice: null };
    case "start":
      if (state.phase === "starting" || state.phase === "running" || state.phase === "restoring" || !state.sourcePaperId) return state;
      return { phase: "starting", sourcePaperId: state.sourcePaperId, idempotencyKey: event.idempotencyKey };
    case "job": {
      // A late status for a different job must not replace the one on screen.
      if ((state.phase === "running" || state.phase === "ready") && state.job.jobId !== event.job.jobId) return state;
      if (state.phase === "restoring" && state.jobId !== event.job.jobId) return state;
      return fromJob(event.job.sourcePaperId, event.job, state);
    }
    case "start-failed":
      if (state.phase !== "starting") return state;
      return { phase: "choose", sourcePaperId: state.sourcePaperId, notice: START_MESSAGES[event.code] ?? event.message };
    case "job-missing":
      if (state.phase !== "restoring" && state.phase !== "running") return state;
      return { phase: "choose", sourcePaperId: state.sourcePaperId, notice: "We could not find that generation. It may belong to another account or have expired." };
    case "offline":
      return state.phase === "running" ? { ...state, offline: true } : state;
    case "online":
      return state.phase === "running" ? { ...state, offline: false } : state;
    case "cancel":
      return state.phase === "running" ? { ...state, cancelling: true } : state;
    case "cancel-failed":
      return state.phase === "running" ? { ...state, cancelling: false } : state;
    case "save":
      if (state.phase !== "ready" || state.save.status === "pending" || state.save.status === "saved") return state;
      return { ...state, save: { status: "pending", savedPaperId: null } };
    case "saved":
      return state.phase === "ready" ? { ...state, save: { status: "saved", savedPaperId: event.savedPaperId } } : state;
    case "save-failed":
      return state.phase === "ready" && state.save.status === "pending" ? { ...state, save: { status: "error", savedPaperId: null } } : state;
    case "back":
      if (state.phase === "starting" || state.phase === "running" || state.phase === "restoring") return state;
      return { phase: "choose", sourcePaperId: state.sourcePaperId, notice: null };
  }
}

export const isWaiting = (state: ShadowState) => state.phase === "running" || state.phase === "restoring";

const STAGE_LABELS: Record<ShadowJobStatus, string> = {
  queued: "Waiting to start",
  generating: "Writing new questions",
  validating: "Checking every answer",
  rendering: "Typesetting the paper and mark scheme",
  ready: "Ready",
  failed: "Stopped",
  cancelled: "Cancelled",
};

export function progressLabel(job: ShadowJob) {
  if (job.cancelRequested) return "Cancelling";
  const label = STAGE_LABELS[job.status];
  return job.status === "generating" ? `${label} · ${job.progress.completedUnits} of ${job.progress.totalUnits}` : label;
}

/** Polls quickly at first, then backs off; long-running jobs never poll faster than every 5 seconds. */
export function pollDelay(attempt: number, offline: boolean) {
  if (offline) return 10_000;
  return Math.min(5_000, 1_000 + attempt * 500);
}

export function downloadHref(variantId: string, kind: "paper" | "mark-scheme") {
  return `/api/paper-maker/shadow-variants/${encodeURIComponent(variantId)}/download?kind=${kind}`;
}

export function shadowPageHref(input: { sourcePaperId?: string | null; jobId?: string | null }) {
  const params = new URLSearchParams({ mode: "shadow" });
  if (input.sourcePaperId) params.set("paper", input.sourcePaperId);
  if (input.jobId) params.set("job", input.jobId);
  return `/paper-maker?${params.toString()}`;
}

export function signInHref(sourcePaperId: string | null) {
  return `/auth?redirect=${encodeURIComponent(shadowPageHref({ sourcePaperId }))}`;
}

export function newIdempotencyKey(randomBytes: Uint8Array) {
  if (randomBytes.length < 16) throw new Error("Need at least 16 random bytes.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from(randomBytes.slice(0, 32), (value) => alphabet[value % 64]).join("");
}
