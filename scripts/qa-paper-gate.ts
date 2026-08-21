export type QaGateFinding = {
  severity: "error" | "warning";
};

export type QaArtifactValidation = {
  readable: boolean;
  byteLength: number;
  pageCount: number;
  renderedPageCount: number;
};

export type QaPaperGateInput = {
  findings: QaGateFinding[];
  canonicalLayoutChecked: boolean;
  selectedUnitCount: number;
  markSchemeIncludedCount: number;
  markSchemeFailureCount: number;
  questionPaper: QaArtifactValidation;
  markScheme: QaArtifactValidation;
};

export function decideQaPaperGate(input: QaPaperGateInput) {
  const failures: string[] = [];
  if (!input.canonicalLayoutChecked) failures.push("canonical-layout-unchecked");
  if (input.findings.some((finding) => finding.severity === "error")) failures.push("error-findings");
  if (input.markSchemeIncludedCount !== input.selectedUnitCount) failures.push("mark-scheme-coverage");
  if (input.markSchemeFailureCount > 0) failures.push("mark-scheme-assembly");
  for (const [name, artifact] of [["question-paper", input.questionPaper], ["mark-scheme", input.markScheme]] as const) {
    if (artifact.byteLength === 0) failures.push(`${name}-empty`);
    if (!artifact.readable) failures.push(`${name}-unreadable`);
    if (artifact.pageCount < 1) failures.push(`${name}-no-pages`);
    if (artifact.renderedPageCount !== artifact.pageCount) failures.push(`${name}-missing-rendered-pages`);
  }
  return { ok: failures.length === 0, failures };
}
