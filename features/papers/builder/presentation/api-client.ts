import { z } from "zod";

import { generatePaperRequestSchema, type GeneratePaperRequest } from "../contracts/generate-paper";

import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { SubjectTierKey } from "@/shared/domain/subject";
import type { GenerationJobSnapshot } from "../domain/generation-job";

type GenerationJobRequest = z.input<typeof generatePaperRequestSchema>;

export class PaperMakerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

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
  return new PaperMakerRequestError(text || fallback, response.status);
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
    generationReceiptId: response.headers.get("X-Generation-Receipt"),
  };
}

export type { GenerationJobSnapshot, GenerationJobPaperMeta } from "../domain/generation-job";

export async function startPaperGenerationJob(input: { request: GenerationJobRequest; paperCount: number; includeMarkScheme: boolean; requestKey: string }, signal?: AbortSignal) {
  const response = await fetch("/api/paper-maker/generation-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await responseError(response, "Failed to start paper generation.");
  return await response.json() as GenerationJobSnapshot;
}

export async function fetchPaperGenerationJob(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/paper-maker/generation-jobs?jobId=${encodeURIComponent(jobId)}`, { signal });
  if (!response.ok) throw await responseError(response, "Could not check generation progress.");
  return await response.json() as GenerationJobSnapshot;
}

export async function cancelPaperGenerationJob(jobId: string, runVersion = 0) {
  const response = await fetch("/api/paper-maker/generation-jobs/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, runVersion }),
  });
  return response.ok;
}

export async function downloadPaperGenerationFile(jobId: string, part: string, signal?: AbortSignal) {
  const response = await fetch(`/api/paper-maker/generation-jobs/download?jobId=${encodeURIComponent(jobId)}&part=${encodeURIComponent(part)}`, { signal });
  if (!response.ok) throw await responseError(response, "Could not download the generated file.");
  return await response.blob();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPaperGenerationJob(input: { request: GenerationJobRequest; paperCount: number; includeMarkScheme: boolean }, options?: { onUpdate?: (job: GenerationJobSnapshot) => void; signal?: AbortSignal }) {
  const started = await startPaperGenerationJob({ ...input, requestKey: crypto.randomUUID() }, options?.signal);
  options?.onUpdate?.(started);
  let job = started;
  while (job.status !== "succeeded" && job.status !== "failed" && job.status !== "cancelled") {
    if (options?.signal?.aborted) {
      await cancelPaperGenerationJob(job.jobId).catch(() => {});
      throw new DOMException("Generation cancelled.", "AbortError");
    }
    await wait(700);
    job = await fetchPaperGenerationJob(job.jobId, options?.signal);
    options?.onUpdate?.(job);
  }
  if (job.status === "cancelled") throw new DOMException("Generation cancelled.", "AbortError");
  if (job.status === "failed") throw new Error(job.error ?? "Failed to generate paper. Try again.");
  return job;
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
