import Link from "next/link";

import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { UserMenu } from "../_components/user-menu";
import { getTaggingCountsFromConvex } from "@/lib/paper-maker/convex";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import { getPaperMakerSubject, PAPER_MAKER_SUBJECTS } from "@/lib/paper-maker/subjects";

export const revalidate = 300;

type PaperMakerPageSearchParams = {
  subject?: string | string[];
  tier?: string | string[];
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
  const initialSubjectKey = getPaperMakerSubject(requestedSubject)?.key;
  const taggingCounts = await getTaggingCountsFromConvex();
  const countsByBoardSubject = new Map(
    taggingCounts.byBoardSubject.map((row) => [`${row.boardCode}::${row.subjectSlug}`, row]),
  );

  const subjectOptions = PAPER_MAKER_SUBJECTS.map((subject) => {
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
    <div className="min-h-[100dvh] bg-[#f4f2ec]">
      <nav className="sticky top-0 z-50 border-b border-[#1a2e1a]/[0.06] bg-white/95 backdrop-blur-xl">
<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8 lg:px-12">
            <div className="flex items-center gap-5">
              <Link href="/" className="inline-flex items-center text-[0.82rem] font-medium text-[#1a2e1a]/60 transition-colors hover:text-[#1a2e1a]">
                &larr; Home
              </Link>
              <div className="h-5 w-px bg-[#1a2e1a]/12" />
              <span className="inline-flex items-center font-serif text-[1rem] tracking-[-0.02em] text-[#1a2e1a]">Revise with the Past</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/marking" className="inline-flex items-center rounded-full border border-[#1a2e1a]/10 bg-[#faf8f3] px-3.5 py-2 text-[0.78rem] font-medium text-[#1a2e1a] transition-colors hover:bg-white">
                Marking Studio
              </Link>
              <UserMenu />
            </div>
          </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <PaperMakerWorkspace
          subjectOptions={subjectOptions}
          initialSubjectKey={initialSubjectKey}
          initialTier={requestedTier as SubjectTierKey | undefined}
        />
      </main>
    </div>
  );
}
