import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { createHash } from "node:crypto";
import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import { buildGeneratedCoverModel } from "../infrastructure/pdf/cover";
import { getPaperMakerSubject } from "../domain/subjects";
import { AuthorizationError, DomainError, NotFoundError, ValidationError } from "@/shared/application/errors";
import { uploadToHackClubCdn } from "@/shared/infrastructure/cdn/hackclub";
import { claimGenerationReceipt } from "../infrastructure/convex/generation-receipts";
import { createSavedPaper, getSavedPaperByImportKey } from "../infrastructure/convex/saved-papers";

const MAX_GENERATED_PDF_BYTES = 40 * 1024 * 1024;

export async function saveGeneratedPaper(input: {
  generationReceiptId: string;
  file: File;
}) {
  if (input.file.size === 0) throw new ValidationError("The generated paper is empty.");
  if (input.file.size > MAX_GENERATED_PDF_BYTES) throw new ValidationError("Generated papers are limited to 40 MB.");

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const pdfHeader = new TextDecoder().decode(bytes.slice(0, 5));
  if (pdfHeader !== "%PDF-") throw new ValidationError("The uploaded file is not a valid PDF.");

  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const receipt = await claimGenerationReceipt(input.generationReceiptId, pdfSha256).catch((error) => {
    const message = error instanceof Error ? error.message : "";
    if (message === "Unauthorized") throw new AuthorizationError();
    if (message.startsWith("This file was not produced")) throw new ValidationError(message);
    throw error;
  });

  const subjectKey = receipt.subjectKey as PaperMakerSubjectKey;
  const selectedUnitKeys = receipt.selectedUnitKeys;
  const subjectTier = receipt.subjectTier;
  if (selectedUnitKeys.length === 0) throw new ValidationError("The generation receipt does not list any questions.");

  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) throw new NotFoundError("Unknown subjectKey.");
  const selectedUnits = await getMarkableUnitsByUnitKeys(
    subjectKey,
    selectedUnitKeys,
    subjectTier === "foundation" || subjectTier === "higher" ? subjectTier : null,
  );
  if (selectedUnits.length !== selectedUnitKeys.length) {
    throw new DomainError("Could not resolve every selected unit for this generated paper.");
  }

  const totalMarks = selectedUnits.reduce((sum, unit) => sum + unit.totalMarks, 0);
  const targetMarks = Number.isFinite(receipt.targetMarks) ? receipt.targetMarks : totalMarks;
  const timeMinutes = Number.isFinite(receipt.timeMinutes) ? receipt.timeMinutes : 0;

  const importKey = createHash("sha256")
    .update(bytes)
    .update(`\0${subjectKey}\0${subjectTier ?? "none"}\0${selectedUnitKeys.join("\n")}`)
    .digest("hex");
  const existing = await getSavedPaperByImportKey(importKey);
  if (existing) return { savedPaperId: existing._id, pdfUrl: existing.pdfUrl };
  const upload = await uploadToHackClubCdn(input.file);
  const paperOptionsByCode = new Map(subject.paperOptions.map((paper) => [paper.code, paper]));
  const savedPaperId = await createSavedPaper({
    importKey,
    subjectKey,
    boardCode: subject.boardCode,
    subjectSlug: subject.subjectSlug,
    tier: subjectTier,
    title: `${subject.label} Custom Paper`,
    targetMarks,
    totalMarks,
    timeMinutes,
    pdfFileName: input.file.name,
    pdfContentType: upload.contentType,
    pdfFileSize: upload.size,
    pdfCdnUploadId: upload.id,
    pdfUrl: upload.url,
    questions: selectedUnits.map((unit, index) => {
      const canonicalLeafIds = Array.from(new Set(unit.canonicalLeafs.filter(Boolean)));
      const selectedPaper = paperOptionsByCode.get(unit.paperCode);
      const topicLabels = buildGeneratedCoverModel({
        subject,
        tierLabel: subjectTier === "foundation" || subjectTier === "higher" ? subjectTier : null,
        selectedUnits: [unit],
        selectedPapers: selectedPaper ? [selectedPaper] : [],
        timeMinutes,
        examContext: { materials: [], instructions: [] },
      }).topicLabels;
      return {
        displayOrder: index + 1,
        unitKey: unit.unitKey,
        sourceQuestionKey: unit.sourceQuestionKey,
        sourceRelativePath: unit.sourceRelativePath,
        paperCode: unit.paperCode,
        year: unit.year ?? undefined,
        session: unit.session ?? undefined,
        questionNumber: unit.questionNumber,
        questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
        totalMarks: unit.totalMarks,
        promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
        contextText: unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
        canonicalLeafIds: canonicalLeafIds.length > 0 ? canonicalLeafIds : undefined,
        topicLabels: topicLabels.length > 0 ? topicLabels : undefined,
      };
    }),
  });

  const canonical = await getSavedPaperByImportKey(importKey);
  return { savedPaperId, pdfUrl: canonical?.pdfUrl ?? upload.url };
}
