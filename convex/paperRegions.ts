import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const spanValidator = v.object({
  pageNumber: v.number(),
  yTop: v.number(),
  yBottom: v.number(),
});

export const backfillPaperRegions = mutationGeneric({
  args: {
    sourceRelativePath: v.string(),
    regionVersion: v.string(),
    figures: v.array(v.object({
      label: v.string(),
      pageNumber: v.number(),
      yTop: v.number(),
      yBottom: v.number(),
    })),
    pageLayouts: v.array(v.object({
      pageNumber: v.number(),
      pageWidth: v.number(),
      pageHeight: v.number(),
      contentX0: v.number(),
      contentX1: v.number(),
      headerFloorY: v.number(),
      footerCeilingY: v.number(),
    })),
    parts: v.array(v.object({
      questionId: v.string(),
      regionSpans: v.union(v.array(spanValidator), v.null()),
      stemSpans: v.union(v.array(spanValidator), v.null()),
      referencedFigures: v.array(v.string()),
    })),
    maxUnmatchedRatio: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const maxUnmatchedRatio = args.maxUnmatchedRatio ?? 0.05;

    const papers = await ctx.db
      .query("taggedPapers")
      .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", args.sourceRelativePath))
      .collect();
    const partRowByQuestionId = new Map<string, { _id: unknown }>();
    for (const paper of papers) {
      const rows = await ctx.db
        .query("taggedQuestionParts")
        .withIndex("by_tagged_paper", (q) => q.eq("taggedPaperId", paper._id))
        .collect();
      for (const row of rows) partRowByQuestionId.set(row.questionId, row);
    }

    const unmatched: string[] = [];
    for (const part of args.parts) {
      if (!partRowByQuestionId.has(part.questionId)) unmatched.push(part.questionId);
    }
    const unmatchedRatio = args.parts.length > 0 ? unmatched.length / args.parts.length : 0;
    if (unmatchedRatio > maxUnmatchedRatio) {
      return {
        applied: false,
        reason: "too-many-unmatched",
        taggedPaperCount: papers.length,
        partsTotal: args.parts.length,
        unmatched,
        unmatchedRatio,
        figures: 0,
        pageLayouts: 0,
        patched: 0,
      };
    }

    const existingFigures = await ctx.db
      .query("paperFigures")
      .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", args.sourceRelativePath))
      .collect();
    for (const figure of existingFigures) await ctx.db.delete(figure._id);
    for (const figure of args.figures) {
      await ctx.db.insert("paperFigures", {
        sourceRelativePath: args.sourceRelativePath,
        label: figure.label,
        pageNumber: figure.pageNumber,
        yTop: figure.yTop,
        yBottom: figure.yBottom,
        regionVersion: args.regionVersion,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingLayouts = await ctx.db
      .query("paperPageLayouts")
      .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", args.sourceRelativePath))
      .collect();
    for (const layout of existingLayouts) await ctx.db.delete(layout._id);
    for (const layout of args.pageLayouts) {
      await ctx.db.insert("paperPageLayouts", {
        sourceRelativePath: args.sourceRelativePath,
        pageNumber: layout.pageNumber,
        pageWidth: layout.pageWidth,
        pageHeight: layout.pageHeight,
        contentX0: layout.contentX0,
        contentX1: layout.contentX1,
        headerFloorY: layout.headerFloorY,
        footerCeilingY: layout.footerCeilingY,
        regionVersion: args.regionVersion,
        createdAt: now,
        updatedAt: now,
      });
    }

    let patched = 0;
    for (const part of args.parts) {
      const row = partRowByQuestionId.get(part.questionId);
      if (!row) continue;
      await ctx.db.patch(row._id as never, {
        regionSpans: part.regionSpans,
        stemSpans: part.stemSpans,
        referencedFigures: part.referencedFigures,
        regionVersion: args.regionVersion,
        updatedAt: now,
      });
      patched += 1;
    }

    return {
      applied: true,
      taggedPaperCount: papers.length,
      partsTotal: args.parts.length,
      unmatched,
      unmatchedRatio,
      figures: args.figures.length,
      pageLayouts: args.pageLayouts.length,
      patched,
    };
  },
});

export const getPaperFigures = queryGeneric({
  args: { sourceRelativePaths: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePaths = Array.from(new Set(args.sourceRelativePaths));
    const rows = await Promise.all(uniquePaths.map((sourceRelativePath) =>
      ctx.db
        .query("paperFigures")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", sourceRelativePath))
        .collect()));
    return rows.flat();
  },
});

export const getPaperPageLayouts = queryGeneric({
  args: { sourceRelativePaths: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePaths = Array.from(new Set(args.sourceRelativePaths));
    const rows = await Promise.all(uniquePaths.map((sourceRelativePath) =>
      ctx.db
        .query("paperPageLayouts")
        .withIndex("by_source_relative_path", (q) => q.eq("sourceRelativePath", sourceRelativePath))
        .collect()));
    return rows.flat();
  },
});
