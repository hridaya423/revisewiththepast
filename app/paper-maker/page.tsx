import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { AppShell } from "../_components/app-shell";
import { getTaggingCountsFromConvex } from "@/lib/paper-maker/convex";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import { getPaperMakerSubject, PAPER_MAKER_SUBJECTS } from "@/lib/paper-maker/subjects";

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
  const requestedTier = resolvedSearchParams?.tier === "foundation" || resolvedSearchParams?.tier === "higher"
    ? resolvedSearchParams.tier
    : undefined;
  const requestedTopics = typeof resolvedSearchParams?.topics === "string"
    ? resolvedSearchParams.topics.split(",").map((topic) => topic.trim()).filter(Boolean)
    : [];
  const initialSubjectKey = getPaperMakerSubject(requestedSubject)?.key;
  const taggingCounts = await getTaggingCountsFromConvex();
  const countsByBoardSubject = new Map(
    taggingCounts.byBoardSubject.map((row) => [`${row.boardCode}::${row.subjectSlug}`, row]),
  );

  const subjectOptions = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled).map((subject) => {
    const counts = countsByBoardSubject.get(`${subject.boardCode}::${subject.subjectSlug}`);
    return {
      key: subject.key,
      label: subject.label,
      boardLabel: subject.boardLabel,
      description: subject.description,
      taggedQuestionUnits: counts?.taggedQuestionParts ?? 0,
      topicSelectionEnabled: subject.topicSelectionEnabled,
      generationEnabled: subject.generationEnabled,
      availabilityNote: subject.availabilityNote,
      recommendedMinutesPerMark: subject.recommendedMinutesPerMark,
      benchmarkMinutesPerMark: null,
      paperOptions: subject.paperOptions,
      defaultPaperCodes: subject.defaultPaperCodes,
      topics: [],
      topicsByTier: undefined,
      tiers: subject.tiers.map((tier) => ({
        ...tier,
        taggedQuestionUnits: 0,
      })),
      detailLoaded: false,
    };
  });

  return (
    <AppShell active="build">
      <PaperMakerWorkspace
        subjectOptions={subjectOptions}
        initialSubjectKey={initialSubjectKey}
        initialTier={requestedTier as SubjectTierKey | undefined}
        initialTopicIds={requestedTopics}
      />
    </AppShell>
  );
}
