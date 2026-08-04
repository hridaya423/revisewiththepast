import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { AppShell } from "../_components/app-shell";
import { getPaperMakerPageData } from "@/features/papers/server";

export const revalidate = 300;

type PaperMakerPageSearchParams = {
  subject?: string | string[];
  tier?: string | string[];
  topics?: string | string[];
};

export default async function PaperMakerPage({
  searchParams,
}: {
  searchParams?: Promise<PaperMakerPageSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedSubject = typeof resolvedSearchParams?.subject === "string" ? resolvedSearchParams.subject : undefined;
  const requestedTier = typeof resolvedSearchParams?.tier === "string" ? resolvedSearchParams.tier : undefined;
  const requestedTopics = typeof resolvedSearchParams?.topics === "string"
    ? resolvedSearchParams.topics.split(",").map((topic) => topic.trim()).filter(Boolean)
    : [];
  const pageData = await getPaperMakerPageData({ requestedSubject, requestedTier, requestedTopics });

  return (
    <AppShell active="build">
      <PaperMakerWorkspace
        subjectOptions={pageData.subjectOptions}
        initialSubjectKey={pageData.initialSubjectKey}
        initialTier={pageData.initialTier}
        initialTopicIds={pageData.initialTopicIds}
      />
    </AppShell>
  );
}
