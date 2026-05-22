import Link from "next/link";
import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { buildAqaBusinessTopicTreeWithCounts } from "@/lib/paper-maker/aqa-business";
import { buildAqaEnglishLanguageTopicTreeWithCounts } from "@/lib/paper-maker/aqa-english-language";
import { buildTopicTreeWithCounts, groupQuestionPartsIntoUnits } from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark } from "@/lib/paper-maker/benchmarks";
import {
  buildCombinedScienceTopicTreeWithCounts,
  countCombinedScienceUnitsByTier,
  filterCombinedScienceUnitsByTier,
  filterUnitsByTier,
} from "@/lib/paper-maker/combined-science";
import { buildEdexcelMathematicsTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-mathematics";
import { getPaperMakerQuestionBankFromConvex } from "@/lib/paper-maker/convex";
import { PAPER_MAKER_SUBJECTS } from "@/lib/paper-maker/subjects";

export const revalidate = 300;

export default async function PaperMakerPage() {
  const [aqaGeographyQuestionBank, edexcelCombinedScienceQuestionBank, aqaBusinessQuestionBank, edexcelMathematicsQuestionBank, aqaEnglishLanguageQuestionBank] = await Promise.all([
    getPaperMakerQuestionBankFromConvex("aqa", "geography"),
    getPaperMakerQuestionBankFromConvex("edexcel", "combined-science"),
    getPaperMakerQuestionBankFromConvex("aqa", "business"),
    getPaperMakerQuestionBankFromConvex("edexcel", "mathematics"),
    getPaperMakerQuestionBankFromConvex("aqa", "english-language"),
  ]);

  const geographyUnits = groupQuestionPartsIntoUnits(aqaGeographyQuestionBank);
  const combinedScienceUnits = groupQuestionPartsIntoUnits(edexcelCombinedScienceQuestionBank);
  const businessUnits = groupQuestionPartsIntoUnits(aqaBusinessQuestionBank);
  const englishLanguageUnits = groupQuestionPartsIntoUnits(aqaEnglishLanguageQuestionBank);
  const mathematicsUnits = groupQuestionPartsIntoUnits(edexcelMathematicsQuestionBank);
  const mathematicsHigherUnits = filterUnitsByTier(mathematicsUnits, "higher");
  const combinedScienceTierCounts = countCombinedScienceUnitsByTier(combinedScienceUnits);
  const geographyTopics = buildTopicTreeWithCounts(geographyUnits);
  const businessTopics = buildAqaBusinessTopicTreeWithCounts(businessUnits);
  const englishLanguageTopics = buildAqaEnglishLanguageTopicTreeWithCounts(englishLanguageUnits);
  const mathematicsHigherTopics = buildEdexcelMathematicsTopicTreeWithCounts(mathematicsHigherUnits);
  const combinedScienceFoundationUnits = filterCombinedScienceUnitsByTier(combinedScienceUnits, "foundation");
  const combinedScienceHigherUnits = filterCombinedScienceUnitsByTier(combinedScienceUnits, "higher");
  const combinedScienceTopicsByTier = {
    foundation: buildCombinedScienceTopicTreeWithCounts(combinedScienceFoundationUnits),
    higher: buildCombinedScienceTopicTreeWithCounts(combinedScienceHigherUnits),
  };
  const geographyBenchmark = buildRealPaperBenchmark(geographyUnits);
  const combinedScienceBenchmark = buildRealPaperBenchmark(combinedScienceUnits);
  const businessBenchmark = buildRealPaperBenchmark(businessUnits);
  const englishLanguageBenchmark = buildRealPaperBenchmark(englishLanguageUnits);
  const mathematicsHigherBenchmark = buildRealPaperBenchmark(mathematicsHigherUnits);
  const unitCountBySubject = {
    "aqa-geography": geographyUnits.length,
    "aqa-business": businessUnits.length,
    "aqa-english-language": englishLanguageUnits.length,
    "edexcel-combined-science": combinedScienceUnits.length,
    "edexcel-mathematics-higher": mathematicsHigherUnits.length,
  } as const;
  const benchmarkBySubject = {
    "aqa-geography": geographyBenchmark,
    "aqa-business": businessBenchmark,
    "aqa-english-language": englishLanguageBenchmark,
    "edexcel-combined-science": combinedScienceBenchmark,
    "edexcel-mathematics-higher": mathematicsHigherBenchmark,
  } as const;
  const subjectOptions = PAPER_MAKER_SUBJECTS.map((subject) => ({
    key: subject.key,
    label: subject.label,
    boardLabel: subject.boardLabel,
    description: subject.description,
    taggedQuestionUnits: unitCountBySubject[subject.key],
    topicSelectionEnabled: subject.topicSelectionEnabled,
    generationEnabled: subject.generationEnabled,
    availabilityNote: subject.availabilityNote,
    recommendedMinutesPerMark: subject.recommendedMinutesPerMark,
    benchmarkMinutesPerMark: benchmarkBySubject[subject.key].averageMinutesPerMark,
    paperOptions: subject.paperOptions,
    defaultPaperCodes: subject.defaultPaperCodes,
    topics: subject.key === "aqa-geography"
      ? geographyTopics
      : subject.key === "aqa-business"
        ? businessTopics
        : subject.key === "aqa-english-language"
          ? englishLanguageTopics
        : subject.key === "edexcel-mathematics-higher"
          ? mathematicsHigherTopics
        : [],
    topicsByTier: subject.key === "edexcel-combined-science" ? combinedScienceTopicsByTier : undefined,
    tiers: subject.key === "edexcel-combined-science"
      ? subject.tiers.map((tier) => ({
          ...tier,
          taggedQuestionUnits: combinedScienceTierCounts[tier.key],
        }))
      : [],
  }));

  return (
    <div className="min-h-[100dvh] bg-[#f4f2ec]">
      <nav className="sticky top-0 z-50 border-b border-[#1a2e1a]/[0.06] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center px-6 py-3 sm:px-8 lg:px-12">
          <Link href="/" className="font-serif text-[0.95rem] tracking-[-0.02em] text-[#1a2e1a]">
            Revise with the Past
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <PaperMakerWorkspace subjectOptions={subjectOptions} />
      </main>
    </div>
  );
}
