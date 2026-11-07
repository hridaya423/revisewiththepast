import "server-only";

import { getServerEnvironment } from "@/shared/infrastructure/env/server";

const truthy = (value: string | undefined) => value === "1" || value === "true";

/** Kill switch for new shadow generation. Saved variants stay downloadable when it is off. */
export function shadowPapersEnabled() {
  return truthy(getServerEnvironment().SHADOW_PAPERS_ENABLED);
}

/** Lets preview and development deployments generate from draft manifests. Never set in production. */
export function shadowPapersAllowDraft() {
  return truthy(getServerEnvironment().SHADOW_PAPERS_ALLOW_DRAFT) && process.env.VERCEL_ENV !== "production";
}

/** Development convenience: run the worker after the start response instead of waiting for Convex dispatch. */
export function shadowPapersInlineWorker() {
  return truthy(getServerEnvironment().SHADOW_PAPERS_INLINE_WORKER) && process.env.NODE_ENV !== "production";
}
