import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { saveGeneratedPaper } from "@/features/papers/server";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
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

  const subjectKey = typeof formData.get("subjectKey") === "string" ? String(formData.get("subjectKey")).trim() as PaperMakerSubjectKey : null;
  const targetMarks = Number(formData.get("targetMarks") ?? 0);
  const totalMarks = Number(formData.get("totalMarks") ?? 0);
  const timeMinutes = Number(formData.get("timeMinutes") ?? 0);
  const subjectTierRaw = typeof formData.get("subjectTier") === "string" ? String(formData.get("subjectTier")).trim() : "";
  const unitKeysRaw = typeof formData.get("selectedUnitKeys") === "string" ? String(formData.get("selectedUnitKeys")).trim() : "";
  const file = formData.get("file");

  if (!subjectKey) return badRequest("subjectKey is required.");
  if (!(file instanceof File)) return badRequest("file is required.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return badRequest("Only PDF uploads are supported.");
  }
  if (!unitKeysRaw) return badRequest("selectedUnitKeys is required.");

  const selectedUnitKeys = unitKeysRaw.split("\n").map((value) => value.trim()).filter(Boolean);
  if (selectedUnitKeys.length === 0) return badRequest("selectedUnitKeys is required.");

  try {
    return Response.json(await saveGeneratedPaper({
      subjectKey,
      targetMarks,
      totalMarks,
      timeMinutes,
      subjectTier: subjectTierRaw === "foundation" || subjectTierRaw === "higher" || subjectTierRaw === "none" ? subjectTierRaw : undefined,
      selectedUnitKeys,
      file,
    }));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Could not save generated paper.");
    if (normalized.status === 403) return unauthorizedResponse();
    return badRequest(normalized.message, normalized.status);
  }
}
