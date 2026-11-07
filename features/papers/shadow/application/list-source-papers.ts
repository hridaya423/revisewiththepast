import type { ShadowManifest } from "../contracts/shadow-paper";

export type ShadowSourcePaperSummary = {
  sourcePaperId: string;
  manifestRevision: string;
  publicationStatus: ShadowManifest["publicationStatus"];
  board: { code: string; label: string };
  subject: { key: string; label: string };
  specCode: string;
  componentCode: string;
  tier: "higher" | "foundation";
  year: number;
  session: "june" | "november";
  sittingDate: string;
  paperCode: string;
  paperTitle: string;
  calculator: "allowed" | "not-allowed";
  durationMinutes: number;
  totalMarks: number;
  questionCount: number;
  unchangedQuestionCount: number;
  topics: string[];
};

export function summariseManifest(manifest: ShadowManifest): ShadowSourcePaperSummary {
  const { source } = manifest;
  const topics = [...new Set(manifest.units.flatMap((unit) => unit.topics.slice(0, 1)))];
  return {
    sourcePaperId: source.sourcePaperId,
    manifestRevision: manifest.revision,
    publicationStatus: manifest.publicationStatus,
    board: { code: source.boardCode, label: source.boardLabel },
    subject: { key: source.subjectKey, label: source.subjectLabel },
    specCode: source.specCode,
    componentCode: source.componentCode,
    tier: source.tier,
    year: source.year,
    session: source.session,
    sittingDate: source.sittingDate,
    paperCode: source.paperCode,
    paperTitle: source.paperTitle,
    calculator: source.calculator,
    durationMinutes: source.durationMinutes,
    totalMarks: source.totalMarks,
    questionCount: manifest.units.length,
    unchangedQuestionCount: manifest.units.filter((unit) => unit.classification === "unchanged").length,
    topics,
  };
}

/** One entry per source sitting, newest first; aliases of the same sitting collapse to its current manifest. */
export function listSourcePapers(manifests: readonly ShadowManifest[]): ShadowSourcePaperSummary[] {
  const bySource = new Map<string, ShadowManifest>();
  for (const manifest of manifests) {
    const current = bySource.get(manifest.source.sourcePaperId);
    if (!current || manifest.revision > current.revision) bySource.set(manifest.source.sourcePaperId, manifest);
  }
  return [...bySource.values()]
    .map(summariseManifest)
    .sort((left, right) => right.sittingDate.localeCompare(left.sittingDate) || left.paperCode.localeCompare(right.paperCode));
}
