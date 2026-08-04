import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";

export type { PaperBuildTargetMode } from "@/shared/domain/subject";

export const MIN_MARKS = 10;
export const MAX_MARKS = 120;
export const MIN_TIME_MINUTES = 15;
export const MAX_TIME_MINUTES = 300;

export type SubjectTopicOption<T extends { id: string } = { id: string }> = {
  tiers: { key: SubjectTierKey }[];
  topics: T[];
  topicsByTier?: Partial<Record<SubjectTierKey, T[]>>;
};

export function clampMarks(value: number) {
  return Math.max(MIN_MARKS, Math.min(MAX_MARKS, Math.round(value)));
}

export function clampTimeMinutes(value: number) {
  return Math.max(MIN_TIME_MINUTES, Math.min(MAX_TIME_MINUTES, Math.round(value / 5) * 5 || MIN_TIME_MINUTES));
}

export function recommendedPaperCodes(subjectKey: PaperMakerSubjectKey, selectedLeafIds: Set<string>, defaults: string[]) {
  if (selectedLeafIds.size === 0) return defaults;
  const ids = Array.from(selectedLeafIds).join(" ").toLowerCase();
  const selected = new Set<string>();

  if (subjectKey === "edexcel-combined-science") {
    if (ids.includes("biology")) ["biology-1", "biology-2"].forEach((code) => selected.add(code));
    if (ids.includes("chemistry")) ["chemistry-1", "chemistry-2"].forEach((code) => selected.add(code));
    if (ids.includes("physics")) ["physics-1", "physics-2"].forEach((code) => selected.add(code));
  }
  if (subjectKey === "aqa-english-language" || subjectKey === "aqa-english-literature") {
    if (ids.includes("paper-1")) selected.add("paper-1");
    if (ids.includes("paper-2")) selected.add("paper-2");
  }
  if (subjectKey === "aqa-geography") {
    if (["natural-hazards", "living-world", "physical-landscapes"].some((id) => ids.includes(id))) selected.add("paper-1");
    if (["urban-issues", "changing-economic-world", "resource-management"].some((id) => ids.includes(id))) selected.add("paper-2");
    if (["issue-evaluation", "fieldwork"].some((id) => ids.includes(id))) selected.add("paper-3");
  }
  return selected.size > 0 ? defaults.filter((code) => selected.has(code)) : defaults;
}

export function resolveMinutesPerMark(benchmarkMinutesPerMark: number | null | undefined, recommendedMinutesPerMark: number | undefined) {
  const fallback = recommendedMinutesPerMark && Number.isFinite(recommendedMinutesPerMark) && recommendedMinutesPerMark > 0 ? recommendedMinutesPerMark : 1;
  if (!benchmarkMinutesPerMark || !Number.isFinite(benchmarkMinutesPerMark)) return fallback;
  if (benchmarkMinutesPerMark < 0.5 || benchmarkMinutesPerMark > 3) return fallback;
  return benchmarkMinutesPerMark;
}

export function estimatePaperTimeMinutes(minutesPerMark: number, totalMarks: number) {
  const rawMinutes = Math.max(MIN_TIME_MINUTES, Math.round(totalMarks * minutesPerMark));
  return clampTimeMinutes(rawMinutes);
}

export function estimateTargetMarksFromTimeMinutes(timeMinutes: number, benchmarkMinutesPerMark: number | null, fallbackMinutesPerMark: number) {
  const minutesPerMark = benchmarkMinutesPerMark && Number.isFinite(benchmarkMinutesPerMark) && benchmarkMinutesPerMark > 0
    ? benchmarkMinutesPerMark
    : fallbackMinutesPerMark;

  return Math.max(1, Math.min(200, Math.round(timeMinutes / minutesPerMark)));
}

export function resolveSubjectTopics<T extends { id: string }>(subject: SubjectTopicOption<T> | undefined, tierKey: SubjectTierKey): T[] {
  if (!subject) return [];
  if (subject.tiers.length > 0) return subject.topicsByTier?.[tierKey] ?? [];
  return subject.topics;
}

export function defaultTimeForMarks(minutesPerMark: number, marks: number) {
  return clampTimeMinutes(estimatePaperTimeMinutes(minutesPerMark, marks));
}
