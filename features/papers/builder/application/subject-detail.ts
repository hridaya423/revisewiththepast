import { buildRealPaperBenchmark } from "../infrastructure/benchmarking";
import {
  getPaperMakerQuestionBankFromConvex,
  getSubjectDetailSnapshotFromConvex,
  upsertSubjectDetailSnapshotInConvex,
} from "../../infrastructure/question-bank";
import { getPaperMakerSubject } from "../domain/subjects";
import { groupQuestionUnitsForSubject } from "../../infrastructure/units";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import { NotFoundError } from "@/shared/application/errors";
import { buildSubjectDetailParts } from "./subject-detail-policies";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";

type SubjectDetail = {
  key: PaperMakerSubjectKey;
  taggedQuestionUnits: number;
  benchmarkMinutesPerMark: number | null;
  topics: TopicTreeNodeWithCounts[];
  topicsByTier?: Partial<Record<"foundation" | "higher", TopicTreeNodeWithCounts[]>>;
  tiers: Array<{ key: "foundation" | "higher"; label: string; taggedQuestionUnits: number }>;
  detailLoaded: true;
};

export async function getSubjectDetail(subjectKey: string) {
  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) throw new NotFoundError("Unknown subject selection.");

  const useCachedSnapshot = subject.key !== "edexcel-french-reading";
  const cachedSnapshot = useCachedSnapshot ? await getSubjectDetailSnapshotFromConvex(subject.boardCode, subject.subjectSlug) : null;
  if (cachedSnapshot) return cachedSnapshot;

  const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug, { cache: true });
  const filteredQuestionBank = subject.key === "edexcel-french-reading"
    ? questionBank.filter((part) => part.paperCode === "reading")
    : questionBank;
  const units = groupQuestionUnitsForSubject(subject.key, filteredQuestionBank);
  const benchmark = buildRealPaperBenchmark(units);
  const detailParts = buildSubjectDetailParts(subject, units);

  const snapshot: SubjectDetail = {
    key: subject.key,
    taggedQuestionUnits: detailParts.taggedQuestionUnits ?? units.length,
    benchmarkMinutesPerMark: benchmark.averageMinutesPerMark,
    topics: detailParts.topics,
    topicsByTier: detailParts.topicsByTier,
    tiers: detailParts.tiers,
    detailLoaded: true,
  };
  try {
    await upsertSubjectDetailSnapshotInConvex(subject.boardCode, subject.subjectSlug, snapshot);
  } catch (error) {
    console.error("Failed to persist subject detail snapshot", {
      boardCode: subject.boardCode,
      subjectSlug: subject.subjectSlug,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return snapshot;
}
