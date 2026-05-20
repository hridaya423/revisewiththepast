import { GCSE_SUBJECTS } from "./gcseCatalog";
import type { PaperDefinition, SubjectBoardConfig } from "../lib/gcse/types";

export type SeedSubjectRow = {
  slug: string;
  name: string;
  category: string;
  boardConfigs: {
    boardCode: string;
    qualificationTitle: string;
    tierMode: "none" | "foundation_higher";
    papers: {
      code: string;
      name: string;
      defaultDurationMinutes?: number;
      notes?: string;
    }[];
  }[];
};

export const SUBJECT_CATALOG_SEED: SeedSubjectRow[] = GCSE_SUBJECTS.map((subject) => ({
  slug: subject.slug,
  name: subject.name,
  category: subject.category,
  boardConfigs: subject.boardConfigs.map((config: SubjectBoardConfig) => ({
    boardCode: config.boardCode,
    qualificationTitle: config.qualificationTitle,
    tierMode: config.tierMode,
    papers: config.papers.map((paper: PaperDefinition) => ({
      code: paper.code,
      name: paper.name,
      defaultDurationMinutes: paper.defaultDurationMinutes,
      notes: paper.notes,
    })),
  })),
}));
