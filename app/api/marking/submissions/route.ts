import { NextRequest } from "next/server";

import { requireAuthToken, unauthorizedResponse } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
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

  const savedPaperId = typeof body.savedPaperId === "string" ? body.savedPaperId.trim() : undefined;
  const savedPaper = savedPaperId
    ? await fetchAuthQuery(api.savedPapers.getSavedPaper, { savedPaperId: savedPaperId as never }).catch(() => null)
    : null;
  if (savedPaperId && !savedPaper?.savedPaper) return badRequest("The saved paper could not be found.", 404);
  const canonicalSavedPaper = savedPaper?.savedPaper;
  const canonicalSavedQuestion = savedPaper?.questions[0];

  const boardCode = canonicalSavedPaper?.boardCode ?? (typeof body.boardCode === "string"
    ? body.boardCode.trim().toLowerCase()
    : undefined);
  const subjectSlug = canonicalSavedPaper?.subjectSlug ?? (typeof body.subjectSlug === "string"
    ? body.subjectSlug.trim().toLowerCase()
    : undefined);
  const subjectKey = canonicalSavedPaper?.subjectKey ?? (typeof body.subjectKey === "string"
    ? body.subjectKey.trim()
    : undefined);
  const paperCode = canonicalSavedQuestion?.paperCode ?? (typeof body.paperCode === "string" ? body.paperCode.trim() : undefined);
  const requestedTier = body.tier === "foundation" || body.tier === "higher" || body.tier === "none" ? body.tier : undefined;
  const savedPaperTier = canonicalSavedPaper?.tier;
  const tier = savedPaperTier === "foundation" || savedPaperTier === "higher" || savedPaperTier === "none" ? savedPaperTier : requestedTier;
  const year = canonicalSavedQuestion?.year ?? (typeof body.year === "number" && Number.isFinite(body.year) ? Math.round(body.year) : undefined);
  const examSession = canonicalSavedQuestion?.session ?? (typeof body.session === "string" ? body.session.trim().toLowerCase() : undefined);
  const rubricVersion = typeof body.rubricVersion === "string" ? body.rubricVersion.trim() : undefined;
  const studentLabel = typeof body.studentLabel === "string" ? body.studentLabel.trim() : undefined;

  if (!boardCode || !subjectSlug || !subjectKey) {
    return badRequest("boardCode, subjectSlug and subjectKey are required unless a savedPaperId is provided.");
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
      studentLabel: studentLabel ?? (savedPaper?.savedPaper ? `${savedPaper.savedPaper.title} script` : undefined),
      importSource: savedPaperId ? "saved_paper" : "manual_upload",
    });

    return Response.json({ submissionId });
  } catch (error) {
    return badRequest(
      `Failed to create marking submission: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
}
