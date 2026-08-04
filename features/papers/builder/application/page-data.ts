import type { SubjectTierKey } from "@/shared/domain/subject";
import { getTaggingCountsFromConvex } from "../../infrastructure/question-bank";
import { getPaperMakerSubject, PAPER_MAKER_SUBJECTS } from "../domain/subjects";

export async function getPaperMakerPageData(input: {
  requestedSubject?: string;
  requestedTier?: string;
  requestedTopics?: string[];
}) {
  const initialTier = input.requestedTier === "foundation" || input.requestedTier === "higher"
    ? input.requestedTier as SubjectTierKey
    : undefined;
  const initialSubjectKey = getPaperMakerSubject(input.requestedSubject)?.key;
  const taggingCounts = await getTaggingCountsFromConvex();
  const countsByBoardSubject = new Map(
    taggingCounts.byBoardSubject.map((row) => [`${row.boardCode}::${row.subjectSlug}`, row]),
  );

  const subjectOptions = PAPER_MAKER_SUBJECTS
    .filter((subject) => subject.generationEnabled)
    .map((subject) => {
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

  return {
    subjectOptions,
    initialSubjectKey,
    initialTier,
    initialTopicIds: input.requestedTopics ?? [],
  };
}
