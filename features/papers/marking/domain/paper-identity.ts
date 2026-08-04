import type { QuestionUnit } from "@/shared/domain/paper";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";

export type DetectedPaperIdentity = {
  subjectKey: PaperMakerSubjectKey;
  paperCode: string;
  year: number;
  session: string;
  tier: "higher" | "foundation" | "none";
  sourceRelativePath: string | null;
  examReference: string | null;
};

const SESSION_ALIASES: Record<string, string> = {
  november: "november",
  nov: "november",
  june: "june",
  summer: "june",
};

function normalizeSession(value: string) {
  const normalized = value.trim().toLowerCase();
  return SESSION_ALIASES[normalized] ?? normalized;
}

function inferPaperCodeFromExamReference(reference: string, tier: "higher" | "foundation" | "none") {
  const match = reference.match(/1MA1\s*[\/]\s*(\d)\s*([HF])/i);
  if (!match) return null;
  const paperNumber = match[1];
  const tierLetter = match[2].toUpperCase();
  const resolvedTier: "higher" | "foundation" = tierLetter === "H" ? "higher" : "foundation";
  if (tier !== "none" && tier !== resolvedTier) return null;
  return {
    paperCode: `paper-${paperNumber}`,
    tier: resolvedTier,
  };
}

function scorePaperIdentityMatch(text: string, unit: QuestionUnit) {
  let score = 0;
  const normalized = text.toLowerCase();
  const subject = PAPER_MAKER_SUBJECTS.find((candidate) => candidate.boardCode === unit.boardCode && candidate.subjectSlug === unit.subjectSlug);

  if (unit.year && normalized.includes(String(unit.year))) score += 2;
  if (unit.session && normalized.includes(unit.session.toLowerCase())) score += 2;
  if (unit.paperCode && normalized.includes(unit.paperCode.replace(/-/g, " "))) score += 1;
  if (subject?.codeLabel && normalized.replace(/[^a-z0-9]/g, "").includes(subject.codeLabel.toLowerCase().replace(/[^a-z0-9]/g, ""))) score += 6;
  if (subject?.coverTitle && normalized.includes(subject.coverTitle.toLowerCase())) score += 1;
  if (subject?.boardLabel && normalized.includes(subject.boardLabel.toLowerCase())) score += 1;

  const examReferenceMatch = normalized.match(/1ma1\s*[\/]\s*\d\s*[hf]/i);
  if (examReferenceMatch) {
    const inferred = inferPaperCodeFromExamReference(examReferenceMatch[0], unit.sourceRelativePath.includes("/higher/") ? "higher" : unit.sourceRelativePath.includes("/foundation/") ? "foundation" : "none");
    if (inferred?.paperCode === unit.paperCode) score += 4;
  }

  if (unit.sourceRelativePath.includes("/higher/") && /(higher tier|1ma1\s*[\/]\s*\d\s*h)/i.test(text)) score += 2;
  if (unit.sourceRelativePath.includes("/foundation/") && /(foundation tier|1ma1\s*[\/]\s*\d\s*f)/i.test(text)) score += 2;

  return score;
}

export function detectPaperIdentityFromPages(
  pages: Array<{ text: string }>,
  candidateUnits: QuestionUnit[],
): DetectedPaperIdentity | null {
  const headerText = pages.slice(0, 4).map((page) => page.text).join("\n");
  const normalizedHeader = headerText.toLowerCase();

  const examReference = headerText.match(/1MA1\s*[\/]\s*\d\s*[HF]/i)?.[0] ?? null;
  const tier: DetectedPaperIdentity["tier"] = /(higher tier|1ma1\s*[\/]\s*\d\s*h)/i.test(headerText)
    ? "higher"
    : /(foundation tier|1ma1\s*[\/]\s*\d\s*f)/i.test(headerText)
      ? "foundation"
      : "none";

  const sessionYearMatch = normalizedHeader.match(/\b(november|nov|june|summer)\b[^\d]{0,20}(\d{4})\b/)
    ?? normalizedHeader.match(/\b(\d{4})\b[^\d]{0,20}\b(november|nov|june|summer)\b/);
  const yearFirst = Boolean(sessionYearMatch && /^\d{4}$/.test(sessionYearMatch[1] ?? ""));
  const detectedYear = sessionYearMatch
    ? Number.parseInt(yearFirst ? sessionYearMatch[1] : sessionYearMatch[2], 10)
    : null;
  const detectedSession = sessionYearMatch
    ? normalizeSession(yearFirst ? sessionYearMatch[2] : sessionYearMatch[1])
    : null;

  const inferredFromReference = examReference ? inferPaperCodeFromExamReference(examReference, tier) : null;

  const paperGroups = new Map<string, { units: QuestionUnit[]; score: number }>();
  for (const unit of candidateUnits) {
    const subject = PAPER_MAKER_SUBJECTS.find((candidate) => candidate.boardCode === unit.boardCode && candidate.subjectSlug === unit.subjectSlug);
    if (!subject) continue;
    const key = [
      subject.key,
      unit.sourceRelativePath,
      unit.paperCode,
      unit.year ?? "-",
      unit.session ?? "-",
    ].join("::");
    const existing = paperGroups.get(key) ?? { units: [], score: 0 };
    existing.units.push(unit);
    existing.score = Math.max(existing.score, scorePaperIdentityMatch(headerText, unit));
    paperGroups.set(key, existing);
  }

  const rankedGroups = Array.from(paperGroups.values())
    .filter((group) => group.units[0])
    .sort((left, right) => right.score - left.score);

  const bestGroup = rankedGroups[0];
  if (!bestGroup || bestGroup.score < 3) {
    if (!inferredFromReference || !detectedYear || !detectedSession) return null;
    const fallbackUnit = candidateUnits.find((unit) => (
      unit.paperCode === inferredFromReference.paperCode
      && unit.year === detectedYear
      && unit.session === detectedSession
      && unit.sourceRelativePath.includes(`/${inferredFromReference.tier}/`)
    ));
    if (!fallbackUnit) return null;
    return {
      subjectKey: PAPER_MAKER_SUBJECTS.find((subject) => subject.boardCode === fallbackUnit.boardCode && subject.subjectSlug === fallbackUnit.subjectSlug)?.key ?? "edexcel-mathematics-higher",
      paperCode: inferredFromReference.paperCode,
      year: detectedYear,
      session: detectedSession,
      tier: inferredFromReference.tier,
      sourceRelativePath: fallbackUnit.sourceRelativePath,
      examReference,
    };
  }

  const sampleUnit = bestGroup.units[0];
  const subject = PAPER_MAKER_SUBJECTS.find((candidate) => candidate.boardCode === sampleUnit.boardCode && candidate.subjectSlug === sampleUnit.subjectSlug);
  if (!subject) return null;
  const resolvedTier: DetectedPaperIdentity["tier"] = inferredFromReference?.tier
    ?? (sampleUnit.sourceRelativePath.includes("/higher/") ? "higher" : sampleUnit.sourceRelativePath.includes("/foundation/") ? "foundation" : "none");
  return {
    subjectKey: subject.key,
    paperCode: inferredFromReference?.paperCode ?? sampleUnit.paperCode,
    year: detectedYear ?? sampleUnit.year ?? 0,
    session: detectedSession ?? sampleUnit.session ?? "november",
    tier: resolvedTier,
    sourceRelativePath: sampleUnit.sourceRelativePath,
    examReference,
  };
}

export function isLikelyCoverPage(text: string) {
  const normalized = text.toLowerCase();
  const hasPreamble = /(paper reference|answer all questions|instructions|write your answers|centre number|candidate surname)/i.test(normalized);
  const hasQuestionStart = /\b[1-9]\s*(?:\([a-z]\)|\b)/i.test(normalized);
  return hasPreamble && !hasQuestionStart;
}

export function filterBodyPages<T extends { pageNumber: number; text: string }>(pages: T[]) {
  if (pages.length <= 1) return pages;
  const [firstPage, ...rest] = pages;
  if (isLikelyCoverPage(firstPage.text)) return rest;
  return pages;
}
