import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

const HOUR_MS = 60 * 60 * 1000;

function requireServiceSecret(serviceSecret: string) {
  const expected = process.env.MCP_SERVICE_SECRET;
  if (!expected || serviceSecret !== expected) throw new Error("Unauthorized");
}

function getPositiveInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export const reserve = mutation({
  args: {
    serviceSecret: v.string(),
    callerKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireServiceSecret(args.serviceSecret);
    if (!/^[a-f0-9]{64}$/.test(args.callerKey)) throw new Error("Invalid caller key.");

    const now = Date.now();
    const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const callerLimit = getPositiveInteger("MCP_RATE_LIMIT_PER_CALLER_PER_HOUR", 10, 1000);
    const globalLimit = getPositiveInteger("MCP_RATE_LIMIT_GLOBAL_PER_HOUR", 300, 100_000);
    const callerScope = `caller:${args.callerKey}`;
    const globalScope = "global";
    const [callerRow, globalRow] = await Promise.all([
      ctx.db.query("mcpRateLimits").withIndex("by_scope_window", (q) => q.eq("scope", callerScope).eq("windowStart", windowStart)).unique(),
      ctx.db.query("mcpRateLimits").withIndex("by_scope_window", (q) => q.eq("scope", globalScope).eq("windowStart", windowStart)).unique(),
    ]);
    const callerCount = callerRow?.count ?? 0;
    const globalCount = globalRow?.count ?? 0;
    const retryAt = windowStart + HOUR_MS;
    if (callerCount >= callerLimit || globalCount >= globalLimit) {
      return {
        allowed: false,
        retryAt,
        remainingForCaller: Math.max(0, callerLimit - callerCount),
        remainingGlobal: Math.max(0, globalLimit - globalCount),
      };
    }

    const updatedAt = now;
    if (callerRow) await ctx.db.patch(callerRow._id, { count: callerCount + 1, updatedAt });
    else await ctx.db.insert("mcpRateLimits", { scope: callerScope, windowStart, count: 1, updatedAt });
    if (globalRow) await ctx.db.patch(globalRow._id, { count: globalCount + 1, updatedAt });
    else await ctx.db.insert("mcpRateLimits", { scope: globalScope, windowStart, count: 1, updatedAt });

    return {
      allowed: true,
      retryAt,
      remainingForCaller: callerLimit - callerCount - 1,
      remainingGlobal: globalLimit - globalCount - 1,
    };
  },
});

export const cleanupOldWindows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const currentWindowStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const oldRows = await ctx.db
      .query("mcpRateLimits")
      .withIndex("by_window_start", (q) => q.lt("windowStart", currentWindowStart))
      .take(1000);
    for (const row of oldRows) await ctx.db.delete(row._id);
    return { deletedCount: oldRows.length };
  },
});
