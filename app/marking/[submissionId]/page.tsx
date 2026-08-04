import { notFound } from "next/navigation";

import { MarkingSubmissionWorkspace } from "@/app/_components/marking-submission-workspace";
import { AppShell } from "@/app/_components/app-shell";
import { getSubmission } from "@/features/papers/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ submissionId: string }>;
};

export default async function MarkingSubmissionPage({ params }: RouteContext) {
  const { submissionId } = await params;
  const bundle = await getSubmission(submissionId).catch(() => null);
  if (!bundle) notFound();

  return (
    <AppShell active="mark" wide>
      <MarkingSubmissionWorkspace submissionId={submissionId} initialBundle={bundle} />
    </AppShell>
  );
}
