import { notFound } from "next/navigation";

import { MarkingSubmissionWorkspace, type MarkingSubmissionBundle } from "@/app/_components/marking-submission-workspace";
import { AppShell } from "@/app/_components/app-shell";
import { getMarkingSubmissionBundleFromConvex } from "@/lib/marking/convex";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ submissionId: string }>;
};

export default async function MarkingSubmissionPage({ params }: RouteContext) {
  const { submissionId } = await params;
  const bundle = await getMarkingSubmissionBundleFromConvex(submissionId).catch(() => null);
  if (!bundle) notFound();

  return (
    <AppShell active="mark" wide>
      <MarkingSubmissionWorkspace submissionId={submissionId} initialBundle={bundle as MarkingSubmissionBundle} />
    </AppShell>
  );
}
