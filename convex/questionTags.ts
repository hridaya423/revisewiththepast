import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

function compareTaggedPaperPriority(
  left: {
    questionCount: number;
    taggedAt: number;
    updatedAt: number;
  },
  right: {
    questionCount: number;
    taggedAt: number;
    updatedAt: number;
  },
) {
  if (left.questionCount !== right.questionCount) return right.questionCount - left.questionCount;
  if (left.taggedAt !== right.taggedAt) return right.taggedAt - left.taggedAt;
  return right.updatedAt - left.updatedAt;
}

function inferTierFromSourceRelativePath(sourceRelativePath: string | undefined) {
  const normalizedPath = (sourceRelativePath ?? "").toLowerCase();
  if (normalizedPath.includes("/foundation/")) return "foundation" as const;
  if (normalizedPath.includes("/higher/")) return "higher" as const;
  return "none" as const;
}

async function invalidateSubjectDetailSnapshot(ctx: { db: { query: Function; delete: Function } }, boardCode: string, subjectSlug: string) {
  const existing = await ctx.db
    .query("subjectDetailSnapshots")
    .withIndex("by_board_subject", (q: any) => q.eq("boardCode", boardCode))
    .filter((q: any) => q.eq(q.field("subjectSlug"), subjectSlug))
    .collect();

  for (const snapshot of existing) {
    await ctx.db.delete(snapshot._id);
  }
}

const taggedQuestionPartValidator = v.object({
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
  promptText: v.string(),
  contextText: v.union(v.string(), v.null()),
  bbox: v.union(
    v.object({
      x0: v.number(),
      y0: v.number(),
      x1: v.number(),
      y1: v.number(),
    }),
    v.null(),
  ),
  sourceMode: v.string(),
  assetIds: v.array(v.string()),

  regionSpans: v.optional(v.union(
    v.array(v.object({ pageNumber: v.number(), yTop: v.number(), yBottom: v.number() })),
    v.null(),
  )),
  stemSpans: v.optional(v.union(
    v.array(v.object({ pageNumber: v.number(), yTop: v.number(), yBottom: v.number() })),
    v.null(),
  )),
  referencedFigures: v.optional(v.array(v.string())),
  regionVersion: v.optional(v.string()),

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
});

export const upsertTaggedPaperWithQuestions = mutationGeneric({
  args: {
    sourceFile: v.string(),
    sourceRelativePath: v.string(),
    boardCode: v.string(),
    subjectSlug: v.string(),
    paperCode: v.string(),
    year: v.union(v.number(), v.null()),
    session: v.union(v.string(), v.null()),
    parserVersion: v.string(),
    taggerProvider: v.string(),
    taggerModel: v.string(),
    taxonomyVersion: v.string(),
    questionParts: v.array(taggedQuestionPartValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await invalidateSubjectDetailSnapshot(ctx, args.boardCode, args.subjectSlug);
    const existingByIdentity = await ctx.db
      .query("taggedPapers")
      .withIndex("by_paper_identity", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.and(
        q.eq(q.field("subjectSlug"), args.subjectSlug),
        q.eq(q.field("paperCode"), args.paperCode),
        q.eq(q.field("year"), args.year),
        q.eq(q.field("session"), args.session),
      ))
      .collect();
    const existingBySourceFile = await ctx.db
      .query("taggedPapers")
      .withIndex("by_source_file", (q) => q.eq("sourceFile", args.sourceFile))
      .unique();

    const existingCandidates = Array.from(new Map(
      [...existingByIdentity, ...(existingBySourceFile ? [existingBySourceFile] : [])]
        .map((paper) => [String(paper._id), paper]),
    ).values());
    const existing = existingCandidates
      .sort(compareTaggedPaperPriority)[0] ?? null;

    let taggedPaperId;
    if (existing) {
      taggedPaperId = existing._id;
      await ctx.db.patch(existing._id, {
        boardCode: args.boardCode,
        sourceRelativePath: args.sourceRelativePath,
        subjectSlug: args.subjectSlug,
        paperCode: args.paperCode,
        year: args.year,
        session: args.session,
        parserVersion: args.parserVersion,
        taggerProvider: args.taggerProvider,
        taggerModel: args.taggerModel,
        taxonomyVersion: args.taxonomyVersion,
        questionCount: args.questionParts.length,
        taggedAt: now,
        updatedAt: now,
      });

      for (const candidate of existingCandidates) {
        const existingParts = await ctx.db
          .query("taggedQuestionParts")
          .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", candidate._id))
          .collect();

        for (const part of existingParts) {
          await ctx.db.delete(part._id);
        }

        if (candidate._id !== existing._id) {
          await ctx.db.delete(candidate._id);
        }
      }
    } else {
      taggedPaperId = await ctx.db.insert("taggedPapers", {
        sourceFile: args.sourceFile,
        sourceRelativePath: args.sourceRelativePath,
        boardCode: args.boardCode,
        subjectSlug: args.subjectSlug,
        paperCode: args.paperCode,
        year: args.year,
        session: args.session,
        parserVersion: args.parserVersion,
        taggerProvider: args.taggerProvider,
        taggerModel: args.taggerModel,
        taxonomyVersion: args.taxonomyVersion,
        questionCount: args.questionParts.length,
        taggedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const part of args.questionParts) {
      await ctx.db.insert("taggedQuestionParts", {
        taggedPaperId,
        ...part,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      taggedPaperId,
      questionCount: args.questionParts.length,
    };
  },
});

export const getDuplicateTaggedPapers = queryGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("taggedPapers")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .collect();

    const groups = new Map<string, typeof papers>();
    for (const paper of papers) {
      const key = [paper.boardCode, paper.subjectSlug, paper.paperCode, paper.year ?? "-", paper.session ?? "-"].join("::");
      const existing = groups.get(key) ?? [];
      existing.push(paper);
      groups.set(key, existing);
    }

    return Array.from(groups.entries())
      .filter(([, records]) => records.length > 1)
      .map(([key, records]) => ({
        key,
        count: records.length,
        records: [...records]
          .sort(compareTaggedPaperPriority)
          .map((paper) => ({
            id: String(paper._id),
            sourceFile: paper.sourceFile,
            sourceRelativePath: paper.sourceRelativePath ?? null,
            questionCount: paper.questionCount,
            taggedAt: paper.taggedAt,
            updatedAt: paper.updatedAt,
          })),
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  },
});

export const dedupeTaggedPapersByIdentity = mutationGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("taggedPapers")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .collect();

    const groups = new Map<string, typeof papers>();
    for (const paper of papers) {
      const key = [paper.boardCode, paper.subjectSlug, paper.paperCode, paper.year ?? "-", paper.session ?? "-"].join("::");
      const existing = groups.get(key) ?? [];
      existing.push(paper);
      groups.set(key, existing);
    }

    let deletedPapers = 0;
    let deletedQuestionParts = 0;
    const dedupedGroups: Array<{ key: string; keptPaperId: string; removedPaperIds: string[] }> = [];

    for (const [key, records] of groups.entries()) {
      if (records.length <= 1) continue;

      const [keeper, ...duplicates] = [...records].sort(compareTaggedPaperPriority);
      const removedPaperIds: string[] = [];

      for (const duplicate of duplicates) {
        const parts = await ctx.db
          .query("taggedQuestionParts")
          .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", duplicate._id))
          .collect();

        for (const part of parts) {
          await ctx.db.delete(part._id);
          deletedQuestionParts += 1;
        }

        await ctx.db.delete(duplicate._id);
        deletedPapers += 1;
        removedPaperIds.push(String(duplicate._id));
      }

      dedupedGroups.push({
        key,
        keptPaperId: String(keeper._id),
        removedPaperIds,
      });
    }

    return {
      boardCode: args.boardCode,
      subjectSlug: args.subjectSlug,
      deletedPapers,
      deletedQuestionParts,
      dedupedGroups,
    };
  },
});

export const deleteTaggedByBoardSubjects = mutationGeneric({
  args: {
    boardCode: v.string(),
    subjectSlugs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let deletedPapers = 0;
    let deletedQuestionParts = 0;

    for (const subjectSlug of args.subjectSlugs) {
      await invalidateSubjectDetailSnapshot(ctx, args.boardCode, subjectSlug);
      const papers = await ctx.db
          .query("taggedPapers")
          .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
          .filter((q) => q.eq(q.field("subjectSlug"), subjectSlug))
          .collect();

      for (const paper of papers) {
        const parts = await ctx.db
          .query("taggedQuestionParts")
          .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", paper._id))
          .collect();

        for (const part of parts) {
          await ctx.db.delete(part._id);
          deletedQuestionParts += 1;
        }

        await ctx.db.delete(paper._id);
        deletedPapers += 1;
      }
    }

    return {
      boardCode: args.boardCode,
      subjectSlugs: args.subjectSlugs,
      deletedPapers,
      deletedQuestionParts,
    };
  },
});

export const getTaggedPaperBySourceFile = queryGeneric({
  args: { sourceFile: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("taggedPapers")
      .withIndex("by_source_file", (q) => q.eq("sourceFile", args.sourceFile))
      .unique();
  },
});

export const getFullTaggedPartsBySourceRelativePath = queryGeneric({
  args: { sourceRelativePath: v.string() },
  handler: async (ctx, args) => {
    const paper = await ctx.db
      .query("taggedPapers")
      .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", args.sourceRelativePath))
      .first();
    if (!paper) return { found: false as const, parts: [] as Array<Record<string, unknown>> };
    const parts = await ctx.db
      .query("taggedQuestionParts")
      .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", paper._id))
      .collect();
    return { found: true as const, parts };
  },
});

export const getSubjectDetailSnapshot = queryGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subjectDetailSnapshots")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .unique();
  },
});

export const upsertSubjectDetailSnapshot = mutationGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
    payloadJson: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subjectDetailSnapshots")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        payloadJson: args.payloadJson,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("subjectDetailSnapshots", {
      boardCode: args.boardCode,
      subjectSlug: args.subjectSlug,
      payloadJson: args.payloadJson,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getTaggingCounts = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const taggedPapers = await ctx.db.query("taggedPapers").collect();

    const byBoardSubject = new Map<string, { boardCode: string; subjectSlug: string; taggedPapers: number; taggedQuestionParts: number }>();
    let taggedQuestionPartsTotal = 0;

    for (const paper of taggedPapers) {
      const key = `${paper.boardCode}::${paper.subjectSlug}`;
      const existing = byBoardSubject.get(key) ?? {
        boardCode: paper.boardCode,
        subjectSlug: paper.subjectSlug,
        taggedPapers: 0,
        taggedQuestionParts: 0,
      };
      existing.taggedPapers += 1;
      existing.taggedQuestionParts += paper.questionCount;
      taggedQuestionPartsTotal += paper.questionCount;
      byBoardSubject.set(key, existing);
    }

    return {
      taggedPapers: taggedPapers.length,
      taggedQuestionParts: taggedQuestionPartsTotal,
      byBoardSubject: Array.from(byBoardSubject.values()).sort((a, b) => {
        if (a.boardCode !== b.boardCode) return a.boardCode.localeCompare(b.boardCode);
        return a.subjectSlug.localeCompare(b.subjectSlug);
      }),
    };
  },
});

export const getPaperMakerQuestionBank = queryGeneric({
  args: {
    boardCode: v.string(),
    subjectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const taggedPapers = await ctx.db
      .query("taggedPapers")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .collect();

    const paperAssets = await ctx.db
      .query("paperAssets")
      .withIndex("by_board_subject", (q) => q.eq("boardCode", args.boardCode))
      .filter((q) => q.eq(q.field("subjectSlug"), args.subjectSlug))
      .collect();

    const paperAssetByRelativePath = new Map<string, { cdnUrl: string; relativePath: string; fileName: string }>();
    const paperAssetByIdentity = new Map<string, { cdnUrl: string; relativePath: string; fileName: string }>();
    for (const asset of paperAssets) {
      if (asset.kind !== "question_paper") continue;
      const normalized = {
        cdnUrl: asset.cdnUrl,
        relativePath: asset.relativePath,
        fileName: asset.fileName,
      };
      paperAssetByRelativePath.set(asset.relativePath, normalized);
      const identityKey = [
        asset.boardCode,
        asset.subjectSlug,
        asset.tier,
        asset.year,
        asset.paperCode,
        asset.kind,
        asset.session,
      ].join("::");
      paperAssetByIdentity.set(identityKey, normalized);
    }

    const questionParts: Array<{
      partKey: string;
      unitKey: string;
      taggedPaperId: string;
      sourceRelativePath: string;
      questionPaperCdnUrl: string | null;
      questionPaperFileName: string | null;
      pageAssetCdnUrls: Array<{ pageNumber: number; cdnUrl: string | null }>;
      boardCode: string;
      subjectSlug: string;
      paperCode: string;
      year: number | null;
      session: string | null;
      questionId: string;
      questionNumber: string;
      questionPartNumber: string | null;
      sectionCode: string | null;
      sectionName: string | null;
      marks: number | null;
      canonicalLeaf: string;
      promptText: string;
      contextText: string | null;
      pageNumber: number;
      pageNumbers: number[];
      bbox: { x0: number; y0: number; x1: number; y1: number } | null;
      regionSpans?: Array<{ pageNumber: number; yTop: number; yBottom: number }> | null;
      stemSpans?: Array<{ pageNumber: number; yTop: number; yBottom: number }> | null;
      referencedFigures?: string[];
      regionVersion?: string;
      sourceMode: string;
      assetIds: string[];
      questionType?: string | null;
      isChoiceQuestion?: boolean;
      choiceGroupId?: string | null;
      choiceGroupType?: string | null;
      choiceSiblingQuestionIds?: string[];
    }> = [];

    for (const paper of taggedPapers) {
      const paperAsset = paperAssetByRelativePath.get(paper.sourceRelativePath)
        ?? paperAssetByIdentity.get([
          paper.boardCode,
          paper.subjectSlug,
          inferTierFromSourceRelativePath(paper.sourceRelativePath),
          paper.year ?? 0,
          paper.paperCode,
          "question_paper",
          paper.session ?? "",
        ].join("::"))
        ?? null;
      const questionPageAssets = await ctx.db
        .query("questionPageAssets")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", paper.sourceRelativePath))
        .collect();
      const pageAssetByPageNumber = new Map(questionPageAssets.map((asset) => [asset.pageNumber, asset.cdnUrl]));
      const parts = await ctx.db
        .query("taggedQuestionParts")
        .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", paper._id))
        .collect();

      for (const part of parts) {
        const unitKey = `${paper.sourceRelativePath}::${part.sectionCode ?? "-"}::q${part.questionNumber}`;
        questionParts.push({
          partKey: `${paper.sourceRelativePath}::${part.questionId}`,
          unitKey,
          taggedPaperId: String(paper._id),
          sourceRelativePath: paper.sourceRelativePath,
          questionPaperCdnUrl: paperAsset?.cdnUrl ?? null,
          questionPaperFileName: paperAsset?.fileName ?? null,
          pageAssetCdnUrls: part.pageNumbers.map((pageNumber: number) => ({
            pageNumber,
            cdnUrl: pageAssetByPageNumber.get(pageNumber) ?? null,
          })),
          boardCode: paper.boardCode,
          subjectSlug: paper.subjectSlug,
          paperCode: paper.paperCode,
          year: paper.year,
          session: paper.session,
          questionId: part.questionId,
          questionNumber: part.questionNumber,
          questionPartNumber: part.questionPartNumber,
          sectionCode: part.sectionCode,
          sectionName: part.sectionName,
          marks: part.marks,
          canonicalLeaf: part.canonicalLeaf,
          promptText: part.promptText,
          contextText: part.contextText,
          pageNumber: part.pageNumber,
          pageNumbers: part.pageNumbers,
          bbox: part.bbox,
          regionSpans: part.regionSpans ?? null,
          stemSpans: part.stemSpans ?? null,
          referencedFigures: part.referencedFigures ?? [],
          regionVersion: part.regionVersion,
          sourceMode: part.sourceMode,
          assetIds: part.assetIds,
          questionType: part.questionType,
          isChoiceQuestion: part.isChoiceQuestion || false,
          choiceGroupId: part.choiceGroupId,
          choiceGroupType: part.choiceGroupType,
          choiceSiblingQuestionIds: part.choiceSiblingQuestionIds,
        });
      }
    }

    return {
      boardCode: args.boardCode,
      subjectSlug: args.subjectSlug,
      taggedPaperCount: taggedPapers.length,
      questionPartCount: questionParts.length,
      questionParts,
    };
  },
});

export const getTaggingHealth = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const taggedPapers = await ctx.db.query("taggedPapers").collect();
    const taggedQuestionParts = await ctx.db.query("taggedQuestionParts").collect();

    const partCountByPaperId = new Map<string, number>();
    for (const part of taggedQuestionParts) {
      const key = String(part.taggedPaperId);
      partCountByPaperId.set(key, (partCountByPaperId.get(key) ?? 0) + 1);
    }

    const mismatches = taggedPapers
      .map((paper) => {
        const actualPartCount = partCountByPaperId.get(String(paper._id)) ?? 0;
        return {
          sourceFile: paper.sourceFile,
          boardCode: paper.boardCode,
          subjectSlug: paper.subjectSlug,
          paperCode: paper.paperCode,
          expectedQuestionCount: paper.questionCount,
          actualPartCount,
        };
      })
      .filter((row) => row.expectedQuestionCount !== row.actualPartCount)
      .sort((a, b) => {
        if (a.boardCode !== b.boardCode) return a.boardCode.localeCompare(b.boardCode);
        if (a.subjectSlug !== b.subjectSlug) return a.subjectSlug.localeCompare(b.subjectSlug);
        return a.sourceFile.localeCompare(b.sourceFile);
      });

    return {
      totalTaggedPapers: taggedPapers.length,
      totalTaggedQuestionParts: taggedQuestionParts.length,
      mismatchCount: mismatches.length,
      mismatches,
    };
  },
});

export const getPlatformOverview = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const taggedPapers = await ctx.db.query("taggedPapers").collect();
    const taggedQuestionParts = await ctx.db.query("taggedQuestionParts").collect();

    const paperById = new Map(taggedPapers.map((paper) => [String(paper._id), paper]));
    const byBoardSubject = new Map<string, {
      boardCode: string;
      subjectSlug: string;
      taggedPapers: number;
      taggedQuestionParts: number;
      totalConfidence: number;
      distinctTopics: Set<string>;
    }>();
    const byTopic = new Map<string, {
      canonicalLeaf: string;
      count: number;
      totalConfidence: number;
      boardSubjects: Map<string, number>;
    }>();
    const difficultyCounts = new Map<string, number>();
    const questionTypeCounts = new Map<string, number>();

    let totalConfidence = 0;
    let latestTaggedAt = 0;

    for (const paper of taggedPapers) {
      latestTaggedAt = Math.max(latestTaggedAt, paper.taggedAt);
      const key = `${paper.boardCode}::${paper.subjectSlug}`;
      const existing = byBoardSubject.get(key) ?? {
        boardCode: paper.boardCode,
        subjectSlug: paper.subjectSlug,
        taggedPapers: 0,
        taggedQuestionParts: 0,
        totalConfidence: 0,
        distinctTopics: new Set<string>(),
      };
      existing.taggedPapers += 1;
      byBoardSubject.set(key, existing);
    }

    for (const part of taggedQuestionParts) {
      const paper = paperById.get(String(part.taggedPaperId));
      if (!paper) continue;

      totalConfidence += part.confidence;

      const boardSubjectKey = `${paper.boardCode}::${paper.subjectSlug}`;
      const boardSubject = byBoardSubject.get(boardSubjectKey);
      if (boardSubject) {
        boardSubject.taggedQuestionParts += 1;
        boardSubject.totalConfidence += part.confidence;
        boardSubject.distinctTopics.add(part.canonicalLeaf);
      }

      const topic = byTopic.get(part.canonicalLeaf) ?? {
        canonicalLeaf: part.canonicalLeaf,
        count: 0,
        totalConfidence: 0,
        boardSubjects: new Map<string, number>(),
      };
      topic.count += 1;
      topic.totalConfidence += part.confidence;
      topic.boardSubjects.set(boardSubjectKey, (topic.boardSubjects.get(boardSubjectKey) ?? 0) + 1);
      byTopic.set(part.canonicalLeaf, topic);

      difficultyCounts.set(part.difficulty, (difficultyCounts.get(part.difficulty) ?? 0) + 1);
      questionTypeCounts.set(part.questionType, (questionTypeCounts.get(part.questionType) ?? 0) + 1);
    }

    const totalParts = taggedQuestionParts.length;
    const totalPapers = taggedPapers.length;

    return {
      generatedAt: Date.now(),
      latestTaggedAt,
      totals: {
        taggedPapers: totalPapers,
        taggedQuestionParts: totalParts,
        distinctTopics: byTopic.size,
        distinctSubjects: byBoardSubject.size,
        averageConfidence: totalParts > 0 ? totalConfidence / totalParts : 0,
        averageQuestionPartsPerPaper: totalPapers > 0 ? totalParts / totalPapers : 0,
      },
      byBoardSubject: Array.from(byBoardSubject.values())
        .map((row) => ({
          boardCode: row.boardCode,
          subjectSlug: row.subjectSlug,
          taggedPapers: row.taggedPapers,
          taggedQuestionParts: row.taggedQuestionParts,
          distinctTopics: row.distinctTopics.size,
          averageConfidence: row.taggedQuestionParts > 0 ? row.totalConfidence / row.taggedQuestionParts : 0,
          shareOfQuestionParts: totalParts > 0 ? row.taggedQuestionParts / totalParts : 0,
        }))
        .sort((a, b) => {
          if (b.taggedQuestionParts !== a.taggedQuestionParts) return b.taggedQuestionParts - a.taggedQuestionParts;
          if (a.boardCode !== b.boardCode) return a.boardCode.localeCompare(b.boardCode);
          return a.subjectSlug.localeCompare(b.subjectSlug);
        }),
      topTopics: Array.from(byTopic.values())
        .map((topic) => {
          const sampleBoardSubject = Array.from(topic.boardSubjects.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          return {
            canonicalLeaf: topic.canonicalLeaf,
            count: topic.count,
            averageConfidence: topic.count > 0 ? topic.totalConfidence / topic.count : 0,
            shareOfQuestionParts: totalParts > 0 ? topic.count / totalParts : 0,
            sampleBoardSubject,
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      difficultyMix: ["low", "medium", "high"].map((label) => ({
        label,
        count: difficultyCounts.get(label) ?? 0,
        share: totalParts > 0 ? (difficultyCounts.get(label) ?? 0) / totalParts : 0,
      })),
      questionTypeMix: Array.from(questionTypeCounts.entries())
        .map(([label, count]) => ({
          label,
          count,
          share: totalParts > 0 ? count / totalParts : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
    };
  },
});

export const getFrequencyDashboard = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const taggedPapers = await ctx.db.query("taggedPapers").collect();
    const taggedQuestionParts = await ctx.db.query("taggedQuestionParts").collect();

    const facetConfigs = [
      { key: "canonicalTopics", label: "Canonical topics", getValues: (part: typeof taggedQuestionParts[number]) => [part.canonicalLeaf] },
      { key: "setTexts", label: "Set texts", getValues: (part: typeof taggedQuestionParts[number]) => part.setText ? [part.setText] : [] },
      { key: "clusters", label: "Clusters", getValues: (part: typeof taggedQuestionParts[number]) => part.cluster ? [part.cluster] : [] },
      { key: "namedPoems", label: "Poems", getValues: (part: typeof taggedQuestionParts[number]) => part.namedPoem ?? [] },
      { key: "characters", label: "Characters", getValues: (part: typeof taggedQuestionParts[number]) => part.characters ?? [] },
      { key: "themes", label: "Themes", getValues: (part: typeof taggedQuestionParts[number]) => part.themes ?? [] },
      { key: "taskModes", label: "Task modes", getValues: (part: typeof taggedQuestionParts[number]) => part.taskMode ? [part.taskMode] : [] },
      { key: "domains", label: "Domains", getValues: (part: typeof taggedQuestionParts[number]) => part.domain ? [part.domain] : [] },
      { key: "subtopics", label: "Subtopics", getValues: (part: typeof taggedQuestionParts[number]) => part.subtopic ? [part.subtopic] : [] },
      { key: "representations", label: "Representations", getValues: (part: typeof taggedQuestionParts[number]) => part.representation ? [part.representation] : [] },
      { key: "subskills", label: "Subskills", getValues: (part: typeof taggedQuestionParts[number]) => part.subskill ?? [] },
      { key: "errorTraps", label: "Error traps", getValues: (part: typeof taggedQuestionParts[number]) => part.errorTrap ?? [] },
      { key: "units", label: "Units", getValues: (part: typeof taggedQuestionParts[number]) => part.unit ? [part.unit] : [] },
      { key: "caseStudies", label: "Case studies", getValues: (part: typeof taggedQuestionParts[number]) => part.caseStudy ?? [] },
      { key: "resourceTracks", label: "Resource tracks", getValues: (part: typeof taggedQuestionParts[number]) => part.resourceTrack ? [part.resourceTrack] : [] },
      { key: "processes", label: "Processes", getValues: (part: typeof taggedQuestionParts[number]) => part.process ?? [] },
    ] as const;

    const breakdownConfigs = [
      { primary: "setTexts", secondary: "characters", label: "Top characters by text" },
      { primary: "setTexts", secondary: "themes", label: "Top themes by text" },
      { primary: "clusters", secondary: "namedPoems", label: "Top poems by cluster" },
      { primary: "representations", secondary: "subskills", label: "Top subskills by representation" },
      { primary: "representations", secondary: "errorTraps", label: "Top error traps by representation" },
      { primary: "resourceTracks", secondary: "processes", label: "Top processes by resource track" },
      { primary: "units", secondary: "caseStudies", label: "Top case studies by unit" },
      { primary: "units", secondary: "processes", label: "Top processes by unit" },
    ] as const;

    const facetConfigByKey = new Map(facetConfigs.map((config) => [config.key, config]));

    const buildFrequencyRows = (
      records: Array<{ part: typeof taggedQuestionParts[number]; paperId: string }>,
      totalPaperCount: number,
      mode: "opportunity" | "option",
      getValues: (part: typeof taggedQuestionParts[number]) => string[],
    ) => {
      const rows = new Map<string, { value: string; questionPartCount: number; paperIds: Set<string> }>();
      const seen = new Set<string>();
      const totalQuestionUnits = mode === "option"
        ? records.length
        : new Set(records.map(({ part, paperId }) => `${paperId}::${part.choiceGroupId ?? part.questionId}`)).size;

      for (const { part, paperId } of records) {
        const baseKey = mode === "option"
          ? `${paperId}::${part.questionId}`
          : `${paperId}::${part.choiceGroupId ?? part.questionId}`;
        for (const value of getValues(part).filter(Boolean)) {
          const dedupeKey = `${baseKey}::${value}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const row = rows.get(value) ?? {
            value,
            questionPartCount: 0,
            paperIds: new Set<string>(),
          };
          row.questionPartCount += 1;
          row.paperIds.add(paperId);
          rows.set(value, row);
        }
      }

      return Array.from(rows.values())
        .map((row) => ({
          value: row.value,
          questionPartCount: row.questionPartCount,
          paperCount: row.paperIds.size,
          shareOfQuestionParts: totalQuestionUnits > 0 ? row.questionPartCount / totalQuestionUnits : 0,
          shareOfPapers: totalPaperCount > 0 ? row.paperIds.size / totalPaperCount : 0,
        }))
        .sort((a, b) => {
          if (b.paperCount !== a.paperCount) return b.paperCount - a.paperCount;
          if (b.questionPartCount !== a.questionPartCount) return b.questionPartCount - a.questionPartCount;
          return a.value.localeCompare(b.value);
        });
    };

    const buildBreakdowns = (
      records: Array<{ part: typeof taggedQuestionParts[number]; paperId: string }>,
      totalPaperCount: number,
      mode: "opportunity" | "option",
    ) => {
      return breakdownConfigs.flatMap((config) => {
        const primaryConfig = facetConfigByKey.get(config.primary);
        const secondaryConfig = facetConfigByKey.get(config.secondary);
        if (!primaryConfig || !secondaryConfig) return [];

        const groups = new Map<string, { value: string; questionPartCount: number; paperIds: Set<string>; secondary: Map<string, { value: string; questionPartCount: number; paperIds: Set<string> }> }>();
        const seen = new Set<string>();
        const totalQuestionUnits = mode === "option"
          ? records.length
          : new Set(records.map(({ part, paperId }) => `${paperId}::${part.choiceGroupId ?? part.questionId}`)).size;

        for (const { part, paperId } of records) {
          const primaryValues = primaryConfig.getValues(part).filter(Boolean);
          const secondaryValues = secondaryConfig.getValues(part).filter(Boolean);
          if (primaryValues.length === 0 || secondaryValues.length === 0) continue;

          const baseKey = mode === "option"
            ? `${paperId}::${part.questionId}`
            : `${paperId}::${part.choiceGroupId ?? part.questionId}`;

          for (const primaryValue of primaryValues) {
            const primaryGroup = groups.get(primaryValue) ?? {
              value: primaryValue,
              questionPartCount: 0,
              paperIds: new Set<string>(),
              secondary: new Map<string, { value: string; questionPartCount: number; paperIds: Set<string> }>(),
            };

            for (const secondaryValue of secondaryValues) {
              const dedupeKey = `${baseKey}::${primaryValue}::${secondaryValue}`;
              if (seen.has(dedupeKey)) continue;
              seen.add(dedupeKey);

              primaryGroup.questionPartCount += 1;
              primaryGroup.paperIds.add(paperId);

              const secondaryRow = primaryGroup.secondary.get(secondaryValue) ?? {
                value: secondaryValue,
                questionPartCount: 0,
                paperIds: new Set<string>(),
              };
              secondaryRow.questionPartCount += 1;
              secondaryRow.paperIds.add(paperId);
              primaryGroup.secondary.set(secondaryValue, secondaryRow);
            }

            groups.set(primaryValue, primaryGroup);
          }
        }

        return Array.from(groups.values())
          .sort((a, b) => b.questionPartCount - a.questionPartCount)
          .slice(0, 4)
          .map((group) => ({
            label: config.label,
            primaryFacetKey: config.primary,
            secondaryFacetKey: config.secondary,
            primaryValue: group.value,
            questionPartCount: group.questionPartCount,
            paperCount: group.paperIds.size,
            shareOfQuestionParts: totalQuestionUnits > 0 ? group.questionPartCount / totalQuestionUnits : 0,
            shareOfPapers: totalPaperCount > 0 ? group.paperIds.size / totalPaperCount : 0,
            rows: Array.from(group.secondary.values())
              .map((row) => ({
                value: row.value,
                questionPartCount: row.questionPartCount,
                paperCount: row.paperIds.size,
                shareOfQuestionParts: totalQuestionUnits > 0 ? row.questionPartCount / totalQuestionUnits : 0,
                shareOfPapers: totalPaperCount > 0 ? row.paperIds.size / totalPaperCount : 0,
              }))
              .sort((a, b) => b.questionPartCount - a.questionPartCount)
              .slice(0, 6),
          }));
      });
    };

    const buildModeSummary = (
      records: Array<{ part: typeof taggedQuestionParts[number]; paperId: string }>,
      totalPaperCount: number,
      mode: "opportunity" | "option",
    ) => ({
      key: mode,
      label: mode === "opportunity" ? "Opportunity" : "Option",
      topicRows: buildFrequencyRows(records, totalPaperCount, mode, (part) => [part.canonicalLeaf]),
      facetGroups: facetConfigs
        .filter((config) => config.key !== "canonicalTopics")
        .map((config) => ({
          key: config.key,
          label: config.label,
          rows: buildFrequencyRows(records, totalPaperCount, mode, config.getValues).slice(0, 12),
        }))
        .filter((group) => group.rows.length > 0),
      breakdowns: buildBreakdowns(records, totalPaperCount, mode),
    });

    const derivePaperFamily = (subjectSlug: string, paperCode: string) => {
      if (subjectSlug !== "combined-science") return null;
      const family = paperCode.match(/^(biology|chemistry|physics)-/i)?.[1]?.toLowerCase();
      return family ?? null;
    };

    const boardSubjects = new Map<string, {
      key: string;
      boardCode: string;
      subjectSlug: string;
        taggedPapers: number;
        taggedQuestionParts: number;
        latestTaggedAt: number;
        paperIds: Set<string>;
        filters: Map<string, {
          key: string;
          label: string;
          kind: "all" | "family" | "paperCode";
          taggedPapers: number;
          taggedQuestionParts: number;
          paperIds: Set<string>;
          records: Array<{ part: typeof taggedQuestionParts[number]; paperId: string }>;
        }>;
      }>();

    const paperById = new Map<string, typeof taggedPapers[number]>();
    let latestTaggedAt = 0;

    for (const paper of taggedPapers) {
      const key = `${paper.boardCode}::${paper.subjectSlug}`;
      latestTaggedAt = Math.max(latestTaggedAt, paper.taggedAt);
      paperById.set(String(paper._id), paper);

      const existing = boardSubjects.get(key) ?? {
        key,
        boardCode: paper.boardCode,
        subjectSlug: paper.subjectSlug,
          taggedPapers: 0,
          taggedQuestionParts: 0,
          latestTaggedAt: 0,
          paperIds: new Set<string>(),
          filters: new Map<string, {
            key: string;
            label: string;
            kind: "all" | "family" | "paperCode";
            taggedPapers: number;
            taggedQuestionParts: number;
            paperIds: Set<string>;
            records: Array<{ part: typeof taggedQuestionParts[number]; paperId: string }>;
          }>(),
        };

      existing.taggedPapers += 1;
      existing.latestTaggedAt = Math.max(existing.latestTaggedAt, paper.taggedAt);
      existing.paperIds.add(String(paper._id));

      const ensureFilter = (filterKey: string, label: string, kind: "all" | "family" | "paperCode") => {
        const current = existing.filters.get(filterKey) ?? {
          key: filterKey,
          label,
          kind,
          taggedPapers: 0,
          taggedQuestionParts: 0,
          paperIds: new Set<string>(),
          records: [],
        };
        if (!current.paperIds.has(String(paper._id))) {
          current.paperIds.add(String(paper._id));
          current.taggedPapers += 1;
        }
        existing.filters.set(filterKey, current);
      };

      ensureFilter("all", "All papers", "all");

      const family = derivePaperFamily(paper.subjectSlug, paper.paperCode);
      if (family) {
        ensureFilter(`family:${family}`, family, "family");
      }

      ensureFilter(`paper:${paper.paperCode}`, paper.paperCode, "paperCode");
      boardSubjects.set(key, existing);
    }

    for (const part of taggedQuestionParts) {
      const paper = paperById.get(String(part.taggedPaperId));
      if (!paper) continue;

      const key = `${paper.boardCode}::${paper.subjectSlug}`;
      const boardSubject = boardSubjects.get(key);
      if (!boardSubject) continue;

      boardSubject.taggedQuestionParts += 1;

      const pushToFilter = (filterKey: string) => {
        const filter = boardSubject.filters.get(filterKey);
        if (!filter) return;
        filter.taggedQuestionParts += 1;
        filter.records.push({ part, paperId: String(part.taggedPaperId) });
      };

      pushToFilter("all");

      const family = derivePaperFamily(paper.subjectSlug, paper.paperCode);
      if (family) {
        pushToFilter(`family:${family}`);
      }

      pushToFilter(`paper:${paper.paperCode}`);
    }

    const rows = Array.from(boardSubjects.values())
      .map((entry) => {
        const filters = Array.from(entry.filters.values())
          .map((filter) => ({
            key: filter.key,
            label: filter.label,
            kind: filter.kind,
            taggedPapers: filter.taggedPapers,
            taggedQuestionParts: filter.taggedQuestionParts,
            modes: [
              buildModeSummary(filter.records, filter.taggedPapers, "opportunity"),
              buildModeSummary(filter.records, filter.taggedPapers, "option"),
            ],
          }))
          .sort((a, b) => {
            const rank = { all: 0, family: 1, paperCode: 2 };
            if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
            if (a.kind === "paperCode" && b.kind === "paperCode") return a.label.localeCompare(b.label, undefined, { numeric: true });
            return a.label.localeCompare(b.label);
          });

        return {
          key: entry.key,
          boardCode: entry.boardCode,
          subjectSlug: entry.subjectSlug,
          taggedPapers: entry.taggedPapers,
          taggedQuestionParts: entry.taggedQuestionParts,
          latestTaggedAt: entry.latestTaggedAt,
          distinctTopics: filters[0]?.modes[0]?.topicRows.length ?? 0,
          filters,
        };
      })
      .sort((a, b) => {
        if (b.taggedQuestionParts !== a.taggedQuestionParts) return b.taggedQuestionParts - a.taggedQuestionParts;
        if (a.boardCode !== b.boardCode) return a.boardCode.localeCompare(b.boardCode);
        return a.subjectSlug.localeCompare(b.subjectSlug);
      });

    return {
      generatedAt: Date.now(),
      latestTaggedAt,
      totals: {
        taggedPapers: taggedPapers.length,
        taggedQuestionParts: taggedQuestionParts.length,
        boardSubjects: rows.length,
      },
      boardSubjects: rows,
    };
  },
});
