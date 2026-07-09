import { NextRequest } from "next/server";

import { buildAqaBusinessTopicTreeWithCounts } from "@/lib/paper-maker/aqa-business";
import { buildAqaEnglishLanguageTopicTreeWithCounts } from "@/lib/paper-maker/aqa-english-language";
import { buildAqaEnglishLiteratureTopicTreeWithCounts } from "@/lib/paper-maker/aqa-english-literature";
import type { TopicTreeNodeWithCounts } from "@/lib/paper-maker/aqa-geography";
import { buildTopicTreeWithCounts } from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark } from "@/lib/paper-maker/benchmarks";
import {
  buildCombinedScienceTopicTreeWithCounts,
  countCombinedScienceUnitsByTier,
  countUnitsByTier,
  filterCombinedScienceUnitsByTier,
  filterUnitsByTier,
} from "@/lib/paper-maker/combined-science";
import {
  getPaperMakerQuestionBankFromConvex,
  getSubjectDetailSnapshotFromConvex,
  upsertSubjectDetailSnapshotInConvex,
} from "@/lib/paper-maker/convex";
import { buildEdexcelBusinessTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-business";
import { buildEdexcelFrenchTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-french";
import { buildEdexcelMathematicsTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-mathematics";
import { buildEdexcelSeparateScienceTopicTreeWithCounts } from "@/lib/paper-maker/edexcel-separate-science";
import { buildOcrComputerScienceTopicTreeWithCounts } from "@/lib/paper-maker/ocr-computer-science";
import { getPaperMakerSubject, type PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";
import { groupQuestionUnitsForSubject } from "@/lib/paper-maker/units";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function GET(request: NextRequest) {
  const subjectKey = request.nextUrl.searchParams.get("subjectKey") as PaperMakerSubjectKey | null;
  const subject = getPaperMakerSubject(subjectKey ?? undefined);
  if (!subject) return badRequest("Unknown subject selection.");

  const useCachedSnapshot = subject.key !== "edexcel-french-reading";
  const cachedSnapshot = useCachedSnapshot ? await getSubjectDetailSnapshotFromConvex(subject.boardCode, subject.subjectSlug) : null;
  if (cachedSnapshot) {
    return Response.json(cachedSnapshot);
  }

  const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug, { cache: true });
  const filteredQuestionBank = subject.key === "edexcel-french-reading"
    ? questionBank.filter((part) => part.paperCode === "reading")
    : questionBank;
  const units = groupQuestionUnitsForSubject(subject.key, filteredQuestionBank);
  const benchmark = buildRealPaperBenchmark(units);

  let topics: TopicTreeNodeWithCounts[] = [];
  let topicsByTier: Partial<Record<"foundation" | "higher", TopicTreeNodeWithCounts[]>> | undefined;
  let tiers: Array<{ key: "foundation" | "higher"; label: string; taggedQuestionUnits: number }> = [];
  let taggedQuestionUnits = units.length;

  if (subject.key === "aqa-geography") {
    topics = buildTopicTreeWithCounts(units);
  } else if (subject.key === "aqa-business") {
    topics = buildAqaBusinessTopicTreeWithCounts(units);
  } else if (subject.key === "aqa-english-language") {
    topics = buildAqaEnglishLanguageTopicTreeWithCounts(units);
  } else if (subject.key === "aqa-english-literature") {
    topics = buildAqaEnglishLiteratureTopicTreeWithCounts(units);
  } else if (subject.key === "edexcel-business") {
    topics = buildEdexcelBusinessTopicTreeWithCounts(units);
  } else if (subject.key === "edexcel-mathematics-higher") {
    const higherUnits = filterUnitsByTier(units, "higher");
    taggedQuestionUnits = higherUnits.length;
    topics = buildEdexcelMathematicsTopicTreeWithCounts(higherUnits);
  } else if (subject.key === "edexcel-french-reading") {
    const tierCounts = countUnitsByTier(units);
    topicsByTier = {
      foundation: buildEdexcelFrenchTopicTreeWithCounts(filterUnitsByTier(units, "foundation")),
      higher: buildEdexcelFrenchTopicTreeWithCounts(filterUnitsByTier(units, "higher")),
    };
    tiers = subject.tiers.map((tier) => ({
      ...tier,
      taggedQuestionUnits: tierCounts[tier.key],
    }));
  } else if (subject.key === "ocr-computer-science") {
    topics = buildOcrComputerScienceTopicTreeWithCounts(units);
  } else if (subject.key === "edexcel-combined-science") {
    const tierCounts = countCombinedScienceUnitsByTier(units);
    const foundationUnits = filterCombinedScienceUnitsByTier(units, "foundation");
    const higherUnits = filterCombinedScienceUnitsByTier(units, "higher");
    topicsByTier = {
      foundation: buildCombinedScienceTopicTreeWithCounts(foundationUnits),
      higher: buildCombinedScienceTopicTreeWithCounts(higherUnits),
    };
    tiers = subject.tiers.map((tier) => ({
      ...tier,
      taggedQuestionUnits: tierCounts[tier.key],
    }));
  } else if (subject.key === "edexcel-biology" || subject.key === "edexcel-chemistry" || subject.key === "edexcel-physics") {
    const tierCounts = countUnitsByTier(units);
    const subjectSlug = subject.subjectSlug as "biology" | "chemistry" | "physics";
    topicsByTier = {
      foundation: buildEdexcelSeparateScienceTopicTreeWithCounts(subjectSlug, filterUnitsByTier(units, "foundation")),
      higher: buildEdexcelSeparateScienceTopicTreeWithCounts(subjectSlug, filterUnitsByTier(units, "higher")),
    };
    tiers = subject.tiers.map((tier) => ({
      ...tier,
      taggedQuestionUnits: tierCounts[tier.key],
    }));
  }

  const snapshot = {
    key: subject.key,
    taggedQuestionUnits,
    benchmarkMinutesPerMark: benchmark.averageMinutesPerMark,
    topics,
    topicsByTier,
    tiers,
    detailLoaded: true,
  };

  await upsertSubjectDetailSnapshotInConvex(subject.boardCode, subject.subjectSlug, snapshot);

  return Response.json(snapshot);
}
