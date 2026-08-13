import "server-only";

import { z } from "zod";

import { DependencyUnavailableError } from "@/shared/application/errors";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

const HACKCLUB_UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";
const uploadedFileResponseSchema = z.object({
  id: z.string(),
  url: z.url(),
  size: z.number().finite(),
  content_type: z.string(),
  created_at: z.string().optional(),
});

export type UploadedFile = {
  id: string;
  url: string;
  size: number;
  contentType: string;
  createdAt: number;
};

export async function uploadToHackClubCdn(file: File) {
  const apiKey = getServerEnvironment().HACKCLUB_CDN_API_KEY;
  if (!apiKey) throw new DependencyUnavailableError("File storage is not configured.");

  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(HACKCLUB_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new DependencyUnavailableError(`File storage rejected the upload (${response.status}).`);
  }

  const payload = uploadedFileResponseSchema.parse(await response.json());

  return {
    id: payload.id,
    url: payload.url,
    size: payload.size,
    contentType: payload.content_type,
    createdAt: Date.parse(payload.created_at ?? "") || Date.now(),
  } satisfies UploadedFile;
}
