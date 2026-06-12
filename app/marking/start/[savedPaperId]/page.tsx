import { notFound, redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";
import { createMarkingSubmissionInConvex } from "@/lib/marking/convex";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ savedPaperId: string }>;
};

export default async function StartMarkingPage({ params }: RouteContext) {
  const { savedPaperId } = await params;
  const saved = await fetchAuthQuery(api.savedPapers.getSavedPaper, {
    savedPaperId: savedPaperId as never,
  }).catch(() => null);

  if (!saved?.savedPaper) notFound();

  const submissionId = await createMarkingSubmissionInConvex({
    savedPaperId,
    boardCode: saved.savedPaper.boardCode,
    subjectSlug: saved.savedPaper.subjectSlug,
    subjectKey: saved.savedPaper.subjectKey,
    tier: saved.savedPaper.tier,
    studentLabel: `${saved.savedPaper.title} script`,
    importSource: "saved_paper",
  });

  redirect(`/marking/${submissionId}`);
}
