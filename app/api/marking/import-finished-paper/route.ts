import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { importFinishedPaper } from "@/lib/marking/import-pipeline";

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

  const studentLabel = typeof formData.get("studentLabel") === "string" ? String(formData.get("studentLabel")).trim() : undefined;
  const submissionId = typeof formData.get("submissionId") === "string" ? String(formData.get("submissionId")).trim() : undefined;
  const skipAutoScore = formData.get("skipAutoScore") === "true";
  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("file is required.");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return badRequest("Only PDF uploads are supported.");

  try {
    const result = await importFinishedPaper({
      file,
      studentLabel,
      existingSubmissionId: submissionId || undefined,
      skipAutoScore,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("blank question paper") ? 422 : 500;
    return badRequest(`Failed to import finished paper: ${message}`, status);
  }
}
