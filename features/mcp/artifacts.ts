import "server-only";

import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DependencyUnavailableError } from "@/shared/application/errors";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

import { getMcpConvexClient, getMcpServiceSecret } from "./infrastructure/convex-client";
import type { ArtifactOutput } from "./contracts";

const storageUploadResponseSchema = z.object({ storageId: z.string().min(1) });
const PDF_SIGNATURE = new Uint8Array([37, 80, 68, 70, 45]);
const registeredArtifactSchema = z.object({
  fileName: z.string(),
  url: z.string().url(),
  fileSize: z.number().finite().int().positive(),
  contentType: z.literal("application/pdf"),
});

type ArtifactKind = "paper" | "mark-scheme";

export function getArtifactExpiry() {
  const hours = getServerEnvironment().MCP_ARTIFACT_TTL_HOURS;
  return Date.now() + hours * 60 * 60 * 1000;
}

async function deleteUnregisteredStorage(storageId: string) {
  try {
    await getMcpConvexClient().mutation(api.mcpArtifacts.deleteStorage, {
      serviceSecret: getMcpServiceSecret(),
      storageId: storageId as Id<"_storage">,
    });
  } catch (error) {
    console.error("Failed to delete unregistered MCP artifact", { storageId, error });
  }
}

export async function uploadMcpArtifact(input: {
  bundleId: string;
  kind: ArtifactKind;
  fileName: string;
  bytes: Uint8Array;
  expiresAt: number;
}): Promise<ArtifactOutput> {
  const serviceSecret = getMcpServiceSecret();
  if (input.bytes.byteLength < PDF_SIGNATURE.byteLength || PDF_SIGNATURE.some((value, index) => input.bytes[index] !== value)) {
    throw new DependencyUnavailableError("Generated artifact was not a valid PDF.");
  }
  let uploadUrl: string;
  try {
    uploadUrl = await getMcpConvexClient().mutation(api.mcpArtifacts.createUploadUrl, { serviceSecret });
  } catch {
    throw new DependencyUnavailableError("Artifact storage is unavailable.");
  }

  let storageId: string;
  try {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: new Blob([new Uint8Array(input.bytes).buffer as ArrayBuffer], { type: "application/pdf" }),
    });
    if (!response.ok) throw new Error(`upload returned ${response.status}`);
    storageId = storageUploadResponseSchema.parse(await response.json()).storageId;
  } catch {
    throw new DependencyUnavailableError("Artifact storage rejected the generated PDF.");
  }

  try {
    const registered = await getMcpConvexClient().mutation(api.mcpArtifacts.register, {
      serviceSecret,
      bundleId: input.bundleId,
      kind: input.kind,
      storageId: storageId as Id<"_storage">,
      fileName: input.fileName,
      contentType: "application/pdf",
      fileSize: input.bytes.byteLength,
      expiresAt: input.expiresAt,
    });
    const parsed = registeredArtifactSchema.parse(registered);
    if (parsed.fileName !== input.fileName || parsed.fileSize !== input.bytes.byteLength) {
      throw new Error("Artifact metadata did not match the generated PDF.");
    }
    if (!parsed.url.startsWith("https://")) throw new Error("Artifact URL was not HTTPS.");
    return {
      fileName: parsed.fileName,
      url: parsed.url,
      size: parsed.fileSize,
      mimeType: "application/pdf",
    };
  } catch (error) {
    await deleteUnregisteredStorage(storageId);
    if (error instanceof DependencyUnavailableError) throw error;
    throw new DependencyUnavailableError("Artifact registration failed.");
  }
}
