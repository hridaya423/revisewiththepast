import { v } from "convex/values";

export const questionIdentityAnchorValidator = v.object({
  pageNumber: v.number(),
  numberBounds: v.object({ x0: v.number(), y0: v.number(), x1: v.number(), y1: v.number() }),
  promptBaseline: v.number(),
  promptBounds: v.object({ x0: v.number(), y0: v.number(), x1: v.number(), y1: v.number() }),
});
