import "server-only";

import { after } from "next/server";
import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reservePaperGeneration } from "@/features/mcp/rate-limit";
import { getMcpServiceSecret } from "@/features/mcp/infrastructure/convex-client";
import { getAuthToken } from "@/shared/infrastructure/auth/tokens";
import { getConvexUrl, getServerEnvironment } from "@/shared/infrastructure/env/server";
import { listShadowManifests } from "../../content/catalog";
import { shadowPapersAllowDraft, shadowPapersEnabled, shadowPapersInlineWorker } from "../feature-flag";
import type { ShadowHttpDeps, ShadowJobView } from "./shadow-routes";
import { shadowWorker } from "./shadow-worker";

const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;

function client(token: string) {
  const convex = new ConvexHttpClient(getConvexUrl());
  convex.setAuth(token);
  return convex;
}

const jobId = (value: string) => value as Id<"shadowGenerationJobs">;
const variantId = (value: string) => value as Id<"shadowPaperVariants">;

export function createShadowHttpDeps(): ShadowHttpDeps {
  return {
    enabled: shadowPapersEnabled,
    manifests: () => listShadowManifests({ includeDraft: shadowPapersAllowDraft() }),
    authToken: async (request) => (await getAuthToken(request.headers)) ?? null,
    reserve: async (request) => {
      await reservePaperGeneration(request, "shadow", { callerLimit: getServerEnvironment().SHADOW_PAPER_RATE_LIMIT_PER_CALLER_PER_HOUR });
    },
    startJob: async (token, input) => {
      const result = await client(token).mutation(api.shadowPapers.startJob, { ...input, serviceSecret: getMcpServiceSecret() });
      return result as { created: boolean; job: ShadowJobView };
    },
    getJob: async (token, id) => (await client(token).query(api.shadowPapers.getJob, { jobId: jobId(id) })) as ShadowJobView | null,
    getActiveJob: async (token) => (await client(token).query(api.shadowPapers.getActiveJob, {})) as ShadowJobView | null,
    cancelJob: async (token, id) => (await client(token).mutation(api.shadowPapers.cancelJob, { jobId: jobId(id) })) as ShadowJobView | null,
    getVariant: async (token, id) => await client(token).query(api.shadowPapers.getVariant, { variantId: variantId(id) }),
    getArtifact: async (token, id, kind) => await client(token).query(api.shadowPapers.getVariantArtifact, { variantId: variantId(id), kind }),
    saveVariant: async (token, id) => {
      const result = await client(token).mutation(api.shadowPapers.saveVariant, { variantId: variantId(id) });
      return { savedPaperId: String(result.savedPaperId), created: result.created };
    },
    fetchArtifact: (url) => fetch(url, { signal: AbortSignal.timeout(ARTIFACT_FETCH_TIMEOUT_MS) }),
    worker: shadowWorker,
    afterStart: shadowPapersInlineWorker()
      ? (id) => after(async () => {
          const { processShadowJob } = await import("../jobs/worker");
          await processShadowJob(id).catch((error: unknown) => console.error("Inline shadow worker failed", error));
        })
      : undefined,
  };
}
