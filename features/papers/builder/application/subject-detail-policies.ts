import { buildAqaBusinessTopicTreeWithCounts } from "../infrastructure/subjects/aqa-business";
import { buildAqaEnglishLanguageTopicTreeWithCounts } from "../infrastructure/subjects/aqa-english-language";
import { buildAqaEnglishLiteratureTopicTreeWithCounts } from "../infrastructure/subjects/aqa-english-literature";
import { buildTopicTreeWithCounts } from "../domain/subjects/aqa-geography";
import {
  buildCombinedScienceTopicTreeWithCounts,
  countCombinedScienceUnitsByTier,
  countUnitsByTier,
  filterCombinedScienceUnitsByTier,
  filterUnitsByTier,
} from "../domain/subjects/combined-science";
import { buildEdexcelBusinessTopicTreeWithCounts } from "../infrastructure/subjects/edexcel-business";
import { buildEdexcelFrenchTopicTreeWithCounts } from "../infrastructure/subjects/edexcel-french";
import { buildEdexcelMathematicsTopicTreeWithCounts } from "../infrastructure/subjects/edexcel-mathematics";
import { buildEdexcelSeparateScienceTopicTreeWithCounts } from "../infrastructure/subjects/edexcel-separate-science";
import { buildOcrComputerScienceTopicTreeWithCounts } from "../infrastructure/subjects/ocr-computer-science";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { PaperMakerSubjectDefinition, SubjectTierKey } from "@/shared/domain/subject";
import type { QuestionUnit } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";

type SubjectDetailParts = {
  taggedQuestionUnits?: number;
  topics: TopicTreeNodeWithCounts[];
  topicsByTier?: Partial<Record<SubjectTierKey, TopicTreeNodeWithCounts[]>>;
  tiers: Array<{ key: SubjectTierKey; label: string; taggedQuestionUnits: number }>;
};

type SubjectDetailPolicy = (subject: PaperMakerSubjectDefinition, units: QuestionUnit[]) => SubjectDetailParts;

function buildTieredParts(
  subject: PaperMakerSubjectDefinition,
  units: QuestionUnit[],
  countByTier: (units: QuestionUnit[]) => Record<SubjectTierKey, number>,
  buildTopics: (units: QuestionUnit[]) => TopicTreeNodeWithCounts[],
  filterByTier: (units: QuestionUnit[], tier: SubjectTierKey) => QuestionUnit[],
): SubjectDetailParts {
  const tierCounts = countByTier(units);
  return {
    topics: [],
    topicsByTier: {
      foundation: buildTopics(filterByTier(units, "foundation")),
      higher: buildTopics(filterByTier(units, "higher")),
    },
    tiers: subject.tiers.map((tier) => ({ ...tier, taggedQuestionUnits: tierCounts[tier.key] })),
  };
}

const SUBJECT_DETAIL_POLICIES: Partial<Record<PaperMakerSubjectKey, SubjectDetailPolicy>> = {
  "aqa-geography": (_subject, units) => ({ topics: buildTopicTreeWithCounts(units), tiers: [] }),
  "aqa-business": (_subject, units) => ({ topics: buildAqaBusinessTopicTreeWithCounts(units), tiers: [] }),
  "aqa-english-language": (_subject, units) => ({ topics: buildAqaEnglishLanguageTopicTreeWithCounts(units), tiers: [] }),
  "aqa-english-literature": (_subject, units) => ({ topics: buildAqaEnglishLiteratureTopicTreeWithCounts(units), tiers: [] }),
  "edexcel-business": (_subject, units) => ({ topics: buildEdexcelBusinessTopicTreeWithCounts(units), tiers: [] }),
  "edexcel-mathematics-higher": (_subject, units) => {
    const higherUnits = filterUnitsByTier(units, "higher");
    return {
      taggedQuestionUnits: higherUnits.length,
      topics: buildEdexcelMathematicsTopicTreeWithCounts(higherUnits),
      tiers: [],
    };
  },
  "edexcel-french-reading": (subject, units) => buildTieredParts(
    subject,
    units,
    countUnitsByTier,
    buildEdexcelFrenchTopicTreeWithCounts,
    filterUnitsByTier,
  ),
  "ocr-computer-science": (_subject, units) => ({ topics: buildOcrComputerScienceTopicTreeWithCounts(units), tiers: [] }),
  "edexcel-combined-science": (subject, units) => buildTieredParts(
    subject,
    units,
    countCombinedScienceUnitsByTier,
    buildCombinedScienceTopicTreeWithCounts,
    filterCombinedScienceUnitsByTier,
  ),
  "edexcel-biology": (subject, units) => buildTieredParts(
    subject,
    units,
    countUnitsByTier,
    (tierUnits) => buildEdexcelSeparateScienceTopicTreeWithCounts("biology", tierUnits),
    filterUnitsByTier,
  ),
  "edexcel-chemistry": (subject, units) => buildTieredParts(
    subject,
    units,
    countUnitsByTier,
    (tierUnits) => buildEdexcelSeparateScienceTopicTreeWithCounts("chemistry", tierUnits),
    filterUnitsByTier,
  ),
  "edexcel-physics": (subject, units) => buildTieredParts(
    subject,
    units,
    countUnitsByTier,
    (tierUnits) => buildEdexcelSeparateScienceTopicTreeWithCounts("physics", tierUnits),
    filterUnitsByTier,
  ),
};

export function buildSubjectDetailParts(subject: PaperMakerSubjectDefinition, units: QuestionUnit[]) {
  return SUBJECT_DETAIL_POLICIES[subject.key]?.(subject, units) ?? { topics: [], tiers: [] };
}
