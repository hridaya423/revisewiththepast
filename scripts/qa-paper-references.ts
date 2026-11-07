import { join } from "node:path";

import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import type { QaPaperConfig } from "./qa-paper-matrix";

export type ReferencePaperPair = {
  questionPaperFile: string;
  markSchemeFile: string;
  year: number;
  session: "june" | "november" | "unknown";
};

function fileSession(fileName: string): ReferencePaperPair["session"] {
  const normalized = fileName.toLowerCase();
  if (/(?:^|-)nov(?:ember)?(?:-|$)/.test(normalized)) return "november";
  if (/(?:^|-)june(?:-|$)/.test(normalized)) return "june";
  return "unknown";
}

function fileYear(fileName: string) {
  const match = fileName.match(/-(19|20)(\d{2})-/);
  return match ? Number.parseInt(`${match[1]}${match[2]}`, 10) : null;
}

export function findReferencePaperPair(files: string[], paperCode: string): ReferencePaperPair | null {
  const paperToken = `-${paperCode.toLowerCase()}-`;
  const candidates = files.filter((file) => file.toLowerCase().includes(paperToken));
  const keys = Array.from(new Set(candidates.flatMap((file) => {
    const year = fileYear(file);
    return year === null ? [] : [`${year}:${fileSession(file)}`];
  }))).sort((left, right) => {
    const [leftYear, leftSession] = left.split(":");
    const [rightYear, rightSession] = right.split(":");
    const yearDifference = Number(rightYear) - Number(leftYear);
    if (yearDifference !== 0) return yearDifference;
    const rank = { november: 2, june: 1, unknown: 0 } as const;
    return rank[rightSession as keyof typeof rank] - rank[leftSession as keyof typeof rank];
  });

  for (const key of keys) {
    const [yearText, session] = key.split(":") as [string, ReferencePaperPair["session"]];
    const sameSitting = candidates.filter((file) => fileYear(file) === Number(yearText) && fileSession(file) === session).sort().reverse();
    const questionPaperFile = sameSitting.find((file) => file.includes("question_paper"));
    const markSchemeFile = sameSitting.find((file) => file.includes("mark_scheme"));
    if (questionPaperFile && markSchemeFile) {
      return { questionPaperFile, markSchemeFile, year: Number(yearText), session };
    }
  }
  return null;
}

export function referenceDirectoryForConfig(config: Pick<QaPaperConfig, "subjectKey" | "subjectTier">) {
  const subject = getPaperMakerSubject(config.subjectKey);
  if (!subject) return null;
  const tierDirectory = config.subjectTier
    ?? (config.subjectKey === "edexcel-mathematics-higher" ? "higher" : "none");
  return join("data/downloads", subject.boardCode, subject.subjectSlug, tierDirectory);
}
