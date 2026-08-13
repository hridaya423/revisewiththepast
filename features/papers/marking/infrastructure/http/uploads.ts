import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { uploadResponsePage } from "@/features/papers/server";
import { normalizeApplicationError } from "@/shared/application/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Invalid multipart form data.");
  }

  const submissionId = typeof formData.get("submissionId") === "string" ? String(formData.get("submissionId")).trim() : "";
  const questionKey = typeof formData.get("questionKey") === "string" ? String(formData.get("questionKey")).trim() : "";
  const questionNumber = typeof formData.get("questionNumber") === "string" ? String(formData.get("questionNumber")).trim() : undefined;
  const questionPartNumber = typeof formData.get("questionPartNumber") === "string" ? String(formData.get("questionPartNumber")).trim() : undefined;
  const pageLabel = typeof formData.get("pageLabel") === "string" ? String(formData.get("pageLabel")).trim() : undefined;
  const file = formData.get("file");

  if (!submissionId) return badRequest("submissionId is required.");
  if (!questionKey) return badRequest("questionKey is required.");
  if (!(file instanceof File)) return badRequest("file is required.");
  if (!file.type.startsWith("image/")) return badRequest("Only image uploads are supported right now.");

  try {
    return Response.json(await uploadResponsePage({
      submissionId,
      questionKey,
      questionNumber,
      questionPartNumber,
      pageLabel,
      file,
    }));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Failed to save upload metadata.");
    if (normalized.status === 403) return unauthorizedResponse();
    return badRequest(normalized.message, normalized.status);
  }
}
