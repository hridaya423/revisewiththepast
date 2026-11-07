import "server-only";

import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { PDFDocument } from "pdf-lib";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ApplicationError } from "@/shared/application/errors";
import { getConvexUrl, getServerEnvironment } from "@/shared/infrastructure/env/server";
import { generateMarkScheme } from "@/features/papers/marking/application/generate-mark-scheme";
import { generatePaper, selectedSourceExclusionKeys } from "../../application/generate-paper";
import { generatePaperRequestSchema } from "../../contracts/generate-paper";
import type { GenerationJobSnapshot } from "../../domain/generation-job";
import { recordGenerationReceipt } from "../convex/generation-receipts";
import { renderPaperPreview } from "./paper-preview";

export async function processNextGenerationJob(workerId: string) {
  const client = new ConvexHttpClient(getConvexUrl());
  const serviceSecret = getServerEnvironment().MCP_SERVICE_SECRET ?? "";
  const claimed = await client.mutation(api.generationJobs.claimNext, { serviceSecret, workerId });
  if (!claimed) return false;
  let state: GenerationJobSnapshot = claimed.snapshot;
  const request = generatePaperRequestSchema.parse(JSON.parse(claimed.requestJson));
  const access = { serviceSecret, workerId, jobId: state.jobId };
  let active = true;
  let cancelled = false;
  let heartbeatPending = false;
  const heartbeat = async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try {
      const result = await client.mutation(api.generationJobs.heartbeat, access);
      active = result.active;
      cancelled = result.cancelled;
    } catch {
      active = false;
    } finally {
      heartbeatPending = false;
    }
  };
  const timer = setInterval(() => { void heartbeat(); }, 15_000);
  const checkpoint = async (patch: Partial<GenerationJobSnapshot>, file?: { part: string; bytes: Uint8Array; fileName: string; contentType?: "application/pdf" | "image/png" }) => {
    state = { ...state, ...patch };
    let artifact: { part: string; storageId: Id<"_storage">; fileName: string; contentType: "application/pdf" | "image/png" } | undefined;
    if (file) {
      const url = await client.mutation(api.generationJobs.createUploadUrl, access);
      const uploaded = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.contentType ?? "application/pdf" },
        body: new Blob([Uint8Array.from(file.bytes)]),
      });
      if (!uploaded.ok) throw new Error("Artifact storage failed.");
      artifact = { part: file.part, fileName: file.fileName, storageId: (await uploaded.json()).storageId, contentType: file.contentType ?? "application/pdf" };
    }
    const accepted = await client.mutation(api.generationJobs.checkpoint, { ...access, snapshotJson: JSON.stringify(state), artifact });
    if (!accepted) {
      active = false;
      throw new Error("Generation lease no longer belongs to this worker.");
    }
  };
  const canContinue = async () => {
    await heartbeat();
    if (!active) return false;
    if (cancelled) {
      await checkpoint({ status: "cancelled", message: "Preparation stopped.", error: null });
      return false;
    }
    return true;
  };
  const excluded = new Set(request.excludeSourceQuestionKeys);
  const priorMarks = [...request.priorSelectedUnitMarks];
  const priorTopics = [...request.priorCoveredLeafTopicIds];
  for (const paper of state.papers) {
    for (const key of paper.selectedSourceQuestionKeys ?? []) excluded.add(key);
    priorMarks.push(...paper.selectedUnitMarks);
    priorTopics.push(...paper.coveredLeafTopicIds ?? []);
  }
  const readArtifact = async (part: string) => {
    const url = await client.query(api.generationJobs.workerDownload, { ...access, part });
    if (!url) throw new Error("A prepared artifact is unavailable.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("A prepared artifact could not be read.");
    return new Uint8Array(await response.arrayBuffer());
  };

  try {
    for (let index = 0; index < state.totalPapers; index += 1) {
      if (!await canContinue()) return true;
      let paper = state.papers.find((entry) => entry.index === index);
      let paperBytes: Uint8Array | undefined;
      if (!paper) {
        await checkpoint({ status: "generating", message: `Preparing paper ${index + 1} of ${state.totalPapers}` });
        const result = await generatePaper({
          ...request, excludeSourceQuestionKeys: Array.from(excluded), remainingPaperCount: state.totalPapers - index,
          priorSelectedUnitMarks: priorMarks, priorPaperCount: request.priorPaperCount + index,
          priorCoveredLeafTopicIds: priorTopics,
        });
        if (!active) return true;
        paperBytes = result.pdfBytes;
        for (const key of selectedSourceExclusionKeys(result)) excluded.add(key);
        priorMarks.push(...result.selection.selectedUnits.map((unit) => unit.totalMarks));
        priorTopics.push(...result.selection.coveredLeafTopicIds);
        let receipt: string | null = null;
        try {
          receipt = String(await recordGenerationReceipt({
          pdfSha256: createHash("sha256").update(result.pdfBytes).digest("hex"),
          subjectKey: result.subject.key, subjectTier: request.subjectTier,
          selectedUnitKeys: result.selection.selectedUnits.map((unit) => unit.unitKey),
          targetMarks: result.resolvedTargetMarks, totalMarks: result.selection.totalMarks,
          timeMinutes: result.timeMinutes, questionCount: result.selection.selectedUnits.length,
          }));
        } catch {
          console.error("The paper is ready but its saving receipt could not be recorded.", { jobId: state.jobId });
        }
        paper = {
          index, fileName: result.fileName, questionCount: result.selection.selectedUnits.length,
          totalMarks: result.selection.totalMarks, timeMinutes: result.timeMinutes,
          coveredTopics: result.selection.coveredLeafTopicIds.length,
          selectedUnitKeys: result.selection.selectedUnits.map((unit) => unit.unitKey),
          selectedUnitMarks: result.selection.selectedUnits.map((unit) => unit.totalMarks),
          selectedSourceQuestionKeys: selectedSourceExclusionKeys(result),
          coveredLeafTopicIds: result.selection.coveredLeafTopicIds,
          generationReceiptId: receipt, markSchemeGenerated: false, markSchemeWarning: null,
        };
        state.papers.push(paper);
        await checkpoint({ completedPapers: state.papers.length, progress: (index + 0.5) / state.totalPapers * 0.9 }, { part: `paper-${index}`, bytes: result.pdfBytes, fileName: result.fileName });
      }
      if (!paper.previewReady) {
        try {
          const preview = await renderPaperPreview(paperBytes ?? await readArtifact(`paper-${index}`));
          paper.previewReady = true;
          await checkpoint({}, { part: `preview-${index}`, bytes: preview, fileName: `paper-${index + 1}-preview.png`, contentType: "image/png" });
        } catch {
          paper.previewReady = false;
          console.error("Paper preview unavailable.", { jobId: state.jobId, index });
        }
      }
      if (state.includeMarkScheme && !paper.markSchemeGenerated && !paper.markSchemeWarning) {
        if (!await canContinue()) return true;
        await checkpoint({ status: "mark-schemes", message: `Preparing mark scheme ${index + 1} of ${state.totalPapers}` });
        try {
          const scheme = await generateMarkScheme({ subjectKey: request.subjectKey, subjectTier: request.subjectTier, selectedUnitKeys: paper.selectedUnitKeys });
          paper.markSchemeGenerated = true;
          await checkpoint({}, { part: `scheme-${index}`, bytes: scheme.bytes, fileName: `${request.subjectKey}-mark-scheme-${index + 1}.pdf` });
        } catch (error) {
          if (!active) return true;
          paper.markSchemeGenerated = false;
          paper.markSchemeWarning = error instanceof ApplicationError ? error.message : "This mark scheme could not be prepared. Your question paper is available.";
          await checkpoint({});
        }
      }
    }
    if (!await canContinue()) return true;
    await checkpoint({ status: "assembling", message: "Preparing your download", progress: 0.95 });
    const combined = await PDFDocument.create();
    for (const paper of state.papers) {
      for (const part of [`paper-${paper.index}`, ...(paper.markSchemeGenerated ? [`scheme-${paper.index}`] : [])]) {
        const source = await PDFDocument.load(await readArtifact(part));
        for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page);
      }
    }
    const fileName = `${request.subjectKey}-practice-pack.pdf`;
    await checkpoint({ status: "succeeded", message: "Your paper is ready.", progress: 1, resultFileName: fileName }, { part: "combined", bytes: await combined.save(), fileName });
  } catch (error) {
    if (active) {
      console.error("Generation worker failed", { jobId: state.jobId, errorType: error instanceof Error ? error.name : "Unknown" });
      await checkpoint({ status: "failed", message: "Preparation could not finish.", error: error instanceof ApplicationError ? error.message : "Please try again. Your paper settings are saved." });
    }
  } finally {
    clearInterval(timer);
  }
  return true;
}
