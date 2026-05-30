import { NextRequest } from "next/server";

import { fetchAuthMutation } from "@/lib/auth-server";
import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { getMarkableUnitsByUnitKeys } from "@/lib/marking/paper-maker";
import { getPaperMakerSubject, type PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";
import { api } from "@/convex/_generated/api";

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

  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) return badRequest("Unknown subjectKey.");

  const selectedUnitKeys = unitKeysRaw.split("\n").map((value) => value.trim()).filter(Boolean);
  if (selectedUnitKeys.length === 0) return badRequest("selectedUnitKeys is required.");

  const selectedUnits = await getMarkableUnitsByUnitKeys(subjectKey, selectedUnitKeys);
  if (selectedUnits.length !== selectedUnitKeys.length) {
    return badRequest("Could not resolve every selected unit for this generated paper.");
  }

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
  };

  const title = `${subject.label} Custom Paper`;

  const savedPaperId = await fetchAuthMutation(api.savedPapers.createSavedPaper, {
    subjectKey,
    boardCode: subject.boardCode,
    subjectSlug: subject.subjectSlug,
    tier: subjectTierRaw === "foundation" || subjectTierRaw === "higher" || subjectTierRaw === "none"
      ? subjectTierRaw
      : undefined,
    title,
    targetMarks: Number.isFinite(targetMarks) ? targetMarks : 0,
    totalMarks: Number.isFinite(totalMarks) ? totalMarks : 0,
    timeMinutes: Number.isFinite(timeMinutes) ? timeMinutes : 0,
    pdfFileName: file.name,
    pdfContentType: upload.content_type,
    pdfFileSize: upload.size,
    pdfCdnUploadId: upload.id,
    pdfUrl: upload.url,
    questions: selectedUnits.map((unit, index) => ({
      displayOrder: index + 1,
      unitKey: unit.unitKey,
      sourceQuestionKey: unit.sourceQuestionKey,
      sourceRelativePath: unit.sourceRelativePath,
      paperCode: unit.paperCode,
      year: unit.year ?? undefined,
      session: unit.session ?? undefined,
      questionNumber: unit.questionNumber,
      questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
      totalMarks: unit.totalMarks,
      promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
      contextText: unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
    })),
  });

  return Response.json({
    savedPaperId,
    pdfUrl: upload.url,
  });
}
