import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const MAX_DISPATCH_ATTEMPTS = 3;
const DISPATCH_TIMEOUT_MS = 5 * 60 * 1000;

export const WORKER_PATH = "/api/paper-maker/shadow-jobs/worker";

export function dispatchOutcome(status: number): "done" | "retry" {
  // 2xx: handled. 409: another worker holds the lease. 4xx: retrying cannot help.
  if (status >= 200 && status < 500) return "done";
  return "retry";
}

/** Invokes the bounded Next.js worker for one job, retrying transport failures with backoff. */
export const dispatch = internalAction({
  args: { jobId: v.id("shadowGenerationJobs"), dispatchAttempt: v.number() },
  handler: async (ctx, args) => {
    const baseUrl = process.env.SHADOW_WORKER_BASE_URL;
    const secret = process.env.MCP_SERVICE_SECRET;
    if (!baseUrl || !secret) {
      await ctx.runMutation(internal.shadowPapers.markDispatchFailed, { jobId: args.jobId, errorCode: "WORKER_UNAVAILABLE" });
      return;
    }
    let outcome: "done" | "retry" = "retry";
    try {
      const response = await fetch(new URL(WORKER_PATH, baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ jobId: args.jobId }),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      outcome = dispatchOutcome(response.status);
    } catch {
      outcome = "retry";
    }
    if (outcome === "done") return;
    if (args.dispatchAttempt >= MAX_DISPATCH_ATTEMPTS) {
      await ctx.runMutation(internal.shadowPapers.markDispatchFailed, { jobId: args.jobId, errorCode: "WORKER_UNAVAILABLE" });
      return;
    }
    await ctx.scheduler.runAfter(5_000 * 2 ** (args.dispatchAttempt - 1), internal.shadowPaperScheduler.dispatch, {
      jobId: args.jobId,
      dispatchAttempt: args.dispatchAttempt + 1,
    });
  },
});
