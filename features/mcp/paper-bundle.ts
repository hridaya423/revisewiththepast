import "server-only";

import { randomUUID } from "node:crypto";

import { generateMarkScheme } from "@/features/papers/server";
import { generatePaper } from "@/features/papers/server";
import { getSubjectDetail } from "@/features/papers/server";
import { parseGeneratePaperRequest } from "@/features/papers/server";
import { getPaperMakerSubject, PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";
import { DomainError, NotFoundError, ValidationError, normalizeApplicationError } from "@/shared/application/errors";

import { uploadMcpArtifact, getArtifactExpiry } from "./artifacts";
import { compactTopicTree, subjectCatalogOutputSchema, type GeneratePaperBundleInput, type ArtifactOutput, type McpTopic, type PaperBundleOutput, type SubjectCatalogOutput } from "./contracts";
import { reservePaperGeneration } from "./rate-limit";

function getSubjectOrThrow(subjectKey: string) {
  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) throw new NotFoundError("Unknown subject selection.");
  if (!subject.generationEnabled) throw new DomainError(`${subject.label} is not enabled for generation yet.`, 501);
  return subject;
}

function validateTier(subject: ReturnType<typeof getSubjectOrThrow>, subjectTier: GeneratePaperBundleInput["subjectTier"]) {
  const supportedTiers = new Set(subject.tiers.map((tier) => tier.key));
  if (supportedTiers.size === 0 && subjectTier) {
    throw new ValidationError(`${subject.label} does not support Foundation or Higher selection.`);
  }
  if (supportedTiers.size > 0 && !subjectTier) {
    throw new ValidationError(`Select ${subject.tiers.map((tier) => tier.label).join(" or ")} for ${subject.label}.`);
  }
  if (subjectTier && !supportedTiers.has(subjectTier)) {
    throw new ValidationError(`${subject.label} does not have a ${subjectTier} question bank.`);
  }
}

function validatePaperCodes(subject: ReturnType<typeof getSubjectOrThrow>, requestedPaperCodes: string[]) {
  const paperCodes = requestedPaperCodes.length > 0 ? requestedPaperCodes : subject.defaultPaperCodes;
  const allowed = new Set(subject.paperOptions.map((paper) => paper.code));
  const invalid = paperCodes.filter((paperCode) => !allowed.has(paperCode));
  if (invalid.length > 0) {
    throw new ValidationError(`Unknown paper code(s) for ${subject.label}: ${invalid.join(", ")}.`);
  }
  return Array.from(new Set(paperCodes));
}

function collectTopicIds(nodes: McpTopic[]) {
  const ids = new Set<string>();
  const visit = (node: McpTopic) => {
    ids.add(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return ids;
}

function formatMarkSchemeWarning(label: string) {
  return `${label}: Mark-scheme source could not be assembled.`;
}

async function validateTopicIds(
  subject: ReturnType<typeof getSubjectOrThrow>,
  topicIds: string[],
  subjectTier: GeneratePaperBundleInput["subjectTier"],
) {
  if (topicIds.length === 0) return;
  const catalog = await getGenerationSubjectCatalog(subject.key, subjectTier);
  const validIds = collectTopicIds(catalog.topics);
  const invalid = topicIds.filter((topicId) => !validIds.has(topicId));
  if (invalid.length > 0) throw new ValidationError(`Unknown topic ID(s) for ${subject.label}: ${invalid.join(", ")}.`);
}

export async function normalizePaperBundleInput(input: GeneratePaperBundleInput) {
  const subject = getSubjectOrThrow(input.subjectKey);
  validateTier(subject, input.subjectTier);
  const paperCodes = validatePaperCodes(subject, input.paperCodes);
  if (input.topicIds.length === 0 && input.selectAllTopics !== true) {
    throw new ValidationError("Provide topicIds from get_subject_catalog, or set selectAllTopics to true for a broad paper.");
  }
  if (input.topicIds.length > 0 && input.selectAllTopics === true) {
    throw new ValidationError("Choose topicIds or selectAllTopics, not both.");
  }
  const selectAllTopics = input.selectAllTopics === true;
  if (input.targetMode === "time" && input.timeMinutes === undefined) {
    throw new ValidationError("timeMinutes is required when targetMode is time.");
  }
  await validateTopicIds(subject, input.topicIds, input.subjectTier);

  const parsed = parseGeneratePaperRequest({
    subjectKey: subject.key,
    subjectTier: input.subjectTier,
    selectedTopicNodeIds: input.topicIds,
    selectAllTopics,
    targetMarks: input.targetMarks,
    targetMode: input.targetMode,
    timeMinutes: input.timeMinutes,
    questionMix: input.questionMix,
    paperCodes,
    maxQuestions: input.maxQuestions,
    seed: input.seed,
  });
  if (!parsed.success) throw new ValidationError("Invalid paper generation request.");
  return { subject, request: parsed.data };
}

export async function listGenerationSubjects() {
  return {
    nextTool: "get_subject_catalog" as const,
    subjects: PAPER_MAKER_SUBJECTS.flatMap((subject) => subject.generationEnabled ? [{
      key: subject.key,
      label: subject.label,
      board: subject.boardLabel,
      code: subject.codeLabel,
      tiers: subject.tiers,
      paperOptions: subject.paperOptions,
      defaultPaperCodes: subject.defaultPaperCodes,
    }] : []),
  } satisfies import("./contracts").ListSubjectsOutput;
}

export async function getGenerationSubjectCatalog(subjectKey: string, subjectTier?: GeneratePaperBundleInput["subjectTier"]): Promise<SubjectCatalogOutput> {
  const subject = getSubjectOrThrow(subjectKey);
  validateTier(subject, subjectTier);
  const detail = await getSubjectDetail(subject.key);
  const sourceTopics = subjectTier && detail.topicsByTier?.[subjectTier]
    ? detail.topicsByTier[subjectTier] ?? []
    : detail.topics;
  const topics = compactTopicTree(sourceTopics);
  return subjectCatalogOutputSchema.parse({
    nextTool: "generate_paper_bundle",
    key: subject.key,
    label: subject.label,
    board: subject.boardLabel,
    code: subject.codeLabel,
    description: subject.description,
    availabilityNote: subject.availabilityNote,
    taggedQuestionUnits: detail.taggedQuestionUnits,
    benchmarkMinutesPerMark: detail.benchmarkMinutesPerMark,
    paperOptions: subject.paperOptions,
    defaultPaperCodes: subject.defaultPaperCodes,
    tiers: detail.tiers,
    topics,
    generation: {
      subjectKey: subject.key,
      ...(subjectTier ? { subjectTier } : {}),
      defaultPaperCodes: subject.defaultPaperCodes,
      requiresExplicitSelectAll: true,
    },
    detailLoaded: true,
  });
}

function flattenTopics(nodes: McpTopic[], parentLabel?: string): string[] {
  return nodes.flatMap((node) => {
    const label = parentLabel ? `${parentLabel} / ${node.label}` : node.label;
    const line = `- ${label} [${node.id}; ${node.questionUnitCount} question units]`;
    return [line, ...flattenTopics(node.children ?? [], label)];
  });
}

export function formatSubjectsForTool(output: import("./contracts").ListSubjectsOutput) {
  return [
    "Next tool: get_subject_catalog. Choose one subject key below, then pass its tier when listed.",
    ...output.subjects.map((subject) => {
      const tiers = subject.tiers.length > 0 ? subject.tiers.map((tier) => tier.key).join(",") : "none";
      const papers = subject.paperOptions.map((paper) => `${paper.code}=${paper.label}`).join("; ");
      return `${subject.key} | ${subject.label} | board=${subject.board} | code=${subject.code} | tiers=${tiers} | papers=${papers}`;
    }),
  ].join("\n");
}

export function formatSubjectCatalogForTool(output: SubjectCatalogOutput) {
  const tier = output.generation.subjectTier ? `, subjectTier=${output.generation.subjectTier}` : "";
  const lines = [
    `Next tool: generate_paper_bundle with subjectKey=${output.generation.subjectKey}${tier}.`,
    "For a focused paper, pass one or more topic IDs below. For a broad paper, set selectAllTopics=true explicitly.",
    `Default paper codes: ${output.generation.defaultPaperCodes.join(", ")}.`,
    `Timing benchmark: ${output.benchmarkMinutesPerMark === null ? "unavailable" : `${output.benchmarkMinutesPerMark} minutes per mark`}.`,
    "Topics:",
    ...flattenTopics(output.topics),
  ];
  const text = lines.join("\n");
  return text.length <= 12_000
    ? text
    : `${text.slice(0, 11_800)}\n... catalog text truncated; use structuredContent for the remaining topic tree.`;
}

async function artifactResource(artifact: ArtifactOutput) {
  const response = await fetch(artifact.url);
  if (!response.ok) throw new DomainError(`Could not attach ${artifact.fileName}.`);
  return {
    type: "resource" as const,
    resource: {
      uri: artifact.url,
      blob: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: artifact.mimeType,
    },
  };
}

export async function paperBundleContent(output: PaperBundleOutput) {
  const summary = [
    `Generated ${output.subjectKey}: ${output.questionCount} questions, ${output.totalMarks} marks, ${output.timeMinutes} minutes.`,
    output.markScheme ? "Question paper and mark scheme are attached." : "Question paper is attached. Mark scheme: unavailable.",
    `Downloads expire at ${output.expiresAt}.`,
    ...output.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
  const artifacts = await Promise.all([
    artifactResource(output.paper),
    ...(output.markScheme ? [artifactResource(output.markScheme)] : []),
  ]);
  return [
    { type: "text" as const, text: summary },
    ...artifacts,
  ];
}

export async function generatePaperBundle(input: GeneratePaperBundleInput, request?: Request): Promise<PaperBundleOutput> {
  const normalized = await normalizePaperBundleInput(input);
  await reservePaperGeneration(request);
  const startedAt = Date.now();
  const result = await generatePaper(normalized.request);
  const bundleId = `bundle_${randomUUID()}`;
  const expiresAt = getArtifactExpiry();
  const warnings: string[] = [];
  let markScheme: ArtifactOutput | null = null;

  const paper = await uploadMcpArtifact({
    bundleId,
    kind: "paper",
    fileName: result.fileName,
    bytes: result.pdfBytes,
    expiresAt,
  });

  try {
    const markSchemeResult = await generateMarkScheme({
      subjectKey: normalized.subject.key,
      subjectTier: normalized.request.subjectTier,
      selectedUnitKeys: result.selection.selectedUnits.map((unit) => unit.unitKey),
    });
    if (markSchemeResult.failures.length > 0) {
      warnings.push(...markSchemeResult.failures.slice(0, 8).map((failure) => formatMarkSchemeWarning(failure.label)));
      if (markSchemeResult.failures.length > 8) {
        warnings.push(`${markSchemeResult.failures.length - 8} additional mark-scheme warnings were omitted from the response.`);
      }
    }
    markScheme = await uploadMcpArtifact({
      bundleId,
      kind: "mark-scheme",
      fileName: markSchemeResult.fileName,
      bytes: markSchemeResult.bytes,
      expiresAt,
    });
  } catch (error) {
    const normalizedError = normalizeApplicationError(error, "Mark scheme generation was unavailable.");
    warnings.push(normalizedError instanceof DomainError ? "Mark scheme generation was unavailable." : normalizedError.message);
  }

  console.info("MCP paper bundle generated", {
    bundleId,
    subjectKey: normalized.subject.key,
    questionCount: result.selection.selectedUnits.length,
    totalMarks: result.selection.totalMarks,
    durationMs: Date.now() - startedAt,
    warningCount: warnings.length,
  });

  return {
    bundleId,
    subjectKey: normalized.subject.key,
    totalMarks: result.selection.totalMarks,
    timeMinutes: result.timeMinutes,
    questionCount: result.selection.selectedUnits.length,
    coveredTopicIds: result.selection.coveredLeafTopicIds,
    paper,
    markScheme,
    warnings,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
