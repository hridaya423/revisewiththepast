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
