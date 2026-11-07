import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { AppShell } from "../_components/app-shell";
import { getPaperMakerPageData } from "@/features/papers/builder/application/page-data";
import { z } from "zod";
import { ShadowPaperEntryLink, ShadowPaperPage } from "./shadow-paper-page";
import { shadowPapersEnabled } from "@/features/papers/shadow/infrastructure/feature-flag";

export const revalidate = 300;

type PaperMakerPageSearchParams = {
  subject?: string | string[];
  tier?: string | string[];
  topics?: string | string[];
  stage?: string | string[];
  job?: string | string[];
  mode?: string | string[];
  paper?: string | string[];
};

export default async function PaperMakerPage({
  searchParams,
}: {
  searchParams?: Promise<PaperMakerPageSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  if (resolvedSearchParams?.mode === "shadow" && (shadowPapersEnabled() || typeof resolvedSearchParams.job === "string")) {
    return <ShadowPaperPage paper={resolvedSearchParams.paper} job={resolvedSearchParams.job} />;
  }
  const requestedSubject = typeof resolvedSearchParams?.subject === "string" ? resolvedSearchParams.subject : undefined;
  const requestedTier = typeof resolvedSearchParams?.tier === "string" ? resolvedSearchParams.tier : undefined;
  const requestedTopics = typeof resolvedSearchParams?.topics === "string"
    ? resolvedSearchParams.topics.split(",").map((topic) => topic.trim()).filter(Boolean)
    : [];
  const pageData = await getPaperMakerPageData({ requestedSubject, requestedTier, requestedTopics });

  return (
    <AppShell active="build">
      {shadowPapersEnabled() ? <ShadowPaperEntryLink /> : null}
      <PaperMakerWorkspace
        subjectOptions={pageData.subjectOptions}
        initialSubjectKey={pageData.initialSubjectKey}
        initialTier={pageData.initialTier}
        initialTopicIds={pageData.initialTopicIds}
        initialStage={resolvedSearchParams?.stage === "subject" || resolvedSearchParams?.stage === "topics" || resolvedSearchParams?.stage === "paper" ? resolvedSearchParams.stage : undefined}
        initialJobId={z.uuid().safeParse(resolvedSearchParams?.job).success ? resolvedSearchParams?.job as string : undefined}
      />
    </AppShell>
  );
}
