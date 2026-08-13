import { z } from "zod";

import type { GeneratePaperRequest } from "../contracts/generate-paper";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { SubjectTierKey } from "@/shared/domain/subject";

export type SubjectDetailResponse = {
  key: PaperMakerSubjectKey;
  taggedQuestionUnits: number;
  benchmarkMinutesPerMark: number | null;
  topics: TopicTreeNodeWithCounts[];
  topicsByTier?: Partial<Record<SubjectTierKey, TopicTreeNodeWithCounts[]>>;
  tiers: { key: SubjectTierKey; label: string; taggedQuestionUnits: number }[];
  detailLoaded: boolean;
};

const savedPaperResponseSchema = z.object({
  savedPaperId: z.string().optional(),
  pdfUrl: z.url().optional(),
});
const subjectDetailResponseSchema = z.custom<SubjectDetailResponse>((value) => {
  if (typeof value !== "object" || value === null) return false;
  return "key" in value
    && "taggedQuestionUnits" in value
    && "benchmarkMinutesPerMark" in value
    && "topics" in value
    && "tiers" in value
    && "detailLoaded" in value
    && typeof value.key === "string"
    && typeof value.taggedQuestionUnits === "number"
    && (value.benchmarkMinutesPerMark === null || typeof value.benchmarkMinutesPerMark === "number")
    && Array.isArray(value.topics)
    && Array.isArray(value.tiers)
    && typeof value.detailLoaded === "boolean";
}, "Invalid subject detail response.");

async function responseError(response: Response, fallback: string) {
  const text = await response.text();
  return new Error(text || fallback);
}

export async function requestSubjectDetail(subjectKey: PaperMakerSubjectKey, signal?: AbortSignal) {
  const response = await fetch(`/api/paper-maker/subject-detail?subjectKey=${encodeURIComponent(subjectKey)}`, { signal });
  if (!response.ok) throw await responseError(response, "Could not load this subject.");
  return subjectDetailResponseSchema.parse(await response.json());
}

export async function requestPaperGeneration(input: Omit<GeneratePaperRequest, "selectAllTopics"> & { selectAllTopics?: boolean }, signal?: AbortSignal) {
  const response = await fetch("/api/paper-maker/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await responseError(response, "Failed to generate paper.");
  return {
    blob: await response.blob(),
    questionCount: Number(response.headers.get("X-Question-Count") ?? 0),
    totalMarks: Number(response.headers.get("X-Total-Marks") ?? 0),
    coveredTopics: Number(response.headers.get("X-Covered-Topics") ?? 0),
    timeMinutes: Number(response.headers.get("X-Time-Minutes") ?? input.timeMinutes ?? 0),
    selectedSourceQuestionKeys: decodeHeaderLines(response.headers.get("X-Selected-Source-Question-Keys")),
    selectedUnitMarks: decodeHeaderLines(response.headers.get("X-Selected-Unit-Marks")).flatMap((value) => {
      const mark = Number(value);
      return Number.isFinite(mark) ? [mark] : [];
    }),
    coveredLeafTopicIds: decodeHeaderLines(response.headers.get("X-Covered-Leaf-Topic-Ids")),
    selectedUnitKeys: decodeHeaderLines(response.headers.get("X-Selected-Unit-Keys")),
  };
}

export async function requestSavedPaper(formData: FormData) {
  const response = await fetch("/api/paper-maker/save-generated", { method: "POST", body: formData });
  if (!response.ok) throw await responseError(response, "The paper downloaded, but saving it failed.");
  return savedPaperResponseSchema.parse(await response.json());
}

export async function requestMarkScheme(input: { subjectKey: string; subjectTier?: string; selectedUnitKeys: string[] }) {
  const response = await fetch("/api/paper-maker/generate-mark-scheme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response, "Failed to generate mark scheme.");
  return { blob: await response.blob(), failureCount: Number(response.headers.get("X-Mark-Scheme-Failures") ?? 0) };
}

function decodeHeaderLines(value: string | null) {
  if (!value) return [];
  try {
    return decodeURIComponent(value).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
