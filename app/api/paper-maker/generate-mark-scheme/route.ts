import { NextRequest } from "next/server";

import { getMarkableUnitsByUnitKeys } from "@/lib/marking/paper-maker";
import { assembleMarkSchemePdf } from "@/lib/marking/mark-scheme";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import { getPaperMakerSubject, type PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateMarkSchemeRequest = {
  subjectKey?: string;
  subjectTier?: string;
  selectedUnitKeys?: string[];
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  let body: GenerateMarkSchemeRequest;
  try {
    body = (await request.json()) as GenerateMarkSchemeRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const subjectKey = typeof body.subjectKey === "string" ? body.subjectKey.trim() : "";
  const subject = subjectKey ? getPaperMakerSubject(subjectKey) : undefined;
  if (!subject) return badRequest("Unknown or missing subjectKey.");

  const selectedUnitKeys = Array.isArray(body.selectedUnitKeys)
    ? body.selectedUnitKeys.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (selectedUnitKeys.length === 0) return badRequest("selectedUnitKeys is required.");
  const subjectTier: SubjectTierKey | null = body.subjectTier === "foundation" || body.subjectTier === "higher"
    ? body.subjectTier
    : null;

  try {
    const units = await getMarkableUnitsByUnitKeys(subjectKey as PaperMakerSubjectKey, selectedUnitKeys, subjectTier);
    if (units.length !== selectedUnitKeys.length) {
      return badRequest("Could not resolve every selected unit for this paper.", 422);
    }

    const { bytes, includedCount, failures } = await assembleMarkSchemePdf(units);
    if (includedCount === 0) {
      return badRequest(`No mark scheme pages could be assembled. ${failures.map((failure) => failure.error).join("; ")}`, 422);
    }

    const fileName = `${subject.coverTitle.replace(/\s+/g, "-").toLowerCase()}-mark-scheme.pdf`;
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Mark-Scheme-Included": String(includedCount),
        "X-Mark-Scheme-Failures": String(failures.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Mark scheme generation failed", { subjectKey, unitCount: selectedUnitKeys.length, message });
    return new Response(`Failed to generate mark scheme: ${message}`, { status: 500 });
  }
}
