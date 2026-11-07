export type ShadowVariantForSave = {
  _id: string;
  ownerId: string;
  displayCode: string;
  title: string;
  totalMarks: number;
  durationMinutes: number;
  questionCount: number;
  manifestRevision: string;
  expiresAt?: number;
  source: { boardCode: string; subjectKey: string; subjectSlug: string; tier: "foundation" | "higher"; year: number; session: string; paperCode: string; questionPaperPath: string };
  paper: { storageId: string; sha256: string; fileSize: number };
  markScheme: { sha256: string };
};

export type ShadowQuestionForSave = {
  _id: string;
  displayOrder: number;
  sourceUnitKey: string;
  marks: number;
  partMarks: Array<{ partId: string; marks: number }>;
  promptText: string;
  questionJson: string;
  solutionJson: string;
};

export class ShadowSaveError extends Error {
  constructor(readonly code: "NOT_FOUND" | "EXPIRED" | "MISSING_SNAPSHOT") {
    super(code);
  }
}

export function shadowDownloadPath(variantId: string, kind: "paper" | "mark-scheme") {
  return `/api/paper-maker/shadow-variants/${variantId}/download?kind=${kind}`;
}

/** Builds saved-paper rows from server-owned snapshots only; original unit keys are kept as provenance, never resolved. */
export function planShadowSave(input: { variant: ShadowVariantForSave | null; questions: ShadowQuestionForSave[]; ownerId: string; now: number }) {
  const { variant, questions, ownerId, now } = input;
  if (!variant || variant.ownerId !== ownerId) throw new ShadowSaveError("NOT_FOUND");
  if (variant.expiresAt !== undefined && variant.expiresAt <= now) throw new ShadowSaveError("EXPIRED");
  const ordered = [...questions].sort((left, right) => left.displayOrder - right.displayOrder);
  if (ordered.length !== variant.questionCount || ordered.reduce((sum, question) => sum + question.marks, 0) !== variant.totalMarks) {
    throw new ShadowSaveError("MISSING_SNAPSHOT");
  }
  for (const question of ordered) {
    let solution: { parts?: unknown[] } | null = null;
    try {
      solution = JSON.parse(question.solutionJson) as { parts?: unknown[] };
      JSON.parse(question.questionJson);
    } catch {
      throw new ShadowSaveError("MISSING_SNAPSHOT");
    }
    if (!Array.isArray(solution?.parts) || solution.parts.length === 0) throw new ShadowSaveError("MISSING_SNAPSHOT");
  }
  const { source } = variant;
  const sourceRelativePath = (question: ShadowQuestionForSave) => question.sourceUnitKey.split("#")[0] ?? source.questionPaperPath;
  return {
    savedPaper: {
      ownerId,
      importKey: `shadow:${variant._id}`,
      subjectKey: source.subjectKey,
      boardCode: source.boardCode,
      subjectSlug: source.subjectSlug,
      tier: source.tier,
      title: `${variant.title} (${variant.displayCode})`,
      targetMarks: variant.totalMarks,
      totalMarks: variant.totalMarks,
      timeMinutes: variant.durationMinutes,
      pdfFileName: `shadow-${variant.displayCode}-paper.pdf`,
      pdfContentType: "application/pdf",
      pdfFileSize: variant.paper.fileSize,
      pdfCdnUploadId: `convex-storage:${variant.paper.storageId}`,
      pdfUrl: shadowDownloadPath(variant._id, "paper"),
      questionCount: ordered.length,
      generationKind: "shadow" as const,
      createdAt: now,
      updatedAt: now,
    },
    questions: ordered.map((question) => ({
      displayOrder: question.displayOrder,
      unitKey: `shadow:${variant._id}:${question.displayOrder}`,
      sourceQuestionKey: question.sourceUnitKey,
      sourceRelativePath: sourceRelativePath(question),
      paperCode: source.paperCode,
      year: source.year,
      session: source.session,
      questionNumber: String(question.displayOrder),
      questionPartNumber: null,
      questionPath: question.partMarks.filter((part) => part.partId).map((part) => part.partId),
      totalMarks: question.marks,
      promptText: question.promptText,
      contextText: null,
      questionType: "shadow-variant",
      shadowQuestionVariantId: question._id,
      createdAt: now,
    })),
    receipt: {
      pdfSha256: variant.paper.sha256,
      markSchemeSha256: variant.markScheme.sha256,
      ownerId,
      generationKind: "shadow" as const,
      manifestRevision: variant.manifestRevision,
      subjectKey: source.subjectKey,
      subjectTier: source.tier,
      selectedUnitKeys: ordered.map((question) => question.sourceUnitKey),
      targetMarks: variant.totalMarks,
      totalMarks: variant.totalMarks,
      timeMinutes: variant.durationMinutes,
      questionCount: ordered.length,
      createdAt: now,
      claimedAt: now,
    },
  };
}
