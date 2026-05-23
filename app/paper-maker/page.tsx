import Link from "next/link";
import { PaperMakerWorkspace } from "../_components/paper-maker-workspace";
import { buildAqaBusinessTopicTreeWithCounts } from "@/lib/paper-maker/aqa-business";
import { buildAqaEnglishLanguageTopicTreeWithCounts } from "@/lib/paper-maker/aqa-english-language";
import { buildAqaEnglishLiteratureTopicTreeWithCounts } from "@/lib/paper-maker/aqa-english-literature";
import { buildTopicTreeWithCounts, groupQuestionPartsIntoUnits } from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark } from "@/lib/paper-maker/benchmarks";
import {
  countUnitsByTier,
  buildCombinedScienceTopicTreeWithCounts,
  countCombinedScienceUnitsByTier,
  filterCombinedScienceUnitsByTier,
  filterUnitsByTier,
} from "@/lib/paper-maker/combined-science";
import { buildEdexcelBusinessTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-business";
import { buildEdexcelMathematicsTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-mathematics";
import { buildEdexcelSeparateScienceTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-separate-science";
import { buildOcrComputerScienceTopicTreeWithCounts } from "@/lib/paper-maker/ocr-computer-science";
import { getPaperMakerQuestionBankFromConvex } from "@/lib/paper-maker/convex";
import { PAPER_MAKER_SUBJECTS } from "@/lib/paper-maker/subjects";

export const revalidate = 300;

export default async function PaperMakerPage() {
  const [aqaGeographyQuestionBank, edexcelCombinedScienceQuestionBank, edexcelBiologyQuestionBank, edexcelChemistryQuestionBank, edexcelPhysicsQuestionBank, aqaBusinessQuestionBank, edexcelBusinessQuestionBank, edexcelMathematicsQuestionBank, aqaEnglishLanguageQuestionBank, aqaEnglishLiteratureQuestionBank, ocrComputerScienceQuestionBank] = await Promise.all([
    getPaperMakerQuestionBankFromConvex("aqa", "geography"),
    getPaperMakerQuestionBankFromConvex("edexcel", "combined-science"),
    getPaperMakerQuestionBankFromConvex("edexcel", "biology"),
    getPaperMakerQuestionBankFromConvex("edexcel", "chemistry"),
    getPaperMakerQuestionBankFromConvex("edexcel", "physics"),
    getPaperMakerQuestionBankFromConvex("aqa", "business"),
    getPaperMakerQuestionBankFromConvex("edexcel", "business"),
    getPaperMakerQuestionBankFromConvex("edexcel", "mathematics"),
    getPaperMakerQuestionBankFromConvex("aqa", "english-language"),
    getPaperMakerQuestionBankFromConvex("aqa", "english-literature"),
    getPaperMakerQuestionBankFromConvex("ocr", "computer-science"),
  ]);

  const geographyUnits = groupQuestionPartsIntoUnits(aqaGeographyQuestionBank);
  const combinedScienceUnits = groupQuestionPartsIntoUnits(edexcelCombinedScienceQuestionBank);
  const edexcelBiologyUnits = groupQuestionPartsIntoUnits(edexcelBiologyQuestionBank);
  const edexcelChemistryUnits = groupQuestionPartsIntoUnits(edexcelChemistryQuestionBank);
  const edexcelPhysicsUnits = groupQuestionPartsIntoUnits(edexcelPhysicsQuestionBank);
  const businessUnits = groupQuestionPartsIntoUnits(aqaBusinessQuestionBank);
  const edexcelBusinessUnits = groupQuestionPartsIntoUnits(edexcelBusinessQuestionBank);
  const englishLanguageUnits = groupQuestionPartsIntoUnits(aqaEnglishLanguageQuestionBank);
  const englishLiteratureUnits = groupQuestionPartsIntoUnits(aqaEnglishLiteratureQuestionBank);
  const ocrComputerScienceUnits = groupQuestionPartsIntoUnits(ocrComputerScienceQuestionBank);
  const mathematicsUnits = groupQuestionPartsIntoUnits(edexcelMathematicsQuestionBank);
  const mathematicsHigherUnits = filterUnitsByTier(mathematicsUnits, "higher");
  const combinedScienceTierCounts = countCombinedScienceUnitsByTier(combinedScienceUnits);
  const edexcelBiologyTierCounts = countUnitsByTier(edexcelBiologyUnits);
  const edexcelChemistryTierCounts = countUnitsByTier(edexcelChemistryUnits);
  const edexcelPhysicsTierCounts = countUnitsByTier(edexcelPhysicsUnits);
  const geographyTopics = buildTopicTreeWithCounts(geographyUnits);
  const businessTopics = buildAqaBusinessTopicTreeWithCounts(businessUnits);
  const edexcelBusinessTopics = buildEdexcelBusinessTopicTreeWithCounts(edexcelBusinessUnits);
  const englishLanguageTopics = buildAqaEnglishLanguageTopicTreeWithCounts(englishLanguageUnits);
  const englishLiteratureTopics = buildAqaEnglishLiteratureTopicTreeWithCounts(englishLiteratureUnits);
  const edexcelBiologyTopicsByTier = {
    foundation: buildEdexcelSeparateScienceTopicTreeWithCounts("biology", filterUnitsByTier(edexcelBiologyUnits, "foundation")),
    higher: buildEdexcelSeparateScienceTopicTreeWithCounts("biology", filterUnitsByTier(edexcelBiologyUnits, "higher")),
  };
  const edexcelChemistryTopicsByTier = {
    foundation: buildEdexcelSeparateScienceTopicTreeWithCounts("chemistry", filterUnitsByTier(edexcelChemistryUnits, "foundation")),
    higher: buildEdexcelSeparateScienceTopicTreeWithCounts("chemistry", filterUnitsByTier(edexcelChemistryUnits, "higher")),
  };
  const edexcelPhysicsTopicsByTier = {
    foundation: buildEdexcelSeparateScienceTopicTreeWithCounts("physics", filterUnitsByTier(edexcelPhysicsUnits, "foundation")),
    higher: buildEdexcelSeparateScienceTopicTreeWithCounts("physics", filterUnitsByTier(edexcelPhysicsUnits, "higher")),
  };
  const ocrComputerScienceTopics = buildOcrComputerScienceTopicTreeWithCounts(ocrComputerScienceUnits);
  const mathematicsHigherTopics = buildEdexcelMathematicsTopicTreeWithCounts(mathematicsHigherUnits);
  const combinedScienceFoundationUnits = filterCombinedScienceUnitsByTier(combinedScienceUnits, "foundation");
  const combinedScienceHigherUnits = filterCombinedScienceUnitsByTier(combinedScienceUnits, "higher");
  const combinedScienceTopicsByTier = {
    foundation: buildCombinedScienceTopicTreeWithCounts(combinedScienceFoundationUnits),
    higher: buildCombinedScienceTopicTreeWithCounts(combinedScienceHigherUnits),
  };
  const geographyBenchmark = buildRealPaperBenchmark(geographyUnits);
  const combinedScienceBenchmark = buildRealPaperBenchmark(combinedScienceUnits);
  const edexcelBiologyBenchmark = buildRealPaperBenchmark(edexcelBiologyUnits);
  const edexcelChemistryBenchmark = buildRealPaperBenchmark(edexcelChemistryUnits);
  const edexcelPhysicsBenchmark = buildRealPaperBenchmark(edexcelPhysicsUnits);
  const businessBenchmark = buildRealPaperBenchmark(businessUnits);
  const edexcelBusinessBenchmark = buildRealPaperBenchmark(edexcelBusinessUnits);
  const englishLanguageBenchmark = buildRealPaperBenchmark(englishLanguageUnits);
  const englishLiteratureBenchmark = buildRealPaperBenchmark(englishLiteratureUnits);
  const ocrComputerScienceBenchmark = buildRealPaperBenchmark(ocrComputerScienceUnits);
  const mathematicsHigherBenchmark = buildRealPaperBenchmark(mathematicsHigherUnits);
  const unitCountBySubject = {
    "aqa-geography": geographyUnits.length,
    "aqa-business": businessUnits.length,
    "aqa-english-language": englishLanguageUnits.length,
    "aqa-english-literature": englishLiteratureUnits.length,
    "edexcel-business": edexcelBusinessUnits.length,
    "edexcel-combined-science": combinedScienceUnits.length,
    "edexcel-biology": edexcelBiologyUnits.length,
    "edexcel-chemistry": edexcelChemistryUnits.length,
    "edexcel-physics": edexcelPhysicsUnits.length,
    "edexcel-mathematics-higher": mathematicsHigherUnits.length,
    "ocr-computer-science": ocrComputerScienceUnits.length,
  } as const;
  const benchmarkBySubject = {
    "aqa-geography": geographyBenchmark,
    "aqa-business": businessBenchmark,
    "aqa-english-language": englishLanguageBenchmark,
    "aqa-english-literature": englishLiteratureBenchmark,
    "edexcel-business": edexcelBusinessBenchmark,
    "edexcel-combined-science": combinedScienceBenchmark,
    "edexcel-biology": edexcelBiologyBenchmark,
    "edexcel-chemistry": edexcelChemistryBenchmark,
    "edexcel-physics": edexcelPhysicsBenchmark,
    "edexcel-mathematics-higher": mathematicsHigherBenchmark,
    "ocr-computer-science": ocrComputerScienceBenchmark,
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
        : subject.key === "edexcel-business"
          ? edexcelBusinessTopics
        : subject.key === "aqa-english-language"
          ? englishLanguageTopics
        : subject.key === "aqa-english-literature"
          ? englishLiteratureTopics
        : subject.key === "edexcel-biology" || subject.key === "edexcel-chemistry" || subject.key === "edexcel-physics"
          ? []
        : subject.key === "edexcel-mathematics-higher"
          ? mathematicsHigherTopics
        : subject.key === "ocr-computer-science"
          ? ocrComputerScienceTopics
        : [],
    topicsByTier: subject.key === "edexcel-combined-science"
      ? combinedScienceTopicsByTier
      : subject.key === "edexcel-biology"
        ? edexcelBiologyTopicsByTier
      : subject.key === "edexcel-chemistry"
        ? edexcelChemistryTopicsByTier
      : subject.key === "edexcel-physics"
        ? edexcelPhysicsTopicsByTier
      : undefined,
    tiers: subject.key === "edexcel-combined-science"
      ? subject.tiers.map((tier) => ({
          ...tier,
          taggedQuestionUnits: combinedScienceTierCounts[tier.key],
        }))
      : subject.key === "edexcel-biology"
        ? subject.tiers.map((tier) => ({
            ...tier,
            taggedQuestionUnits: edexcelBiologyTierCounts[tier.key],
          }))
      : subject.key === "edexcel-chemistry"
        ? subject.tiers.map((tier) => ({
            ...tier,
            taggedQuestionUnits: edexcelChemistryTierCounts[tier.key],
          }))
      : subject.key === "edexcel-physics"
        ? subject.tiers.map((tier) => ({
            ...tier,
            taggedQuestionUnits: edexcelPhysicsTierCounts[tier.key],
          }))
      : [],
  }));

  return (
    <div className="min-h-[100dvh] bg-[#f4f2ec]">
      <nav className="sticky top-0 z-50 border-b border-[#1a2e1a]/[0.06] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-6 sm:px-8 lg:px-12">
          <div className="flex items-center gap-5">
            <Link href="/" className="inline-flex items-center text-[0.82rem] font-medium text-[#1a2e1a]/60 transition-colors hover:text-[#1a2e1a]">
              &larr; Home
            </Link>
            <div className="h-5 w-px bg-[#1a2e1a]/12" />
            <span className="inline-flex items-center font-serif text-[1rem] tracking-[-0.02em] text-[#1a2e1a]">Revise with the Past</span>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <PaperMakerWorkspace subjectOptions={subjectOptions} />
      </main>
    </div>
  );
}
