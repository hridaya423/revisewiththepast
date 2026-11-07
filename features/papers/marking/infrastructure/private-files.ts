import "server-only";

import { createHash } from "node:crypto";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DependencyUnavailableError, NotFoundError } from "@/shared/application/errors";
import { fetchAuthMutation, fetchAuthQuery } from "@/shared/infrastructure/auth/convex";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

export const PRIVATE_MARKING_FILE_PREFIX = "/api/marking/files/";

function access() {
  const serviceSecret = getServerEnvironment().MCP_SERVICE_SECRET;
  if (!serviceSecret) throw new DependencyUnavailableError("Uploads are unavailable. Please try again later.");
  return { serviceSecret };
}

export async function getPrivateMarkingFileSource(fileId: string) {
  return fetchAuthQuery(api.markingFiles.source, { ...access(), fileId: fileId as Id<"markingFiles"> });
}

export async function resolveMarkingImageUrl(url: string) {
  if (!url.startsWith(PRIVATE_MARKING_FILE_PREFIX)) return url;
  const fileId = url.slice(PRIVATE_MARKING_FILE_PREFIX.length);
  if (!/^[a-z0-9]+$/i.test(fileId)) throw new NotFoundError("This answer page is unavailable.");
  const file = await getPrivateMarkingFileSource(fileId);
  if (!file) throw new NotFoundError("This answer page is unavailable.");
  return file.url;
}

export async function uploadPrivateMarkingFile(file: File) {
  const sha256 = createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex");
  let stored = await fetchAuthQuery(api.markingFiles.findByHash, { ...access(), sha256 });
  if (!stored) {
    const url = await fetchAuthMutation(api.markingFiles.createUploadUrl, access());
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!response.ok) throw new DependencyUnavailableError("This file could not be uploaded. Please try again.");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("storageId" in result) || typeof result.storageId !== "string") {
      throw new DependencyUnavailableError("This file could not be uploaded. Please try again.");
    }
    stored = await fetchAuthMutation(api.markingFiles.record, {
      ...access(), storageId: result.storageId as Id<"_storage">, sha256,
      fileName: file.name, contentType: file.type, size: file.size,
    });
  }
  return { id: stored._id, url: `${PRIVATE_MARKING_FILE_PREFIX}${stored._id}`, contentType: stored.contentType, size: stored.size, createdAt: stored.createdAt };
}
