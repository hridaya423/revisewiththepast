import { GENERATED_PAGE } from "@/features/papers/builder/domain/generated-layout";

export type QaGateFinding = {
  severity: "error" | "warning";
};

type QaPdfPageSize = {
  width: number;
  height: number;
};

type QaPdfMetadata = {
  title: string | null;
  creator: string | null;
  producer: string | null;
};

export type QaArtifactValidation = {
  readable: boolean;
  byteLength: number;
  pageCount: number;
  renderedPageCount: number;
  pageSizes: QaPdfPageSize[];
  metadata: QaPdfMetadata;
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

const pageSizeTolerance = 1;

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= pageSizeTolerance;
}

function isA4Page({ width, height }: QaPdfPageSize) {
  return approximatelyEqual(width, GENERATED_PAGE.width) && approximatelyEqual(height, GENERATED_PAGE.height)
    || approximatelyEqual(width, GENERATED_PAGE.height) && approximatelyEqual(height, GENERATED_PAGE.width);
}

function isPortraitA4Page({ width, height }: QaPdfPageSize) {
  return approximatelyEqual(width, GENERATED_PAGE.width) && approximatelyEqual(height, GENERATED_PAGE.height);
}

function revealsTooling({ creator, producer }: QaPdfMetadata) {
  return /pdf-lib|gcse\s*meta|next\.?js|react/i.test(`${creator ?? ""} ${producer ?? ""}`);
}

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
    if (artifact.pageSizes.length !== artifact.pageCount) failures.push(`${name}-missing-page-sizes`);
    if (artifact.pageSizes.some((page) => !isA4Page(page))) failures.push(`${name}-non-a4`);
    if (name === "question-paper" && artifact.pageSizes.some((page) => !isPortraitA4Page(page))) {
      failures.push("question-paper-non-portrait");
    }
    if (!artifact.metadata.title?.trim()) failures.push(`${name}-missing-title`);
    if (revealsTooling(artifact.metadata)) failures.push(`${name}-tooling-metadata`);
  }
  return { ok: failures.length === 0, failures };
}
