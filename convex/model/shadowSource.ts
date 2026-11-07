import { v } from "convex/values";

export const shadowSourceValidator = v.object({
  boardCode: v.string(),
  subjectKey: v.string(),
  subjectSlug: v.string(),
  tier: v.union(v.literal("foundation"), v.literal("higher")),
  year: v.number(),
  session: v.string(),
  paperCode: v.string(),
  questionPaperPath: v.string(),
});
