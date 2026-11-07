import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getMcpConvexClient, getMcpServiceSecret } from "@/features/mcp/infrastructure/convex-client";
import { runShadowJob, type ShadowJobOutcome, type ShadowWorkerPorts } from "../../application/generate-shadow-paper";
import { SHADOW_TEMPLATE_REGISTRY, findShadowManifest } from "../../content/catalog";
import { SHADOW_RENDERER_VERSION, renderShadowPaperPdf, renderShadowSchemePdf } from "../pdf/render";
import { shadowPapersAllowDraft } from "../feature-flag";

const UPLOAD_TIMEOUT_MS = 30_000;

async function uploadPdf(bytes: Uint8Array) {
  const client = getMcpConvexClient();
  const uploadUrl = await client.mutation(api.shadowPapers.createArtifactUploadUrl, { serviceSecret: getMcpServiceSecret() });
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Artifact upload failed with ${response.status}.`);
  const { storageId } = (await response.json()) as { storageId?: string };
  if (!storageId) throw new Error("Artifact upload returned no storage ID.");
  return storageId;
}

export function createShadowWorkerPorts(): ShadowWorkerPorts {
  const client = getMcpConvexClient();
  const serviceSecret = getMcpServiceSecret();
  const jobId = (value: string) => value as Id<"shadowGenerationJobs">;
  return {
    newLeaseToken: () => randomBytes(18).toString("base64url"),
    claim: (id, leaseToken) => client.mutation(api.shadowPapers.claimJob, { serviceSecret, jobId: jobId(id), leaseToken }),
    progress: (id, leaseToken, stage, completedUnits) => client.mutation(api.shadowPapers.reportProgress, { serviceSecret, jobId: jobId(id), leaseToken, stage, completedUnits }),
    upload: uploadPdf,
    publish: (id, leaseToken, publication) => client.mutation(api.shadowPapers.publishVariant, {
      serviceSecret,
      jobId: jobId(id),
      leaseToken,
      variant: {
        ...publication.variant,
        paper: { ...publication.variant.paper, storageId: publication.variant.paper.storageId as Id<"_storage"> },
        markScheme: { ...publication.variant.markScheme, storageId: publication.variant.markScheme.storageId as Id<"_storage"> },
      },
      questions: publication.questions,
    }),
    fail: (id, leaseToken, failure) => client.mutation(api.shadowPapers.failJob, {
      serviceSecret,
      jobId: jobId(id),
      leaseToken,
      errorCode: failure.errorCode,
      retryable: failure.retryable,
      orphanStorageIds: failure.orphanStorageIds as Array<Id<"_storage">>,
    }),
    findManifest: (sourcePaperId) => findShadowManifest(sourcePaperId, { includeDraft: shadowPapersAllowDraft() }),
    registry: SHADOW_TEMPLATE_REGISTRY,
    allowDraft: shadowPapersAllowDraft(),
    renderPaper: (variant, createdAt) => renderShadowPaperPdf(variant, { createdAt }),
    renderMarkScheme: (variant, createdAt) => renderShadowSchemePdf(variant, { createdAt }),
    rendererVersion: SHADOW_RENDERER_VERSION,
    sha256: (value) => createHash("sha256").update(value).digest("hex"),
    log: (event, details) => console.info(event, details),
  };
}

export async function processShadowJob(jobId: string): Promise<ShadowJobOutcome> {
  return await runShadowJob(jobId, createShadowWorkerPorts());
}
