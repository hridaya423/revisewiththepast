import { redirect } from "next/navigation";

import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import { MarkingDashboard } from "@/app/_components/marking-dashboard";
import { AppShell } from "@/app/_components/app-shell";

export const dynamic = "force-dynamic";

export default async function MarkingPage() {
  const user = await fetchAuthQuery(api.auth.getCurrentUser, {}).catch(() => null);
  if (!user) redirect("/auth?redirect=/marking");

  const [submissionsResult, savedPapersResult] = await Promise.allSettled([
    fetchAuthQuery(api.marking.listMarkingSubmissions, {}),
    fetchAuthQuery(api.savedPapers.listSavedPapers, {}),
  ]);
  const submissions = submissionsResult.status === "fulfilled" && Array.isArray(submissionsResult.value) ? submissionsResult.value : [];
  const savedPapers = savedPapersResult.status === "fulfilled" && Array.isArray(savedPapersResult.value) ? savedPapersResult.value : [];
  const initialLoadError = submissionsResult.status === "rejected" || savedPapersResult.status === "rejected"
    ? "Some marking data could not be loaded. Try again to reconnect without losing your saved work."
    : null;
  const normalizedSubmissions = submissions.map((submission) => {
    const legacy = submission as typeof submission & {
      scoredCount?: number;
      totalAwardedMarks?: number;
      totalMaxMarks?: number;
      questionCount?: number;
    };
    const questionProgress = Array.isArray(submission.questionProgress) ? submission.questionProgress : [];
    return {
      ...submission,
      questionProgress,
      gapTopics: Array.isArray(submission.gapTopics) ? submission.gapTopics : [],
      savedPaperQuestionCount: submission.savedPaperQuestionCount ?? legacy.questionCount ?? questionProgress.length,
      confirmedCount: submission.confirmedCount ?? legacy.scoredCount ?? 0,
      aiSuggestedCount: submission.aiSuggestedCount ?? 0,
      confirmedAwardedMarks: submission.confirmedAwardedMarks ?? legacy.totalAwardedMarks ?? 0,
      confirmedMaxMarks: submission.confirmedMaxMarks ?? legacy.totalMaxMarks ?? 0,
      paperMaxMarks: submission.paperMaxMarks ?? legacy.totalMaxMarks ?? 0,
      reviewRequiredCount: submission.reviewRequiredCount ?? 0,
    };
  });

  return (
    <AppShell active="mark">
      <MarkingDashboard initialSavedPapers={savedPapers} initialSubmissions={normalizedSubmissions} userName={user.name ?? "there"} initialLoadError={initialLoadError} />
    </AppShell>
  );
}
