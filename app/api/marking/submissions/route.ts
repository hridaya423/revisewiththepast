import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { createMarkingSubmissionInConvex } from "@/lib/marking/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateSubmissionRequest = {
  savedPaperId?: string;
  boardCode?: string;
  subjectSlug?: string;
  subjectKey?: string;
  paperCode?: string;
  tier?: "none" | "foundation" | "higher";
  year?: number;
  session?: string;
  rubricVersion?: string;
  studentLabel?: string;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  let body: CreateSubmissionRequest;
  try {
    body = (await request.json()) as CreateSubmissionRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const boardCode = typeof body.boardCode === "string" ? body.boardCode.trim().toLowerCase() : "edexcel";
  const subjectSlug = typeof body.subjectSlug === "string" ? body.subjectSlug.trim().toLowerCase() : "mathematics";
  const subjectKey = typeof body.subjectKey === "string" ? body.subjectKey.trim() : "edexcel-mathematics-higher";
  const savedPaperId = typeof body.savedPaperId === "string" ? body.savedPaperId.trim() : undefined;
  const paperCode = typeof body.paperCode === "string" ? body.paperCode.trim() : undefined;
  const tier = body.tier === "foundation" || body.tier === "higher" || body.tier === "none" ? body.tier : undefined;
  const year = typeof body.year === "number" && Number.isFinite(body.year) ? Math.round(body.year) : undefined;
  const examSession = typeof body.session === "string" ? body.session.trim().toLowerCase() : undefined;
  const rubricVersion = typeof body.rubricVersion === "string" ? body.rubricVersion.trim() : undefined;
  const studentLabel = typeof body.studentLabel === "string" ? body.studentLabel.trim() : undefined;

  if (!boardCode || !subjectSlug || !subjectKey) {
    return badRequest("boardCode, subjectSlug and subjectKey are required.");
  }

  try {
    const submissionId = await createMarkingSubmissionInConvex({
      savedPaperId,
      boardCode,
      subjectSlug,
      subjectKey,
      paperCode,
      tier,
      year,
      session: examSession,
      rubricVersion,
      studentLabel,
    });

    return Response.json({ submissionId });
  } catch (error) {
    return badRequest(
      `Failed to create marking submission: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}
