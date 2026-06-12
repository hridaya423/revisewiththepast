import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  examBoards: defineTable({
    code: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_code", ["code"]),

  subjects: defineTable({
    slug: v.string(),
    name: v.string(),
    category: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["category"]),

  subjectBoardConfigs: defineTable({
    subjectId: v.id("subjects"),
    boardId: v.id("examBoards"),
    qualificationTitle: v.string(),
    tierMode: v.union(v.literal("none"), v.literal("foundation_higher")),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subjectId"])
    .index("by_board", ["boardId"])
    .index("by_subject_board", ["subjectId", "boardId"]),

  paperDefinitions: defineTable({
    subjectBoardConfigId: v.id("subjectBoardConfigs"),
    code: v.string(),
    name: v.string(),
    order: v.number(),
    defaultDurationMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subject_board_config", ["subjectBoardConfigId"])
    .index("by_subject_board_config_code", ["subjectBoardConfigId", "code"]),

  paperAssets: defineTable({
    boardCode: v.string(),
    subjectSlug: v.string(),
    tier: v.union(v.literal("none"), v.literal("foundation"), v.literal("higher")),
    year: v.number(),
    session: v.string(),
    paperCode: v.string(),
    paperName: v.string(),
    kind: v.union(v.literal("question_paper"), v.literal("mark_scheme"), v.literal("insert")),
    source: v.union(v.literal("pmt"), v.literal("revisionworld"), v.literal("manual")),
    relativePath: v.string(),
    fileName: v.string(),
    cdnUploadId: v.string(),
    cdnUrl: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_relative_path", ["relativePath"])
    .index("by_subject", ["subjectSlug"])
    .index("by_board_subject", ["boardCode", "subjectSlug"])
    .index("by_paper_identity", ["boardCode", "subjectSlug", "tier", "year", "paperCode", "kind", "session"]),

  questionPageAssets: defineTable({
    sourceRelativePath: v.string(),
    assetId: v.string(),
    pageNumber: v.number(),
    relativePath: v.string(),
    fileName: v.string(),
    cdnUploadId: v.string(),
    cdnUrl: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_relative_path", ["relativePath"])
    .index("by_source_relative_path", ["sourceRelativePath"])
    .index("by_source_relative_path_page", ["sourceRelativePath", "pageNumber"]),

  insertPageAssets: defineTable({
    sourceRelativePath: v.string(),
    pageNumber: v.number(),
    relativePath: v.string(),
    fileName: v.string(),
    cdnUploadId: v.string(),
    cdnUrl: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    ocrText: v.optional(v.string()),
    detectedSupportLabels: v.optional(v.array(v.string())),
    uploadedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_relative_path", ["relativePath"])
    .index("by_source_relative_path", ["sourceRelativePath"])
    .index("by_source_relative_path_page", ["sourceRelativePath", "pageNumber"]),

  taggedPapers: defineTable({
    sourceFile: v.string(),
    sourceRelativePath: v.optional(v.string()),
    boardCode: v.string(),
    subjectSlug: v.string(),
    paperCode: v.string(),
    year: v.union(v.number(), v.null()),
    session: v.union(v.string(), v.null()),
    parserVersion: v.string(),
    taggerProvider: v.string(),
    taggerModel: v.string(),
    taxonomyVersion: v.string(),
    questionCount: v.number(),
    taggedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source_file", ["sourceFile"])
    .index("by_source_relative_path", ["sourceRelativePath"])
    .index("by_board_subject", ["boardCode", "subjectSlug"])
    .index("by_paper_identity", ["boardCode", "subjectSlug", "paperCode", "year", "session"]),

  subjectDetailSnapshots: defineTable({
    boardCode: v.string(),
    subjectSlug: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_board_subject", ["boardCode", "subjectSlug"]),

  taggedQuestionParts: defineTable({
    taggedPaperId: v.id("taggedPapers"),
    questionId: v.string(),
    questionNumber: v.string(),
    questionPartNumber: v.union(v.string(), v.null()),
    sectionCode: v.union(v.string(), v.null()),
    sectionName: v.union(v.string(), v.null()),
    pageNumber: v.number(),
    pageNumbers: v.array(v.number()),
    marks: v.union(v.number(), v.null()),
    commandWord: v.union(v.string(), v.null()),
    canonicalLeaf: v.string(),
    knowledgePoints: v.array(v.string()),
    skillsTested: v.array(v.string()),
    bloomLevel: v.union(
      v.literal("remember"),
      v.literal("understand"),
      v.literal("apply"),
      v.literal("analyze"),
      v.literal("evaluate"),
      v.literal("create"),
    ),
    difficulty: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    questionType: v.union(
      v.literal("multiple-choice"),
      v.literal("short-answer"),
      v.literal("structured"),
      v.literal("extended-writing"),
      v.literal("data-response"),
      v.literal("case-study"),
    ),
    keyTerms: v.array(v.string()),
    specReferences: v.array(v.string()),
    confidence: v.number(),
    evidenceSnippet: v.string(),
    taxonomyVersion: v.string(),
    promptText: v.optional(v.string()),
    contextText: v.optional(v.union(v.string(), v.null())),
    bbox: v.optional(v.union(
      v.object({
        x0: v.number(),
        y0: v.number(),
        x1: v.number(),
        y1: v.number(),
      }),
      v.null(),
    )),
    sourceMode: v.string(),
    assetIds: v.array(v.string()),

    isChoiceQuestion: v.optional(v.boolean()),
    choiceGroupId: v.optional(v.union(v.string(), v.null())),
    choiceGroupType: v.optional(v.union(v.string(), v.null())),
    choiceOptionLabel: v.optional(v.union(v.string(), v.null())),
    choiceOptionIndex: v.optional(v.union(v.number(), v.null())),
    choiceSiblingQuestionIds: v.optional(v.array(v.string())),
    sharedChoiceStem: v.optional(v.union(v.string(), v.null())),

    setText: v.optional(v.union(v.string(), v.null())),
    cluster: v.optional(v.union(v.string(), v.null())),
    namedPoem: v.optional(v.array(v.string())),
    characters: v.optional(v.array(v.string())),
    themes: v.optional(v.array(v.string())),
    taskMode: v.optional(v.union(v.string(), v.null())),

    domain: v.optional(v.union(v.string(), v.null())),
    subtopic: v.optional(v.union(v.string(), v.null())),
    representation: v.optional(v.union(v.string(), v.null())),
    subskill: v.optional(v.array(v.string())),
    errorTrap: v.optional(v.array(v.string())),

    unit: v.optional(v.union(v.string(), v.null())),
    caseStudy: v.optional(v.array(v.string())),
    resourceTrack: v.optional(v.union(v.string(), v.null())),
    process: v.optional(v.array(v.string())),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tagged_paper", ["taggedPaperId"])
    .index("by_question_id", ["questionId"])
    .index("by_canonical_leaf", ["canonicalLeaf"])
    .index("by_choice_group", ["choiceGroupId"])
    .index("by_set_text", ["setText"])
    .index("by_cluster", ["cluster"])
    .index("by_themes", ["themes"])
    .index("by_characters", ["characters"])
    .index("by_subskill", ["subskill"])
    .index("by_error_trap", ["errorTrap"])
    .index("by_case_study", ["caseStudy"])
    .index("by_resource_track", ["resourceTrack"]),

  markingSubmissions: defineTable({
    ownerId: v.optional(v.string()),
    savedPaperId: v.optional(v.id("savedPapers")),
    boardCode: v.string(),
    subjectSlug: v.string(),
    subjectKey: v.string(),
    paperCode: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
    year: v.optional(v.number()),
    session: v.optional(v.string()),
    rubricVersion: v.optional(v.string()),
    status: v.union(
      v.literal("uploaded"),
      v.literal("ocr_complete"),
      v.literal("scored"),
      v.literal("review_required"),
    ),
    studentLabel: v.optional(v.string()),
    importSource: v.optional(v.union(
      v.literal("manual_upload"),
      v.literal("imported_pdf"),
      v.literal("saved_paper"),
    )),
    detectedPaperIdentity: v.optional(v.object({
      paperCode: v.string(),
      year: v.number(),
      session: v.string(),
      tier: v.union(v.literal("none"), v.literal("foundation"), v.literal("higher")),
      sourceRelativePath: v.optional(v.string()),
      examReference: v.optional(v.string()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_board_subject", ["boardCode", "subjectSlug"])
    .index("by_subject_key", ["subjectKey"])
    .index("by_saved_paper", ["savedPaperId"]),

  markingResponses: defineTable({
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    questionNumber: v.optional(v.string()),
    questionPartNumber: v.optional(v.string()),
    sourceImageUrl: v.optional(v.string()),
    ocrText: v.string(),
    ocrProvider: v.string(),
    ocrModel: v.string(),
    ocrConfidence: v.optional(v.number()),
    ocrRawJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_submission_question", ["submissionId", "questionKey"]),

  markingResponsePages: defineTable({
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    questionNumber: v.optional(v.string()),
    questionPartNumber: v.optional(v.string()),
    pageLabel: v.optional(v.string()),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    cdnUploadId: v.string(),
    sourceImageUrl: v.string(),
    scriptPageNumber: v.optional(v.number()),
    ocrText: v.optional(v.string()),
    uploadedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_submission_question", ["submissionId", "questionKey"]),

  markingQuestionStatuses: defineTable({
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    status: v.union(
      v.literal("unmapped"),
      v.literal("pages_assigned"),
      v.literal("ocr_pending"),
      v.literal("ocr_ready"),
      v.literal("mark_scheme_ready"),
      v.literal("ai_scored"),
      v.literal("saved"),
      v.literal("needs_manual_review"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_submission_question", ["submissionId", "questionKey"]),

  markingScores: defineTable({
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    awardedMarks: v.number(),
    maxMarks: v.number(),
    confidence: v.number(),
    needsReview: v.boolean(),
    rationale: v.string(),
    evidenceJson: v.string(),
    scorerProvider: v.string(),
    scorerModel: v.string(),
    scoreStatus: v.optional(v.union(v.literal("ai_suggested"), v.literal("confirmed"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_submission_question", ["submissionId", "questionKey"]),

  markingModerations: defineTable({
    submissionId: v.id("markingSubmissions"),
    questionKey: v.string(),
    originalAwardedMarks: v.number(),
    moderatedAwardedMarks: v.number(),
    moderatorLabel: v.optional(v.string()),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_submission_question", ["submissionId", "questionKey"]),

  savedPapers: defineTable({
    ownerId: v.string(),
    subjectKey: v.string(),
    boardCode: v.string(),
    subjectSlug: v.string(),
    tier: v.optional(v.union(v.literal("none"), v.literal("foundation"), v.literal("higher"))),
    title: v.string(),
    targetMarks: v.number(),
    totalMarks: v.number(),
    timeMinutes: v.number(),
    pdfFileName: v.string(),
    pdfContentType: v.string(),
    pdfFileSize: v.number(),
    pdfCdnUploadId: v.string(),
    pdfUrl: v.string(),
    questionCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_subject", ["subjectKey"]),

  savedPaperQuestions: defineTable({
    savedPaperId: v.id("savedPapers"),
    displayOrder: v.number(),
    unitKey: v.string(),
    sourceQuestionKey: v.string(),
    sourceRelativePath: v.string(),
    paperCode: v.string(),
    year: v.optional(v.number()),
    session: v.optional(v.string()),
    questionNumber: v.string(),
    questionPartNumber: v.optional(v.union(v.string(), v.null())),
    questionPath: v.optional(v.array(v.string())),
    totalMarks: v.number(),
    promptText: v.string(),
    contextText: v.optional(v.union(v.string(), v.null())),
    questionType: v.optional(v.union(v.string(), v.null())),
    isChoiceQuestion: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_saved_paper", ["savedPaperId"])
    .index("by_saved_paper_order", ["savedPaperId", "displayOrder"]),

  papers: defineTable({
    subjectId: v.id("subjects"),
    boardId: v.id("examBoards"),
    subjectBoardConfigId: v.id("subjectBoardConfigs"),
    paperDefinitionId: v.id("paperDefinitions"),
    year: v.number(),
    session: v.string(),
    componentCode: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("foundation"), v.literal("higher"))),
    source: v.union(v.literal("pmt"), v.literal("revisionworld")),
    questionPaperUrl: v.optional(v.string()),
    questionPaperStorageId: v.optional(v.string()),
    markSchemeUrl: v.optional(v.string()),
    markSchemeStorageId: v.optional(v.string()),
    insertUrls: v.optional(v.array(v.string())),
    insertStorageIds: v.optional(v.array(v.string())),
    downloadedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subjectId"])
    .index("by_board", ["boardId"])
    .index("by_subject_board_year", ["subjectId", "boardId", "year"]),
});
