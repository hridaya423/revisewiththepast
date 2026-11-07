import { questionDocumentSchema, solutionSchema, type ShadowArtifactKind, type ShadowManifest } from "../contracts/shadow-paper";
import { blockPlainText } from "../domain/content";
import { ShadowGenerationError, canonicalStringify } from "../domain/parameters";
import { generatePaperVariant, newPaperSeed, type ShadowTemplateRegistry } from "../domain/template-registry";
import type { ShadowPaperVariant, ShadowUnitVariant } from "../domain/types";

export type ShadowWorkerStage = "generating" | "validating" | "rendering";

export type ClaimedShadowJob = {
  jobId: string;
  sourcePaperId: string;
  manifestRevision: string;
  paperSeed: string;
  attempt: number;
  createdAt: number;
};

export type RenderedArtifact = { kind: ShadowArtifactKind; bytes: Uint8Array; pageCount: number };

export type PublishedArtifact = { storageId: string; sha256: string; fileSize: number; pageCount: number };

export type ShadowVariantPublication = {
  variant: {
    manifestId: string;
    semanticHash: string;
    displayCode: string;
    title: string;
    source: { boardCode: string; subjectKey: string; subjectSlug: string; tier: "foundation" | "higher"; year: number; session: string; paperCode: string; questionPaperPath: string };
    totalMarks: number;
    durationMinutes: number;
    calculator: "allowed" | "not-allowed";
    rendererVersion: string;
    validation: { checks: number; failed: number };
    paper: PublishedArtifact;
    markScheme: PublishedArtifact;
  };
  questions: Array<{
    displayOrder: number;
    sourceUnitKey: string;
    templateRevision: string;
    unitSeed: string;
    marks: number;
    partMarks: Array<{ partId: string; marks: number }>;
    promptText: string;
    parametersJson: string;
    questionJson: string;
    solutionJson: string;
    validationJson: string;
  }>;
};

type Signal = { kind: string };

/** Everything the orchestrator needs from the outside world; production wiring lives in `infrastructure/jobs/worker.ts`. */
export type ShadowWorkerPorts = {
  newLeaseToken(): string;
  claim(jobId: string, leaseToken: string): Promise<{ kind: "claimed"; job: ClaimedShadowJob } | Signal>;
  progress(jobId: string, leaseToken: string, stage: ShadowWorkerStage, completedUnits: number): Promise<Signal>;
  upload(bytes: Uint8Array): Promise<string>;
  publish(jobId: string, leaseToken: string, publication: ShadowVariantPublication): Promise<Signal>;
  fail(jobId: string, leaseToken: string, failure: { errorCode: string; retryable: boolean; orphanStorageIds: string[] }): Promise<Signal>;
  findManifest(sourcePaperId: string): ShadowManifest | null;
  registry: ShadowTemplateRegistry;
  allowDraft: boolean;
  renderPaper(variant: ShadowPaperVariant, createdAt: Date): Promise<RenderedArtifact>;
  renderMarkScheme(variant: ShadowPaperVariant, createdAt: Date): Promise<RenderedArtifact>;
  rendererVersion: string;
  sha256(value: string | Uint8Array): string;
  log?(event: string, details: Record<string, unknown>): void;
};

export type ShadowJobOutcome =
  | { kind: "ready" }
  | { kind: "cancelled" }
  | { kind: "lost" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; errorCode: string; retryable: boolean };

class StopSignal extends Error {
  constructor(readonly outcome: "cancelled" | "lost") {
    super(outcome);
  }
}

class StageError extends Error {
  constructor(readonly errorCode: string, readonly retryable: boolean, message: string) {
    super(message);
  }
}

const PROGRESS_EVERY = 4;

function stop(signal: Signal) {
  if (signal.kind === "cancel" || signal.kind === "cancelled") throw new StopSignal("cancelled");
  if (signal.kind === "lost") throw new StopSignal("lost");
}

export function questionPromptText(unit: ShadowUnitVariant) {
  const blocks = [...unit.question.stem, ...unit.question.parts.flatMap((part) => [...part.lead, ...part.prompt])];
  return blockPlainText(blocks).slice(0, 4000);
}

export function shadowPaperTitle(manifest: ShadowManifest) {
  const { source } = manifest;
  const session = source.session === "june" ? "June" : "November";
  return `Shadow paper: ${source.boardLabel} ${source.subjectLabel} ${source.tier === "higher" ? "Higher" : "Foundation"}, ${session} ${source.year} ${source.paperTitle}`;
}

/** Re-checks every snapshot against the strict schemas before anything is rendered or stored. */
export function verifyVariant(variant: ShadowPaperVariant) {
  let checks = 0;
  let failed = 0;
  for (const unit of variant.units) {
    if (!questionDocumentSchema.safeParse(unit.question).success) throw new StageError("VALIDATION_FAILED", false, `Question ${unit.displayOrder} failed the document schema.`);
    if (!solutionSchema.safeParse(unit.solution).success) throw new StageError("VALIDATION_FAILED", false, `Question ${unit.displayOrder} failed the solution schema.`);
    checks += unit.validation.checks.length;
    failed += unit.validation.checks.filter((entry) => !entry.ok).length;
  }
  if (failed > 0 || variant.units.some((unit) => !unit.validation.ok)) throw new StageError("VALIDATION_FAILED", false, "A generated question failed validation.");
  return { checks, failed };
}

export function buildPublication(variant: ShadowPaperVariant, artifacts: { paper: PublishedArtifact; markScheme: PublishedArtifact }, input: { rendererVersion: string; validation: { checks: number; failed: number } }): ShadowVariantPublication {
  const { manifest } = variant;
  return {
    variant: {
      manifestId: manifest.manifestId,
      semanticHash: variant.semanticHash,
      displayCode: variant.displayCode,
      title: shadowPaperTitle(manifest),
      source: {
        boardCode: manifest.source.boardCode,
        subjectKey: manifest.source.subjectKey,
        subjectSlug: manifest.source.subjectSlug,
        tier: manifest.source.tier,
        year: manifest.source.year,
        session: manifest.source.session,
        paperCode: manifest.source.paperCode,
        questionPaperPath: manifest.provenance.questionPaperPaths[0]!,
      },
      totalMarks: variant.totalMarks,
      durationMinutes: manifest.source.durationMinutes,
      calculator: manifest.source.calculator,
      rendererVersion: input.rendererVersion,
      validation: input.validation,
      paper: artifacts.paper,
      markScheme: artifacts.markScheme,
    },
    questions: variant.units.map((unit) => ({
      displayOrder: unit.displayOrder,
      sourceUnitKey: unit.sourceUnitKey,
      templateRevision: unit.templateRevision,
      unitSeed: unit.unitSeed,
      marks: unit.question.totalMarks,
      partMarks: unit.question.parts.map((part) => ({ partId: part.id, marks: part.marks })),
      promptText: questionPromptText(unit),
      parametersJson: canonicalStringify(unit.parameters),
      questionJson: JSON.stringify(unit.question),
      solutionJson: JSON.stringify(unit.solution),
      validationJson: JSON.stringify(unit.validation),
    })),
  };
}

/**
 * Runs one claimed attempt of a durable job: generate, validate, render, upload,
 * publish. Every exit either publishes atomically or reports a failure, and a
 * cancelled or superseded attempt never publishes.
 */
export async function runShadowJob(jobId: string, ports: ShadowWorkerPorts): Promise<ShadowJobOutcome> {
  const leaseToken = ports.newLeaseToken();
  const claim = await ports.claim(jobId, leaseToken);
  if (claim.kind !== "claimed" || !("job" in claim)) return { kind: "skipped", reason: claim.kind };
  const { job } = claim as { kind: "claimed"; job: ClaimedShadowJob };
  const uploaded: string[] = [];
  const started = Date.now();

  try {
    const manifest = ports.findManifest(job.sourcePaperId);
    if (!manifest || manifest.revision !== job.manifestRevision) throw new StageError("MANIFEST_STALE", false, "The paper's manifest changed after the job was queued.");

    let lastReported = 0;
    let variant: ShadowPaperVariant;
    const pending: Array<Promise<Signal>> = [];
    try {
      variant = generatePaperVariant({
        manifest,
        registry: ports.registry,
        paperSeed: newPaperSeed(job.paperSeed),
        sha256: (value) => ports.sha256(value),
        allowDraft: ports.allowDraft,
        onUnit: (completed, total) => {
          if (completed - lastReported >= PROGRESS_EVERY || completed === total) {
            lastReported = completed;
            pending.push(ports.progress(jobId, leaseToken, "generating", completed));
          }
        },
      });
    } catch (error) {
      if (error instanceof ShadowGenerationError) throw new StageError(error.code, false, error.message);
      throw error;
    }
    for (const signal of await Promise.all(pending)) stop(signal);
    const generatedAt = Date.now();

    stop(await ports.progress(jobId, leaseToken, "validating", variant.units.length));
    const validation = verifyVariant(variant);

    stop(await ports.progress(jobId, leaseToken, "rendering", variant.units.length));
    const createdAt = new Date(job.createdAt);
    let paper: RenderedArtifact;
    let markScheme: RenderedArtifact;
    try {
      [paper, markScheme] = await Promise.all([ports.renderPaper(variant, createdAt), ports.renderMarkScheme(variant, createdAt)]);
    } catch (error) {
      throw new StageError("RENDER_FAILED", false, error instanceof Error ? error.message : String(error));
    }
    const renderedAt = Date.now();
    stop(await ports.progress(jobId, leaseToken, "rendering", variant.units.length));

    const publish = async (artifact: RenderedArtifact): Promise<PublishedArtifact> => {
      const storageId = await ports.upload(artifact.bytes);
      uploaded.push(storageId);
      return { storageId, sha256: ports.sha256(artifact.bytes), fileSize: artifact.bytes.byteLength, pageCount: artifact.pageCount };
    };
    let artifacts: { paper: PublishedArtifact; markScheme: PublishedArtifact };
    try {
      artifacts = { paper: await publish(paper), markScheme: await publish(markScheme) };
    } catch (error) {
      throw new StageError("STORAGE_UNAVAILABLE", true, error instanceof Error ? error.message : String(error));
    }

    const result = await ports.publish(jobId, leaseToken, buildPublication(variant, artifacts, { rendererVersion: ports.rendererVersion, validation }));
    ports.log?.("shadow-job-finished", {
      jobId,
      attempt: job.attempt,
      result: result.kind,
      displayCode: variant.displayCode,
      generateMs: generatedAt - started,
      renderMs: renderedAt - generatedAt,
      totalMs: Date.now() - started,
      paperBytes: paper.bytes.byteLength,
      schemeBytes: markScheme.bytes.byteLength,
    });
    if (result.kind === "published") return { kind: "ready" };
    // Publication refused: the mutation already removed the uploads.
    uploaded.length = 0;
    return result.kind === "cancel" ? { kind: "cancelled" } : { kind: "lost" };
  } catch (error) {
    if (error instanceof StopSignal) {
      if (uploaded.length > 0) await ports.fail(jobId, leaseToken, { errorCode: "CANCELLED", retryable: false, orphanStorageIds: uploaded }).catch(() => undefined);
      return { kind: error.outcome };
    }
    const errorCode = error instanceof StageError ? error.errorCode : "WORKER_ERROR";
    const retryable = error instanceof StageError ? error.retryable : true;
    ports.log?.("shadow-job-failed", { jobId, attempt: job.attempt, errorCode, retryable, message: error instanceof Error ? error.message : String(error) });
    const reported = await ports.fail(jobId, leaseToken, { errorCode, retryable, orphanStorageIds: uploaded });
    if (reported.kind === "cancel") return { kind: "cancelled" };
    if (reported.kind === "lost") return { kind: "lost" };
    return { kind: "failed", errorCode, retryable: reported.kind === "retry" };
  }
}
