import "server-only";

import { api } from "@/convex/_generated/api";
import { fetchAuthMutation, fetchAuthQuery } from "@/shared/infrastructure/auth/convex";

export function getImportAsset(importKey: string, pageNumber: number) {
  return fetchAuthQuery(api.markingImportAssets.get, { importKey, pageNumber });
}

export function saveImportAsset(input: {
  importKey: string;
  pageNumber: number;
  fileName: string;
  fileSize: number;
  cdnUploadId: string;
  sourceImageUrl: string;
  ocrText?: string;
}) {
  return fetchAuthMutation(api.markingImportAssets.upsert, input);
}
