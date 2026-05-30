import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { addMarkingResponsePageInConvex } from "@/lib/marking/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HACKCLUB_UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  const apiKey = process.env.HACKCLUB_CDN_API_KEY;
  if (!apiKey) return badRequest("Missing HACKCLUB_CDN_API_KEY", 500);

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

  const uploadFormData = new FormData();
  uploadFormData.append("file", file, file.name);

  const uploadResponse = await fetch(HACKCLUB_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: uploadFormData,
  });

  if (!uploadResponse.ok) {
    return badRequest(`Hack Club CDN upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`, 500);
  }

  const upload = await uploadResponse.json() as {
    id: string;
    url: string;
    size: number;
    content_type: string;
    created_at: string;
  };

  try {
    const pageId = await addMarkingResponsePageInConvex({
      submissionId,
      questionKey,
      questionNumber,
      questionPartNumber,
      pageLabel,
      fileName: file.name,
      contentType: upload.content_type,
      fileSize: upload.size,
      cdnUploadId: upload.id,
      sourceImageUrl: upload.url,
      uploadedAt: Date.parse(upload.created_at) || Date.now(),
    });

    return Response.json({
      pageId,
      imageUrl: upload.url,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) return unauthorizedResponse();
    return badRequest(`Failed to save upload metadata: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}
