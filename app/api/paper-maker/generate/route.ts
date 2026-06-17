import { NextRequest } from "next/server";

import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import { generateCustomPaper, PaperGenerationError } from "@/lib/paper-maker/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeneratePaperRequest = {
  subjectKey?: string;
  subjectTier?: SubjectTierKey;
  selectedTopicNodeIds?: string[];
  targetMarks?: number;
  timeMinutes?: number;
  targetMode?: "marks" | "time";
  paperCodes?: string[];
  maxQuestions?: number;
  excludeSourceQuestionKeys?: string[];
  remainingPaperCount?: number;
  priorSelectedUnitMarks?: number[];
  priorPaperCount?: number;
  priorCoveredLeafTopicIds?: string[];
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  let body: GeneratePaperRequest;
  try {
    body = (await request.json()) as GeneratePaperRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const selectedTopicNodeIds = Array.isArray(body.selectedTopicNodeIds)
    ? body.selectedTopicNodeIds.filter((value): value is string => typeof value === "string")
    : [];
  const subjectKey = typeof body.subjectKey === "string" ? body.subjectKey : "aqa-geography";
  const paperCodes = Array.isArray(body.paperCodes)
    ? body.paperCodes.filter((value): value is string => typeof value === "string")
    : [];
  const subjectTier = body.subjectTier === "foundation" || body.subjectTier === "higher"
    ? body.subjectTier
    : undefined;
  const requestedTimeMinutes = typeof body.timeMinutes === "number" && Number.isFinite(body.timeMinutes)
    ? Math.max(15, Math.min(300, Math.round(body.timeMinutes)))
    : undefined;
  const targetMode = body.targetMode === "time" ? "time" : "marks";
  const targetMarks = typeof body.targetMarks === "number" && Number.isFinite(body.targetMarks)
    ? Math.max(1, Math.min(200, Math.round(body.targetMarks)))
    : 40;
  const maxQuestions = typeof body.maxQuestions === "number" && Number.isFinite(body.maxQuestions)
    ? Math.max(1, Math.min(40, Math.round(body.maxQuestions)))
    : undefined;
  const excludeSourceQuestionKeys = Array.isArray(body.excludeSourceQuestionKeys)
    ? body.excludeSourceQuestionKeys.filter((value): value is string => typeof value === "string")
    : [];
  const priorSelectedUnitMarks = Array.isArray(body.priorSelectedUnitMarks)
    ? body.priorSelectedUnitMarks.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  const priorPaperCount = typeof body.priorPaperCount === "number" && Number.isFinite(body.priorPaperCount)
    ? Math.max(0, Math.min(2, Math.round(body.priorPaperCount)))
    : 0;
  const priorCoveredLeafTopicIds = Array.isArray(body.priorCoveredLeafTopicIds)
    ? body.priorCoveredLeafTopicIds.filter((value): value is string => typeof value === "string")
    : [];
  const remainingPaperCount = typeof body.remainingPaperCount === "number" && Number.isFinite(body.remainingPaperCount)
    ? Math.max(1, Math.min(3, Math.round(body.remainingPaperCount)))
    : 1;

  try {
    const result = await generateCustomPaper({
      subjectKey,
      subjectTier,
      selectedTopicNodeIds,
      targetMarks,
      requestedTimeMinutes,
      targetMode,
      paperCodes,
      maxQuestions,
      excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    const { selection } = result;
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "X-Question-Count": String(selection.selectedUnits.length),
      "X-Total-Marks": String(selection.totalMarks),
      "X-Resolved-Target-Marks": String(result.resolvedTargetMarks),
      "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
      "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
      "X-Time-Minutes": String(result.timeMinutes),
      "X-Target-Mode": result.targetMode,
      "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
      "X-Selected-Unit-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.unitKey).join("\n")),
      "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
    };
    if (result.selectedTierHeader) {
      headers["X-Selected-Tier"] = result.selectedTierHeader;
    }

    return new Response(Buffer.from(result.pdfBytes), { headers });
  } catch (error) {
    if (error instanceof PaperGenerationError) {
      return badRequest(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("Paper generation failed", {
      subjectKey,
      subjectTier,
      targetMode,
      targetMarks,
      requestedTimeMinutes,
      paperCodes,
      selectedTopicNodeIdsCount: selectedTopicNodeIds.length,
      remainingPaperCount,
      priorPaperCount,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(`Failed to generate paper: ${message}`, { status: 500 });
  }
}
