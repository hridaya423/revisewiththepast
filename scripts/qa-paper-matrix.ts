import { PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";
import type { SubjectTierKey } from "@/shared/domain/subject";

export type QaPaperConfig = {
  configKey: string;
  groupKey: string;
  subjectKey: string;
  subjectTier: SubjectTierKey | null;
  paperCode: string;
};

export function buildQaPaperMatrix(subjectFilter: string): QaPaperConfig[] {
  const configs = PAPER_MAKER_SUBJECTS.flatMap((subject) => {
    if (!subject.generationEnabled) return [];
    const tiers = subject.tiers.length > 0 ? subject.tiers.map((tier) => tier.key) : [null];
    return tiers.flatMap((subjectTier) => {
      const groupKey = subjectTier ? `${subject.key}-${subjectTier}` : subject.key;
      return subject.paperOptions.map((paper) => ({
        configKey: `${groupKey}-${paper.code}`,
        groupKey,
        subjectKey: subject.key,
        subjectTier,
        paperCode: paper.code,
      }));
    });
  });

  if (subjectFilter === "all") return configs;
  const filtered = configs.filter((config) => (
    config.configKey === subjectFilter
    || config.groupKey === subjectFilter
    || config.subjectKey === subjectFilter
  ));
  if (filtered.length > 0) return filtered;
  throw new Error(`Unknown subject "${subjectFilter}". Known configs: ${configs.map((config) => config.configKey).join(", ")}`);
}
