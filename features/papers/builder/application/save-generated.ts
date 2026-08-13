import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { createHash } from "node:crypto";
import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import { buildGeneratedCoverModel } from "../infrastructure/pdf/cover";
import { getPaperMakerSubject } from "../domain/subjects";
import { DomainError, NotFoundError, ValidationError } from "@/shared/application/errors";
import { uploadToHackClubCdn } from "@/shared/infrastructure/cdn/hackclub";
import { createSavedPaper, getSavedPaperByImportKey } from "../infrastructure/convex/saved-papers";

export async function saveGeneratedPaper(input: {
  subjectKey: PaperMakerSubjectKey;
  targetMarks: number;
  totalMarks: number;
  timeMinutes: number;
  subjectTier?: "none" | "foundation" | "higher";
  selectedUnitKeys: string[];
  file: File;
}) {
  if (!input.file.type.includes("pdf") && !input.file.name.toLowerCase().endsWith(".pdf")) {
    throw new ValidationError("Only PDF uploads are supported.");
  }
  if (input.selectedUnitKeys.length === 0) throw new ValidationError("selectedUnitKeys is required.");

  const subject = getPaperMakerSubject(input.subjectKey);
  if (!subject) throw new NotFoundError("Unknown subjectKey.");
  const selectedUnits = await getMarkableUnitsByUnitKeys(
    input.subjectKey,
    input.selectedUnitKeys,
    input.subjectTier === "foundation" || input.subjectTier === "higher" ? input.subjectTier : null,
  );
  if (selectedUnits.length !== input.selectedUnitKeys.length) {
    throw new DomainError("Could not resolve every selected unit for this generated paper.");
  }

  const importKey = createHash("sha256")
    .update(new Uint8Array(await input.file.arrayBuffer()))
    .update(`\0${input.subjectKey}\0${input.subjectTier ?? "none"}\0${input.selectedUnitKeys.join("\n")}`)
    .digest("hex");
  const existing = await getSavedPaperByImportKey(importKey);
  if (existing) return { savedPaperId: existing._id, pdfUrl: existing.pdfUrl };
  const upload = await uploadToHackClubCdn(input.file);
  const paperOptionsByCode = new Map(subject.paperOptions.map((paper) => [paper.code, paper]));
  const savedPaperId = await createSavedPaper({
    importKey,
    subjectKey: input.subjectKey,
    boardCode: subject.boardCode,
    subjectSlug: subject.subjectSlug,
    tier: input.subjectTier,
    title: `${subject.label} Custom Paper`,
    targetMarks: Number.isFinite(input.targetMarks) ? input.targetMarks : 0,
    totalMarks: Number.isFinite(input.totalMarks) ? input.totalMarks : 0,
    timeMinutes: Number.isFinite(input.timeMinutes) ? input.timeMinutes : 0,
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
        tierLabel: input.subjectTier === "foundation" || input.subjectTier === "higher" ? input.subjectTier : null,
        selectedUnits: [unit],
        selectedPapers: selectedPaper ? [selectedPaper] : [],
        timeMinutes: input.timeMinutes,
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

  return { savedPaperId, pdfUrl: upload.url };
}
